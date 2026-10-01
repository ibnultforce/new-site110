#!/usr/bin/env node
/**
 * Runs whichever dated content-generation jobs in scripts/scaffold-schedule.md
 * are due, writing each one as a real Claude-authored page (not a
 * placeholder) grounded in the `content` and `images` the job supplies.
 *
 *   node scripts/scaffold-schedule.js              run every due, unfinished job
 *   node scripts/scaffold-schedule.js --dry-run     print what's due and what
 *                                                    would be sent to Claude;
 *                                                    write and mark nothing
 *
 * scripts/scaffold-schedule.md holds a fenced ```json array of jobs:
 *   { location, title, date, description, content, images, research, done }
 * — or, for a page you've already written yourself and just want moved into
 * place on its date instead of generated:
 *   { location, title, date, source, done }
 * A move job's `location` decides how the file is handled: a real collection
 * dir or content/pages/... renders it through the normal content pipeline
 * (it must have real frontmatter), while a location under static/ copies a
 * full standalone HTML document straight through untouched, the same way
 * build.js already copies the whole static/ folder into dist/. See that file
 * for the full field reference, including how `images` entries (local paths
 * or URLs) are actually shown to Claude as vision input rather than just
 * named in text, and how a moved file's own links to other staged pages get
 * rewritten to their real final URLs. A job whose date has arrived and isn't
 * already "done": true runs once, then gets "done": true and a
 * "completedDate" stamped in, so it never runs twice.
 *
 * The generated page is written only from the brief/content/images it's
 * given (no invented facts) and is checked against the site's real internal
 * URLs afterwards: any link Claude added to a page that doesn't exist is
 * stripped before the file is written.
 *
 * Requires ANTHROPIC_API_KEY. Without it, each due job's prompt is printed
 * instead of sent, and the job is left pending for the next run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, slugify, loadSite, applyUrlPattern, paths, markActive } from './lib/content.js';
import { TemplateEngine } from './lib/template.js';
import { scaffoldBody } from './lib/scaffold-templates.js';
import { updateChangelog, appendToSiteTree } from './lib/scaffold-tree-runner.js';
import { findJobsBlock, sanitizeHandEditedJson } from './lib/schedule-jobs.js';
import { callClaude, stripFence, resolveImages, stripBrokenLinks, bannedPhraseWarnings } from './lib/claude-writer.js';
import { knowledgePrompt, recordWork, summarizeChange } from './lib/knowledge.js';

const SCHEDULE_PATH = path.join(ROOT, 'scripts/scaffold-schedule.md');

const dryRun = process.argv.slice(2).includes('--dry-run');
const apiKey = process.env.ANTHROPIC_API_KEY;
const site = readJson(path.join(ROOT, 'site.config.json'));
const model = loadSite({ includeDrafts: true, includeFuture: true });
const internalUrls = model.all.map((e) => e.url).sort();

/* ----------------------------------------------------- static page chroming */

// A `static/...` move job is a full standalone HTML document copied straight
// through, so it never goes near templates/layouts/base.html. Rendering the
// real header/footer partials here (against the same site/nav data the real
// build uses) is what lets one of these pages carry the site's actual nav and
// footer instead of staying fully isolated.
const chromeEngine = new TemplateEngine();
for (const file of fs.readdirSync(paths.partials).filter((f) => f.endsWith('.html'))) {
  chromeEngine.add(file.replace(/\.html$/, ''), fs.readFileSync(path.join(paths.partials, file), 'utf8'));
}

function renderChrome(url) {
  const nav = { ...model.nav, header: { ...model.nav.header, items: markActive(model.nav.header.items, url) } };
  return {
    header: chromeEngine.render('header', { site: model.site, nav }),
    footer: chromeEngine.render('footer', { site: model.site, nav }),
  };
}

const SITE_ASSET_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Public+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/css/main.css">
`;

/** The header/footer partials are Tailwind markup and do nothing without the
 * site's compiled CSS (and its fonts) loaded, so make sure both are linked —
 * a standalone static page never had a reason to include them itself. */
function ensureSiteAssets(html) {
  if (html.includes('/assets/css/main.css')) return html;
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${SITE_ASSET_LINKS}</head>`)
    : `${SITE_ASSET_LINKS}${html}`;
}

