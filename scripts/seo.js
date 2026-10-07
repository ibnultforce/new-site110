#!/usr/bin/env node
/**
 * Search engine optimisation for every page: check it, set it by hand, or let
 * Claude write it from what the page already says.
 *
 *   node scripts/seo.js                          audit every page: score, issues, search-result preview
 *   node scripts/seo.js <page>                   the same for one page, in full
 *   node scripts/seo.js <page> --title="…" --description="…" --keyword="…"
 *                                                set the page's SEO fields by hand
 *   node scripts/seo.js <page> --claude ["<direction>"]
 *                                                Claude writes the title, description and focus keyphrase
 *   node scripts/seo.js --all --claude ["<direction>"]
 *                                                the same for every page that has no SEO title or description
 *
 * <page> is a content slug, a URL or a path under content/, as for page:edit.
 *
 * Fields (an empty value, --title="", removes the field so the default applies):
 *   --title=<text>          metaTitle: the whole <title> shown in search results
 *   --description=<text>    metaDescription: the snippet under it
 *   --keyword=<text>        focusKeyword: the search phrase the page should be found for
 *   --image=<path|url>      ogImage: the image shown when the page is shared
 *   --image-alt=<text>      ogImageAlt: that image's alt text
 *   --canonical=<url|path>  canonical: the URL search engines should index instead
 *   --noindex / --index     keep the page out of search engines, or let it back in
 *
 * Options:
 *   --all                   with --claude: every page without its own SEO title or description
 *   --force                 with --all: every page, including ones that have both, and noindex pages
 *   --preview               with the audit of every page: show each page's search-result preview
 *   --json                  print the audit as JSON instead of text
 *   --report=<file>         also save the audit (after any change) as JSON
 *   --html=<file>           also save the audit as an HTML page of search-result previews
 *   --dry-run               print what would change, write nothing
 *   --proposal-out=<file>   with --dry-run --claude for one page: save the proposal as JSON
 *                           ({ file, mode: "seo", content, seo, problems, warnings, … })
 *
 * --claude needs ANTHROPIC_API_KEY. Claude sees the page, the site's other
 * titles and descriptions (so it doesn't repeat them), knowledge/notes.md and
 * the work log. Its reply is measured like the audit measures, and Claude is
 * asked to fix a title or description that's too long, too short, repeats
 * another page or misses the keyphrase (up to 3 requests). A page's own focus
 * keyphrase is kept unless a direction is given. Canonical, noindex and the
 * social image are never changed by Claude.
 *
 * The Twinstack web app runs this script from its SEO tab and reads the
 * --report JSON and the --proposal-out proposal: keep both shapes in step
 * with its server/src/seo.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSite } from './lib/content.js';
import { LIMITS, SEO_FIELDS, auditPages, hasKeyword, pageSeo, seoSettings, setFrontmatterFields, textWidth, truncateToWidth, validCanonical } from './lib/seo.js';

const knowledge = await import('./lib/knowledge.js').catch(() => null);

// Room for the model's thinking as well as the short JSON reply.
const MAX_TOKENS = 8000;
const MAX_ATTEMPTS = 3;
const MAX_PAGE_CHARS = 12000;
const MAX_OTHER_PAGES = 80;

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const positional = argv.filter((a) => !a.startsWith('--'));
const dryRun = Boolean(flag('dry-run'));
const proposalOut = flag('proposal-out');
const apiKey = process.env.ANTHROPIC_API_KEY;

// The flags that set a field by hand, and the frontmatter field each one sets.
const FIELD_FLAGS = {
  title: 'metaTitle',
  description: 'metaDescription',
  keyword: 'focusKeyword',
  image: 'ogImage',
  'image-alt': 'ogImageAlt',
  canonical: 'canonical',
};

let model = load();
const { site } = model;
// The Twinstack web app passes the account's chosen model; run by hand, the site's own setting.
const CLAUDE_MODEL = process.env.TWINSTACK_MODEL || site.automation.model;

function load() {
  return loadSite({ includeDrafts: true, includeFuture: true });
}

/* ------------------------------------------------------------------ pages */

const rel = (file) => file.split(path.sep).join('/');

/** The page a <page> argument names: a slug, a URL or a path under content/. */
function findPage(arg) {
  const value = String(arg).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const pages = model.all;
  const asUrl = value.startsWith('/') ? value : `/${value}`;
  return (
    pages.find((p) => rel(p.sourceFile) === value || rel(p.sourceFile) === `${value}.md`) ||
    pages.find((p) => p.url === value || p.url === asUrl || p.url === `${asUrl}.html` || p.url === `${asUrl}/`) ||
    // A slug can be a number (slug: 404), which the frontmatter parser reads as one.
    pages.find((p) => String(p.slug) === value) ||
    pages.find((p) => String(p.slug).split('/').pop() === value) ||
    null
  );
}

/** A page's SEO fields as its frontmatter sets them. */
function ownFields(page) {
  const out = {};
  for (const field of SEO_FIELDS) {
    if (field === 'noindex') out.noindex = page.noindex === true;
    else out[field] = typeof page[field] === 'string' || typeof page[field] === 'number' ? String(page[field]) : '';
  }
  return out;
}

/* ------------------------------------------------------------------ audit */

function audit() {
  return auditPages(model.all, site, ROOT).map(({ page, seo, issues, score }) => ({ page, seo, issues, score }));
}

/** The audit as the JSON the --report and --json options write. */
function reportJson(results) {
  const scores = results.map((r) => r.score);
  return {
    createdAt: new Date().toISOString(),
    site: {
      name: site.name,
      shortName: site.shortName || site.name,
      url: String(site.url).replace(/\/+$/, ''),
      favicon: site.brand?.favicon || site.brand?.logoMark || '',
    },
    settings: seoSettings(site),
    limits: LIMITS,
    summary: {
      pages: results.length,
      average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      errors: results.reduce((n, r) => n + r.issues.filter((i) => i.level === 'error').length, 0),
      warnings: results.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warning').length, 0),
    },
    pages: results.map(({ page, seo, issues, score }) => ({
      file: rel(page.sourceFile),
      url: page.url,
      absoluteUrl: page.absoluteUrl,
      collection: page.collection,
      title: page.title,
      draft: page.draft,
      date: page.date ? String(page.date) : null,
      fields: ownFields(page),
      seo: {
        title: seo.title,
        defaultTitle: seo.defaultTitle,
        description: seo.description,
        defaultDescription: seo.defaultDescription,
        descriptionSource: seo.descriptionSource,
        socialTitle: seo.socialTitle,
        image: seo.image,
        imagePath: seo.imagePath,
        // What the social image falls back to when ogImage is empty.
        defaultImagePath: String(page.image || site.brand?.defaultOgImage || ''),
        imageAlt: seo.imageAlt,
        canonical: seo.canonical,
        robots: seo.robots,
        type: seo.type,
      },
      score,
      issues,
    })),
  };
}