/** Replaces an existing <header>/<nav> block with the real header partial
 * (whichever tag appears first — a page may only have one), or pushes the
 * header in right after <body> if neither is present. Same idea for
 * <footer>, appended just before </body> when missing. */
/** Replaces every existing match with the rendered partial only at its first
 * occurrence, and drops the rest — a page with separate sibling <header> and
 * <nav> elements (rather than one nesting the other) would otherwise leave
 * the second one behind, duplicating nav markup our header partial already
 * includes. */
function replaceFirstDropRest(html, re, replacement) {
  let inserted = false;
  let matched = false;
  const out = html.replace(re, () => {
    matched = true;
    if (inserted) return '';
    inserted = true;
    return replacement;
  });
  return { html: out, matched };
}

function injectChrome(html, { header, footer }) {
  const headerRe = /<header\b[\s\S]*?<\/header>|<nav\b[\s\S]*?<\/nav>/gi;
  const footerRe = /<footer\b[\s\S]*?<\/footer>/gi;

  const headerPass = replaceFirstDropRest(html, headerRe, header);
  let out = headerPass.matched
    ? headerPass.html
    : /<body\b[^>]*>/i.test(html)
      ? html.replace(/(<body\b[^>]*>)/i, `$1\n${header}`)
      : `${header}\n${html}`;

  const footerPass = replaceFirstDropRest(out, footerRe, footer);
  out = footerPass.matched
    ? footerPass.html
    : /<\/body>/i.test(out)
      ? out.replace(/(<\/body>)/i, `${footer}\n$1`)
      : `${out}\n${footer}`;

  return ensureSiteAssets(out);
}

/* ------------------------------------------------------------- schedule I/O */


function readSchedule() {
  if (!fs.existsSync(SCHEDULE_PATH)) {
    console.error(`\n  No schedule file at ${path.relative(ROOT, SCHEDULE_PATH)}.\n`);
    process.exit(1);
  }
  const text = fs.readFileSync(SCHEDULE_PATH, 'utf8');
  const match = findJobsBlock(text);
  if (!match) {
    console.error(`\n  ${path.relative(ROOT, SCHEDULE_PATH)} has no \`\`\`json job list (a fenced JSON array).\n`);
    process.exit(1);
  }
  let jobs;
  try {
    jobs = JSON.parse(sanitizeHandEditedJson(match[1]));
  } catch (error) {
    console.error(`\n  Could not parse the job list as JSON: ${error.message}\n`);
    process.exit(1);
  }
  return { text, jobs };
}

/** The file may be checked out with CRLF line endings (e.g. Windows with
 * git's core.autocrlf=true) — match whatever's already there so a rewritten
 * job list doesn't leave the file with mixed line endings. */
function detectEol(text) {
  const idx = text.indexOf('\n');
  return idx > 0 && text[idx - 1] === '\r' ? '\r\n' : '\n';
}

function writeSchedule(text, jobs) {
  const match = findJobsBlock(text);
  const eol = detectEol(text);
  const block = ('```json\n' + JSON.stringify(jobs, null, 2) + '\n```').replace(/\n/g, eol);
  const updated = match
    ? text.slice(0, match.index) + block + text.slice(match.index + match[0].length)
    : `${text}${eol}${eol}${block}${eol}`;
  fs.writeFileSync(SCHEDULE_PATH, updated);
}

/* -------------------------------------------------------------- resolve job */

function collectionDirs() {
  const map = new Map();
  for (const [key, cfg] of Object.entries(site.collections)) map.set(cfg.dir, { key, cfg });
  return map;
}

/** Returns { type, file, url, error } — `url` is the page's real final address,
 * predicted from `location` + `title` alone, before the file exists. Used both
 * to write the destination and (for move jobs) to resolve cross-references
 * between staged pages regardless of which one moves first. */
function resolveJob(job) {
  const location = String(job.location || '').replace(/\/$/, '');

  // A location under static/ is a full standalone HTML document (its own
  // <html>/<head>/<style>, not a content fragment) that must be served
  // completely as written — the build already copies static/ into dist/
  // untouched, so this is a move-only destination: no frontmatter, no
  // markdown, no layout, and the source's own filename is kept as-is.
  if (location === 'static' || location.startsWith('static/')) {
    if (!job.source) {
      return { error: 'a location under static/ only makes sense for a move job with a "source" — there is no content to generate for a full standalone page.' };
    }
    const sub = location.replace(/^static\/?/, '');
    const filename = path.basename(job.source);
    return {
      type: 'static',
      file: sub ? `static/${sub}/${filename}` : `static/${filename}`,
      url: `/${sub ? `${sub}/` : ''}${filename}`,
    };
  }

  if (!job.title) return { error: 'has no "title", which the filename, slug and predicted URL all depend on.' };
  const slug = slugify(job.title);
  const dirs = collectionDirs();

  const collectionHit = dirs.get(location);
  if (collectionHit) {
    const { key, cfg } = collectionHit;
    return { type: key, file: `${cfg.dir}/${slug}.md`, url: applyUrlPattern(cfg.urlPattern, slug) };
  }

  if (location === 'content/pages' || location.startsWith('content/pages/')) {
    const sub = location.replace(/^content\/pages\/?/, '');
    const fullSlug = sub ? `${sub}/${slug}` : slug;
    return {
      type: 'pages',
      file: `content/pages/${fullSlug}.md`,
      url: applyUrlPattern(site.collections.pages.urlPattern, fullSlug),
    };
  }

  return {
    error: `"${job.location}" isn't a collection directory (${[...dirs.keys()].join(', ')}) or under content/pages/ — the build would never find it.`,
  };
}

/** Maps every way a staged page might be referenced (its source path, that
 * path without a leading slash, and its bare filename) to the real URL it
 * will have once moved — built from every "source" job in the whole
 * schedule, not just the ones due today, so a link to a page scheduled for
 * later still resolves correctly. */
function buildStagedUrlMap(jobs) {
  const map = new Map();
  for (const job of jobs) {
    if (!job.source) continue;
    const resolved = resolveJob(job);
    if (resolved.error) continue;
    const stripped = String(job.source).replace(/^\/+/, '');
    for (const key of [job.source, stripped, `/${stripped}`, path.basename(stripped)]) {
      map.set(key, resolved.url);
    }
  }
  return map;
}

/** Rewrites any markdown link or href/src attribute that points at a staged
 * page's source path into that page's real destination URL. Leaves anything
 * that isn't a reference to another staged page untouched. */