function insideRepo(file, option) {
  const target = path.resolve(ROOT, String(file));
  if (!target.startsWith(ROOT + path.sep)) {
    console.error(`  ${option} must be inside the repository, not ${file}.`);
    return null;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

/** Saves the --report JSON and the --html page, from a fresh audit. */
function saveReports() {
  const reportFile = flag('report');
  const htmlFile = flag('html');
  if (!reportFile && !htmlFile) return;
  model = load();
  const report = reportJson(audit());
  if (typeof reportFile === 'string') {
    const target = insideRepo(reportFile, '--report');
    if (target) fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (typeof htmlFile === 'string') {
    const target = insideRepo(htmlFile, '--html');
    if (target) {
      fs.writeFileSync(target, htmlReport(report));
      console.log(`  Saved the search-result previews to ${rel(path.relative(ROOT, target))}`);
    }
  }
}

const LEVEL_MARK = { error: 'x', warning: '!', tip: '-', note: '·' };

/** The page as a search result, in the terminal. */
function serpLines(page, seo) {
  const crumbs = [String(site.url).replace(/^https?:\/\//, '').replace(/\/+$/, ''), ...page.url.split('/').filter(Boolean)].join(' › ');
  const title = truncateToWidth(seo.title, LIMITS.titleSize, LIMITS.titlePx);
  const description = truncateToWidth(seo.description, LIMITS.descriptionSize, LIMITS.descriptionPx);
  const wrap = (text, width) => text.match(new RegExp(`.{1,${width}}(\\s|$)`, 'g'))?.map((l) => l.trim()) ?? [text];
  return [
    `${site.name} · ${crumbs}`,
    title.text,
    ...wrap(`${seo.type === 'article' && page.dateFormatted ? `${page.dateFormatted} — ` : ''}${description.text}`, 72),
  ];
}

function printPage({ page, seo, issues, score }, { preview = true } = {}) {
  console.log(`\n  ${String(score).padStart(3)}  ${page.url}  (${rel(page.sourceFile)})${page.draft ? '  draft' : ''}`);
  if (preview) {
    const lines = serpLines(page, seo);
    lines.forEach((line, i) => console.log(`       ${i === 0 ? '┌' : i === lines.length - 1 ? '└' : '│'} ${line}`));
  }
  for (const issue of issues) console.log(`       ${LEVEL_MARK[issue.level]} ${issue.level.padEnd(7)} ${issue.message}`);
}

function printAudit(results, { preview }) {
  // Worst first, so what needs work is at the top.
  for (const result of [...results].sort((a, b) => a.score - b.score)) printPage(result, { preview });
  const report = reportJson(results);
  console.log(`\n  ${report.summary.pages} page${report.summary.pages === 1 ? '' : 's'}, average score ${report.summary.average}/100, ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
  console.log('  x error   ! warning   - tip   · note');
  if (!preview && results.length > 1) console.log('  Add --preview to see each page as a search result, or name one page: npm run seo -- <page>');
  console.log('');
}

/* ------------------------------------------------------------ HTML report */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function htmlReport(report) {
  const host = report.site.url.replace(/^https?:\/\//, '');
  const cards = report.pages
    .map((p) => {
      const title = truncateToWidth(p.seo.title, LIMITS.titleSize, LIMITS.titlePx);
      const description = truncateToWidth(p.seo.description, LIMITS.descriptionSize, LIMITS.descriptionPx);
      const crumbs = [host, ...p.url.split('/').filter(Boolean)].map(esc).join(' › ');
      const issues = p.issues.map((i) => `<li class="${i.level}"><b>${i.level}</b> ${esc(i.message)}</li>`).join('');
      const tone = p.score >= 80 ? 'good' : p.score >= 50 ? 'ok' : 'poor';
      return `<article>
  <header><span class="score ${tone}">${p.score}</span><code>${esc(p.file)}</code>${p.draft ? ' <em>draft</em>' : ''}</header>
  <div class="serp">
    <div class="site"><span class="icon">${esc(report.site.shortName.slice(0, 1))}</span><span><span class="name">${esc(report.site.name)}</span><span class="crumbs">${crumbs}</span></span></div>
    <h3>${esc(title.text)}</h3>
    <p>${p.date && p.seo.type === 'article' ? `<span class="date">${esc(p.date.slice(0, 10))} — </span>` : ''}${esc(description.text)}</p>
  </div>
  ${issues ? `<ul>${issues}</ul>` : '<p class="clean">No issues.</p>'}
</article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO previews · ${esc(report.site.name)}</title>
<style>
body{margin:0;background:#f8f9fa;color:#202124;font:14px/1.5 Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#5f6368;margin:0 0 24px}
article{background:#fff;border:1px solid #dadce0;border-radius:8px;padding:16px 20px;margin:0 0 16px}
article header{display:flex;gap:10px;align-items:center;margin-bottom:12px;color:#5f6368}
.score{font-weight:700;border-radius:999px;padding:2px 10px;color:#fff}.good{background:#188038}.ok{background:#e37400}.poor{background:#d93025}
.serp{max-width:600px}.site{display:flex;gap:10px;align-items:center}
.icon{width:26px;height:26px;border-radius:50%;background:#e8eaed;display:grid;place-items:center;font-weight:700;font-size:12px}
.name{display:block;font-size:14px}.crumbs{display:block;font-size:12px;color:#4d5156}
h3{color:#1a0dab;font-size:20px;font-weight:400;line-height:1.3;margin:6px 0 3px}
.serp p{margin:0;color:#4d5156;font-size:14px;line-height:1.58}.date{color:#70757a}
ul{margin:12px 0 0;padding:12px 0 0 18px;border-top:1px solid #eee}li{margin:2px 0}li b{text-transform:uppercase;font-size:11px}
li.error b{color:#d93025}li.warning b{color:#e37400}li.tip b{color:#1a73e8}li.note b{color:#5f6368}.clean{color:#188038;margin:12px 0 0}
</style></head>
<body><main>
<h1>Search-result previews</h1>
<p class="sub">${esc(report.site.name)} · ${report.summary.pages} pages · average score ${report.summary.average}/100 · ${esc(report.createdAt.slice(0, 16).replace('T', ' '))}</p>
${cards}
</main></body></html>
`;
}

/* ------------------------------------------------------------- set fields */

function readFieldFlags() {
  const fields = {};
  const problems = [];
  for (const [name, field] of Object.entries(FIELD_FLAGS)) {
    const value = flag(name);
    if (value === undefined) continue;
    if (value === true) problems.push(`--${name} needs a value: --${name}="…" (or --${name}= to remove it)`);
    else fields[field] = value.replace(/\s+/g, ' ').trim();
  }
  if (flag('noindex') && flag('index')) problems.push('--noindex and --index both given');
  else if (flag('noindex')) fields.noindex = true;
  else if (flag('index')) fields.noindex = false;
  if (fields.canonical && !validCanonical(fields.canonical)) problems.push(`--canonical must be an http(s) URL or a path starting with /, not "${fields.canonical}"`);
  return { fields, problems };
}

/** Warnings about values set by hand (they're still written: the author decides). */
function valueWarnings(fields, page) {
  const warnings = [];
  if (fields.metaTitle && textWidth(fields.metaTitle, LIMITS.titleSize) > LIMITS.titlePx) warnings.push(`the title is ${textWidth(fields.metaTitle, LIMITS.titleSize)}px wide and will be cut off (about ${LIMITS.titlePx}px fits)`);
  if (fields.metaDescription && textWidth(fields.metaDescription, LIMITS.descriptionSize) > LIMITS.descriptionPx) warnings.push(`the description is ${textWidth(fields.metaDescription, LIMITS.descriptionSize)}px wide and will be cut off (about ${LIMITS.descriptionPx}px fits)`);
  if (fields.ogImage && !/^https?:\/\//i.test(fields.ogImage)) {
    const file = fields.ogImage.replace(/^\/+/, '');
    if (!fields.ogImage.startsWith('/') || !(fs.existsSync(path.join(ROOT, file)) || fs.existsSync(path.join(ROOT, 'static', file)))) {
      warnings.push(`the image ${fields.ogImage} doesn't exist in the site (use /assets/img/… or an https URL)`);
    }
  }
  const keyword = fields.focusKeyword ?? page.focusKeyword;
  const title = fields.metaTitle ?? page.metaTitle;
  if (keyword && title && !hasKeyword(title, keyword)) warnings.push('the focus keyphrase isn\'t in the title');
  return warnings;
}

function writeFields(page, fields) {
  const full = path.join(ROOT, page.sourceFile);
  const original = fs.readFileSync(full, 'utf8');
  const updated = setFrontmatterFields(original, fields);
  return { full, original, updated, changed: updated !== original };
}

function setByHand(page) {
  const { fields, problems } = readFieldFlags();
  if (problems.length) {
    console.error(`\n  ${problems.join('\n  ')}\n`);
    return 1;
  }
  const { full, updated, changed } = writeFields(page, fields);
  console.log(`\n  Page: ${page.url}  (${rel(page.sourceFile)})`);
  for (const [field, value] of Object.entries(fields)) {
    console.log(`  ${field}: ${value === '' || value === false ? '(removed, the default applies)' : JSON.stringify(value)}`);
  }
  for (const warning of valueWarnings(fields, page)) console.log(`  warning: ${warning}`);
  if (!changed) {
    console.log('  Nothing to change.\n');
    return 0;
  }
  if (dryRun) {
    console.log('\n  --dry-run: nothing written.\n');
    return 0;
  }
  fs.writeFileSync(full, updated);
  console.log(`  Wrote ${rel(page.sourceFile)}`);
  model = load();
  const result = audit().find((r) => r.page.sourceFile === page.sourceFile);
  if (result) printPage(result);
  console.log('');
  return 0;
}

/* ----------------------------------------------------------------- Claude */

// ANTHROPIC_BASE_URL points at a proxy or a local mock, as in lib/claude-writer.js.
const API_URL = `${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`;

/** The effort level and refusal fallbacks the model takes: a copy of modelOptions in lib/claude-writer.js. */
function modelOptions(model, effort) {
  const body = {};
  const headers = {};
  if (/^claude-(opus-(4-[5-8]|5)|sonnet-(4-6|5)|fable-5)/.test(model)) body.output_config = { effort };
  if (/^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  return { body, headers };
}

async function requestClaude({ systemPrompt, messages }) {
  const options = modelOptions(CLAUDE_MODEL, 'medium');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...options.headers },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages, ...options.body }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const payload = await response.json();
  const text = payload.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, stopReason: payload.stop_reason ?? null };
}

function buildPrompts(page, direction, keepKeyword) {
  const seo = pageSeo(page, site);
  const shortName = site.shortName || site.name;
  const others = model.all
    .filter((p) => p.sourceFile !== page.sourceFile && p.noindex !== true)
    .slice(0, MAX_OTHER_PAGES)
    .map((p) => {
      const s = pageSeo(p, site);
      return `- ${p.url}: "${s.title}" — ${s.description.slice(0, 160)}`;
    })
    .join('\n');
  const source = fs.readFileSync(path.join(ROOT, page.sourceFile), 'utf8').replace(/\r\n/g, '\n');
  const pageText = source.length > MAX_PAGE_CHARS ? `${source.slice(0, MAX_PAGE_CHARS)}\n[… the rest of the page is left out …]` : source;

  const systemPrompt = `You write the search engine metadata for one page of ${site.name}'s website (${site.description || site.tagline || site.url}).

You write three things:
- metaTitle: the page's whole <title>, as search results show it. Put the page's main topic first, in the words people search with. End with " | ${shortName}" when that still fits. At most 60 characters (search results cut titles off at about 600 pixels), and at least 30.
- metaDescription: the snippet under the title. One or two plain sentences, 120 to 155 characters, saying what the page offers and why it's worth the click. Use the focus keyphrase naturally once.
- focusKeyword: the 2 to 4 word phrase someone would type into a search engine to find this page.

Rules:
- Only say what the page itself says. Don't invent facts, figures, prices, awards, clients or guarantees.
- Write in the page's language and spelling. No exclamation marks, no clickbait, no keyword stuffing, no quotation marks around the whole text.
- Every title and description must differ from the site's other pages, listed below.
- Reply with one JSON object and nothing else: {"metaTitle": "…", "metaDescription": "…", "focusKeyword": "…"}`;

  const userPrompt = `Page URL: ${page.absoluteUrl}
File: ${rel(page.sourceFile)}

What search results show now:
  title: ${seo.title}${page.metaTitle ? '' : '   (the site default, made from the page title)'}
  description: ${seo.description || '(none)'}${seo.descriptionSource === 'body' ? '   (taken from the start of the page text)' : ''}
  focus keyphrase: ${seo.keyword || '(none)'}
${keepKeyword ? `\nKeep the focus keyphrase exactly as it is: "${page.focusKeyword}". Write the title and description for it.\n` : ''}
The site's other pages (don't repeat their titles or descriptions):
${others || '(none)'}

----- page -----
${pageText}
----- end page -----

${direction ? `Direction from the author: ${direction}` : 'Write the metadata for this page.'}`;

  return { systemPrompt: knowledge ? knowledge.withKnowledge(systemPrompt) : systemPrompt, userPrompt };
}

/** The fields in Claude's reply, or null if it isn't the JSON asked for. */
function parseReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().replace(/^["“](.*)["”]$/, '$1') : '');
    return { metaTitle: clean(data.metaTitle), metaDescription: clean(data.metaDescription), focusKeyword: clean(data.focusKeyword) };
  } catch {
    return null;
  }
}

/** What's wrong with a suggestion, as Claude is told it: [] when it's good. */
function suggestionIssues(fields, page) {
  if (!fields) return ['The reply wasn\'t the JSON object asked for.'];
  const issues = [];
  const titlePx = textWidth(fields.metaTitle, LIMITS.titleSize);
  const descriptionPx = textWidth(fields.metaDescription, LIMITS.descriptionSize);
  if (!fields.metaTitle) issues.push('metaTitle is empty.');
  else if (titlePx > LIMITS.titlePx) issues.push(`metaTitle is ${fields.metaTitle.length} characters (${titlePx}px) and will be cut off: make it shorter than ${LIMITS.titlePx}px, about 55 characters.`);
  else if (fields.metaTitle.length < LIMITS.titleMinChars) issues.push(`metaTitle is only ${fields.metaTitle.length} characters: use 30 to 60.`);
  if (!fields.metaDescription) issues.push('metaDescription is empty.');
  else if (descriptionPx > LIMITS.descriptionPx) issues.push(`metaDescription is ${fields.metaDescription.length} characters (${descriptionPx}px) and will be cut off: keep it to about 150 characters.`);
  else if (fields.metaDescription.length < 100) issues.push(`metaDescription is only ${fields.metaDescription.length} characters: use 120 to 155.`);
  if (!fields.focusKeyword) issues.push('focusKeyword is empty.');
  else if (fields.metaTitle && !hasKeyword(fields.metaTitle, fields.focusKeyword)) issues.push(`The focus keyphrase "${fields.focusKeyword}" isn't in metaTitle.`);
  const lower = (s) => s.toLowerCase();
  for (const other of model.all) {
    if (other.sourceFile === page.sourceFile || other.noindex === true) continue;
    const s = pageSeo(other, site);
    if (fields.metaTitle && lower(s.title) === lower(fields.metaTitle)) issues.push(`metaTitle is the same as ${other.url}'s.`);
    if (fields.metaDescription && lower(s.description) === lower(fields.metaDescription)) issues.push(`metaDescription is the same as ${other.url}'s.`);
  }
  return issues;
}

/** Asks Claude, then asks again to fix what's wrong (up to MAX_ATTEMPTS); the best attempt wins. */
async function suggest(page, direction) {
  const keepKeyword = Boolean(page.focusKeyword) && !direction;
  const { systemPrompt, userPrompt } = buildPrompts(page, direction, keepKeyword);
  if (!apiKey) {
    console.log(`\n----- system prompt -----\n${systemPrompt}\n\n----- user prompt -----\n${userPrompt}\n`);
    return null;
  }

  const messages = [{ role: 'user', content: userPrompt }];
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await requestClaude({ systemPrompt, messages });
    if (reply.stopReason === 'refusal') throw new Error('Claude declined this request. Rephrase the direction and try again.');
    const fields = parseReply(reply.text);
    if (fields && keepKeyword) fields.focusKeyword = String(page.focusKeyword);
    const issues = suggestionIssues(fields, page);
    attempts.push({ fields, issues });
    console.log(`  attempt ${attempt}: ${issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'}` : 'good'}`);
    if (!issues.length) break;
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `Fix these and reply with the corrected JSON object only:\n- ${issues.join('\n- ')}` });
  }
  // Fewest issues wins; on a tie, the later (corrected) attempt.
  const usable = attempts.filter((a) => a.fields);
  if (!usable.length) return { fields: null, issues: attempts.at(-1).issues, attempts };
  const best = usable.reduce((a, b) => (b.issues.length <= a.issues.length ? b : a));
  return { fields: best.fields, issues: best.issues, attempts };
}

function summaryOf(fields) {
  return [
    fields.metaTitle && `SEO title: "${fields.metaTitle}"`,
    fields.metaDescription && `Meta description: "${fields.metaDescription}"`,
    fields.focusKeyword && `Focus keyphrase: "${fields.focusKeyword}"`,
  ].filter(Boolean);
}

function writeProposal({ page, direction, fields, content, problems, warnings, summary }) {
  const target = insideRepo(proposalOut, '--proposal-out');
  if (!target) return;
  const proposal = {
    file: rel(page.sourceFile),
    mode: 'seo',
    instruction: direction || 'wrote the SEO title, description and focus keyphrase',
    images: [],
    content,
    seo: fields,
    problems,
    warnings,
    ...(summary.length ? { summary } : {}),
    model: CLAUDE_MODEL,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(target, `${JSON.stringify(proposal, null, 2)}\n`);
  console.log(`\n  Saved the proposal to ${rel(path.relative(ROOT, target))}`);
}

async function claudeFor(page, direction, { single }) {
  console.log(`\n  Page: ${page.url}  (${rel(page.sourceFile)})`);
  const result = await suggest(page, direction);
  if (!result) return { code: dryRun ? 0 : 1 };
  const { fields, issues } = result;
  if (!fields) {
    console.error(`  Claude's reply couldn't be used: ${issues.join(' ')}`);
    return { code: 3 };
  }
  const problems = [!fields.metaTitle && 'no SEO title', !fields.metaDescription && 'no meta description'].filter(Boolean);
  const warnings = issues.filter((i) => !/is empty\.$/.test(i));
  const { full, original, updated } = writeFields(page, fields);

  const seo = pageSeo({ ...page, ...fields }, site);
  serpLines(page, seo).forEach((line, i, lines) => console.log(`    ${i === 0 ? '┌' : i === lines.length - 1 ? '└' : '│'} ${line}`));
  console.log(`    focus keyphrase: ${fields.focusKeyword || '(none)'}`);
  for (const warning of warnings) console.log(`    warning: ${warning}`);

  const summary = summaryOf(fields);
  if (dryRun) {
    if (single && proposalOut) writeProposal({ page, direction, fields, content: updated, problems, warnings, summary });
    return { code: 0 };
  }
  if (problems.length) {
    console.error(`  Not written: ${problems.join(', ')}.`);
    return { code: 3 };
  }
  if (updated === original) {
    console.log('    Already set to this.');
    return { code: 0 };
  }
  fs.writeFileSync(full, updated);
  knowledge?.recordWork({ command: 'seo:claude', file: rel(page.sourceFile), instruction: direction || 'wrote the SEO title, description and focus keyphrase', summary });
  console.log(`    Wrote ${rel(page.sourceFile)}`);
  // The next page's prompt and duplicate checks see this one's new title and description.
  model = load();
  return { code: 0, written: true };
}

async function runClaude(target, direction) {
  if (!apiKey && !dryRun) {
    console.error('\n  ANTHROPIC_API_KEY is not set. Add it to .env or your environment.\n');
    return 1;
  }
  console.log(`  Model: ${CLAUDE_MODEL}`);
  if (target) {
    const { code } = await claudeFor(target, direction, { single: true });
    console.log('');
    return code;
  }

  const force = Boolean(flag('force'));
  const pages = model.all.filter((p) => force || (p.noindex !== true && (!p.metaTitle || !p.metaDescription)));
  if (!pages.length) {
    console.log('\n  Every page has its own SEO title and description. Add --force to write them again.\n');
    return 0;
  }
  console.log(`  ${pages.length} page${pages.length === 1 ? '' : 's'} to write${force ? '' : ' (pages without their own SEO title or description; --force for all)'}`);
  let failed = 0;
  let written = 0;
  for (const page of pages) {
    try {
      const result = await claudeFor(page, direction, { single: false });
      if (result.code) failed++;
      if (result.written) written++;
    } catch (error) {
      failed++;
      console.error(`    Failed: ${error.message}`);
      if (/declined|401|403/.test(error.message)) break;
    }
  }
  console.log(`\n  ${dryRun ? 'Previewed' : 'Wrote'} ${dryRun ? pages.length - failed : written} page${(dryRun ? pages.length - failed : written) === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
  if (!dryRun && written) console.log('  Review with: git diff -- content/');
  console.log('');
  return failed && !written ? 3 : 0;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const [pageArg, directionArg] = positional;
  const all = Boolean(flag('all'));
  const page = pageArg && !all ? findPage(pageArg) : null;
  if (pageArg && !all && !page) {
    console.error(`\n  No page matches "${pageArg}". Use a slug, a URL or a path under content/.\n`);
    return 1;
  }
  const direction = String((all ? pageArg : directionArg) || '').trim();

  if (flag('claude')) {
    if (!page && !all) {
      console.error('\n  Name a page, or add --all for every page: node scripts/seo.js <page> --claude\n');
      return 1;
    }
    if (all && proposalOut) {
      console.error('\n  --proposal-out works for one page only.\n');
      return 1;
    }
    return runClaude(page, direction);
  }

  const setting = Object.keys(FIELD_FLAGS).some((name) => flag(name) !== undefined) || flag('noindex') || flag('index');
  if (setting) {
    if (!page) {
      console.error('\n  Name the page to set: node scripts/seo.js <page> --title="…"\n');
      return 1;
    }
    return setByHand(page);
  }

  const results = audit().filter((r) => !page || r.page.sourceFile === page.sourceFile);
  if (flag('json')) console.log(JSON.stringify(reportJson(results), null, 2));
  else if (!results.length) console.log('\n  No pages yet. Add some with npm run new or npm run scaffold.\n');
  else printAudit(results, { preview: Boolean(page) || Boolean(flag('preview')) });
  return 0;
}

main()
  .then((code) => {
    if (code === 0 || code === 3) saveReports();
    process.exit(code);
  })
  .catch((error) => {
    console.error(`\n  SEO failed: ${error.message}\n`);
    process.exit(1);
  });