function resolveStagedLinks(text, stagedUrlMap) {
  const changed = [];
  const lookup = (href) => {
    const clean = href.split(/[?#]/)[0];
    return (
      stagedUrlMap.get(href) ||
      stagedUrlMap.get(clean.replace(/^\.?\//, '')) ||
      stagedUrlMap.get(path.basename(clean)) ||
      null
    );
  };
  const rewrite = (full, pre, href, post) => {
    const url = lookup(href);
    if (!url || url === href) return full;
    changed.push(`${href} -> ${url}`);
    return `${pre}${url}${post}`;
  };

  let cleaned = text.replace(/(\[[^\]]+\]\()([^)\s]+)(\))/g, rewrite);
  cleaned = cleaned.replace(/((?:href|src)=["'])([^"']+)(["'])/g, rewrite);
  return { cleaned, changed };
}

/* ---------------------------------------------------------------- the call */

function buildPrompts(job, skeleton, images) {
  const imageList = images.length
    ? images.map((img) => `- ${img.ref}${img.block ? '' : '  (reference only — not readable as an image)'}`).join('\n')
    : 'None supplied.';
  const knowledge = knowledgePrompt();

  const systemPrompt = `You write one new page for ${site.name}'s site (${site.description}). You are given a brief, and usually source notes and images, and must write the complete file: real frontmatter values and a real, useful markdown body — not placeholder text.

GROUNDING — the most important rule here
- Base the body only on the brief and the notes/images below. Do not add facts, figures, names, dates or claims that aren't in that material.
- If the material is thin, write a shorter, more general page rather than inventing specifics to fill space.
- Where an image is shown to you, write real, specific alt text describing what's actually in it — never a generic caption.

FILE SHAPE TO FOLLOW (fill in every field for real; keep the same field names and structure):
${skeleton}

HOUSE RULES (from CLAUDE.md — follow exactly)
- British spelling, sentence case headings, plain verbs. No exclamation marks, no "unlock", "seamless", "game-changing", "dive in".
- Do not add a leading "# Title" heading in the body — the layout renders the title separately. Use "##" for section headings.

IMAGES
${imageList}
If any are listed as readable, use markdown image syntax ![alt text](path) with that exact path, wherever it genuinely fits — do not invent or alter a path. If none are listed, add no images.

LINKING
Link to other existing pages only where it genuinely helps the reader, written as root-relative markdown links, from this list:
${internalUrls.join('\n')}
Never invent a URL. Adding no links at all is fine.

${knowledge ? `${knowledge}\n\n` : ''}OUTPUT
Return only the raw contents of the new file, starting with the opening "---" of the frontmatter. No commentary, no surrounding code fence.`;

  const userText = `Title: ${job.title}
Brief: ${job.description}
${job.content ? `Source notes/content to work from (use only this, don't go beyond it):\n${job.content}\n` : ''}`;

  const imageBlocks = images.map((img) => img.block).filter(Boolean);
  const userContent = imageBlocks.length ? [{ type: 'text', text: userText }, ...imageBlocks] : userText;

  return { systemPrompt, userContent };
}

function sanityCheck(raw) {
  const problems = [];
  if (!/^---\n/.test(raw)) problems.push('missing opening frontmatter "---"');
  if (!/\ntitle:\s*\S/.test(raw)) problems.push('missing a title in frontmatter');
  if (raw.length < 200) problems.push(`output is suspiciously short (${raw.length} chars)`);
  const openers = (raw.match(/\{\{#\s*(if|unless|each)/g) || []).length;
  const closers = (raw.match(/\{\{\/\s*(if|unless|each)/g) || []).length;
  if (openers !== closers) problems.push(`unbalanced template blocks (${openers} opened, ${closers} closed)`);
  return problems;
}

/** A job with a "source" moves an already-written file into place instead of
 * asking Claude to write one. Its own cross-references to other staged pages
 * (by source path or bare filename) are rewritten to their real URLs first. */
function runMoveJob(job, resolved, target, stagedUrlMap) {
  const label = job.title || path.basename(job.source);
  const sourcePath = path.join(ROOT, job.source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`  ! ${label} — source file not found: ${job.source}`);
    return false;
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');

  // Anywhere other than static/, the file is rendered through the normal
  // content pipeline (frontmatter -> markdown -> layout), so it needs real
  // frontmatter — a full standalone HTML document would otherwise get
  // parsed as a bodyless page whose title falls back to its slug and whose
  // markup prints as literal escaped text instead of rendering.
  if (resolved.type !== 'static') {
    const problems = sanityCheck(raw);
    if (problems.length) {
      console.error(`  ! ${label} — ${job.source} isn't valid content for ${job.location}:\n${problems.map((p) => `      - ${p}`).join('\n')}\n      If this is a full standalone HTML document, use a "static/..." location instead — it's copied through untouched.`);
      return false;
    }
  }

  const { cleaned: relinked, changed } = resolveStagedLinks(raw, stagedUrlMap);

  // A static/ page never goes through templates/layouts/base.html, so it only
  // gets the site's real header/nav/footer if we splice the rendered
  // partials in here — replacing whatever <header>/<nav>/<footer> the page
  // already had, or adding them if it had none.
  const cleaned = resolved.type === 'static' ? injectChrome(relinked, renderChrome(resolved.url)) : relinked;

  if (dryRun) {
    console.log(`  + ${resolved.file}  (would move from ${job.source}${changed.length ? `, relinking ${changed.length}` : ''}${resolved.type === 'static' ? ', chroming header/footer' : ''})`);
    for (const c of changed) console.log(`      ~ ${c}`);
    return false;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`);
  fs.unlinkSync(sourcePath);
  for (const c of changed) console.log(`  ~ ${label} — relinked ${c}`);
  console.log(`  + ${resolved.file}  (moved from ${job.source})`);
  return true;
}

/* ---------------------------------------------------------------- one job */

async function runJob(job, stagedUrlMap) {
  const resolved = resolveJob(job);
  if (resolved.error) {
    console.error(`  ! ${job.title || job.source || '(untitled job)'} — ${resolved.error}`);
    return false;
  }

  const target = path.join(ROOT, resolved.file);
  if (fs.existsSync(target)) {
    console.log(`  = ${resolved.file}  (already exists, marking done without touching it)`);
    return true;
  }

  if (job.source) return runMoveJob(job, resolved, target, stagedUrlMap);

  const today = new Date().toISOString().slice(0, 10);
  const skeleton = scaffoldBody(resolved.type, { title: job.title, today, defaultAuthor: site.automation.defaultAuthor });
  const research = job.research !== false;

  if (dryRun) {
    const images = resolveImages(job.images);
    console.log(`  + ${resolved.file}  (would write, research: ${research}, images: ${images.length}/${(job.images || []).length} readable)`);
    return false;
  }

  const images = resolveImages(job.images);
  const { systemPrompt, userContent } = buildPrompts(job, skeleton, images);

  if (!apiKey) {
    console.log(`\n----- ${job.title}: system prompt -----\n${systemPrompt}\n\n----- user content -----\n${typeof userContent === 'string' ? userContent : JSON.stringify(userContent, null, 2)}\n`);
    console.log('  No ANTHROPIC_API_KEY set — job left pending.\n');
    return false;
  }

  console.log(`  ... generating ${resolved.file} (model: ${site.automation.model}, research: ${research}, images: ${images.length})`);
  const raw = stripFence(await callClaude({ apiKey, model: site.automation.model, systemPrompt, userContent, research }));
  const problems = sanityCheck(raw);
  if (problems.length) {
    console.error(`  ! ${job.title} — rejected:\n${problems.map((p) => `      - ${p}`).join('\n')}`);
    return false;
  }

  const { cleaned, removed } = stripBrokenLinks(raw, internalUrls);
  for (const href of removed) console.log(`  ! ${job.title} — removed a link to a page that doesn't exist: ${href}`);
  for (const warning of bannedPhraseWarnings(cleaned)) console.log(`  ! ${job.title} — ${warning}`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Read before writing, so the work-log summary sees what the page was (empty for a new page).
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  fs.writeFileSync(target, cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`);
  const instruction = `wrote "${job.title}": ${job.description || ''}`;
  const summary = await summarizeChange({ apiKey, model: site.automation.model, command: 'scaffold:schedule', file: resolved.file, instruction, before, after: cleaned });
  recordWork({ command: 'scaffold:schedule', file: resolved.file, instruction, summary });
  console.log(`  + ${resolved.file}`);
  return true;
}

/* -------------------------------------------------------------------- run */

async function main() {
  const { text, jobs } = readSchedule();
  const today = new Date().toISOString().slice(0, 10);
  const stagedUrlMap = buildStagedUrlMap(jobs);

  console.log(`\n  Checking ${path.relative(ROOT, SCHEDULE_PATH)} (today: ${today})\n`);

  let ranAny = false;
  let due = 0;
  const publishedPaths = [];

  for (const job of jobs) {
    if (job.done) continue;
    const jobDate = new Date(job.date);
    if (Number.isNaN(jobDate.getTime())) {
      console.log(`  ! "${job.title}" has an unparsable date "${job.date}", skipped.`);
      continue;
    }
    if (jobDate.toISOString().slice(0, 10) > today) {
      console.log(`  - ${job.title}  (scheduled ${job.date}, not due yet)`);
      continue;
    }

    due++;
    const done = await runJob(job, stagedUrlMap);
    if (done && !dryRun) {
      job.done = true;
      job.completedDate = today;
      ranAny = true;
      const resolved = resolveJob(job);
      if (!resolved.error) publishedPaths.push(resolved.url.replace(/^\//, ''));
    }
  }

  if (dryRun) {
    console.log(`\n  Dry run — ${due} job(s) due, nothing written, nothing marked done.\n`);
    return;
  }

  if (ranAny) {
    writeSchedule(text, jobs);
    const addedToTree = appendToSiteTree(publishedPaths);
    if (addedToTree.length) console.log(`  Added to scripts/site-tree.md: ${addedToTree.join(', ')}`);
    try {
      updateChangelog();
      console.log('  Updated CHANGELOG.md.');
    } catch (error) {
      console.log(`  Skipped CHANGELOG.md — ${error.message}`);
    }
    console.log(`\n  Marked done in ${path.relative(ROOT, SCHEDULE_PATH)}. Review with npm run check.\n`);
  } else if (due) {
    console.log('\n  Job(s) were due but none completed — see errors above. Nothing marked done.\n');
  } else {
    console.log('\n  No jobs due.\n');
  }
}

main().catch((error) => {
  console.error(`\n  Schedule run failed: ${error.message}\n`);
  process.exit(1);
});
