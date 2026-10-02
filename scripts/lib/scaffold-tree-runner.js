/**
 * Core logic for turning one tree file into scaffolded content files.
 * Shared by scripts/scaffold-tree.js (run one tree file directly) and
 * scripts/scaffold-schedule.js (run whichever tree files are due today).
 *
 * Path -> file mapping:
 *   index.html                                  -> content/pages/home.md          (url "/")
 *   404.html                                     -> content/pages/404.md           (noindex, navHidden)
 *   about.html                                    -> content/pages/about.md
 *   products/index.html                           -> content/pages/products.md     (the collection's listing page)
 *   products/some-app.html                        -> content/products/some-app.md
 *   services/who-sees-what/index.html              -> content/services/who-sees-what/index.md (slug "who-sees-what")
 *   services/who-sees-what/how-to-use.html          -> content/services/who-sees-what/how-to-use.md
 *
 * The first path segment is matched against each collection's directory name
 * in site.config.json; anything that doesn't match becomes a standalone page
 * under content/pages/, nested exactly as written. No Claude/API calls here:
 * structure is entirely mechanical, which is also why it costs no tokens.
 *
 * Predefined content: if a file exists at
 * <dir of the tree file>/site-tree-content/<path>.md for a given tree path
 * (e.g. scripts/site-tree-content/contact.md for the "contact.html" line in
 * scripts/site-tree.md), its contents are written verbatim instead of the
 * generic frontmatter skeleton — the instruction text after " — " is ignored
 * for that path. Any path with no matching file scaffolds exactly as before.
 *
 * Global stylesheets: a line whose path ends in ".css" (e.g. "- css/style.css")
 * declares one of the design's shared stylesheets. It's scaffolded to
 * styles/global/<path> (from site-tree-content/<path> verbatim if that exists,
 * otherwise a starter comment), and scripts/edit-page.js --keep-styles applies
 * every declared one to each page it converts. See globalStylesheets().
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, slugify } from './content.js';
import { scaffoldBody } from './scaffold-templates.js';
import { generateChangelog } from './changelog.js';

/* -------------------------------------------------------------- parse tree */

/** Where a global stylesheet declared in the tree lives in the repo. */
export const GLOBAL_CSS_DIR = 'styles/global';

/**
 * A tree path, or { why } when the line isn't one. Pages may contain spaces
 * ("about 2.html" becomes the slug "about-2"), and a path without an extension
 * ("thank-you", an old site's clean URL) is the page "thank-you.html". A
 * stylesheet path is a file name the repo can hold as it is. A folder heading
 * ("css/") is { why: null }: not a path, and not worth a note.
 */
function treePath(raw) {
  const value = raw.trim().replace(/^\/+/, '');
  if (!value || value.endsWith('/')) return { why: null };
  if (value.split('/').some((seg) => !seg.trim() || seg === '.' || seg === '..')) return { why: 'not a relative path' };
  if (/\.css$/i.test(value)) return /^[\w./-]+$/.test(value) ? { path: value } : { why: 'a stylesheet path may only use letters, digits, "_", "-", "." and "/"' };
  if (/\.html$/i.test(value)) return { path: value };
  if (/\.[a-z0-9]+$/i.test(path.posix.basename(value))) return { why: 'only .html pages and .css stylesheets are scaffolded' };
  return { path: `${value}.html`, assumed: true };
}

/** The tree's page and stylesheet lines. Lines that are skipped, or read as something else, go in `notes`. */
function parseTree(text, notes = []) {
  const nodes = [];
  const seen = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (!bullet) continue;

    const rest = bullet[1].trim();
    const split = /^(.+?)\s+(?:—|--)\s+(.*)$/.exec(rest);
    const { path: rawPath, why, assumed } = treePath(split ? split[1] : rest);
    const instruction = split ? split[2].trim() : '';
    if (!rawPath) {
      if (why) notes.push(`"${rest}" skipped: ${why}`);
      continue;
    }
    const key = rawPath.toLowerCase();
    if (seen.has(key)) {
      notes.push(`"${rest}" skipped: ${rawPath} is already in the tree`);
      continue;
    }
    seen.add(key);
    if (assumed) notes.push(`"${rest}" has no extension, so it's the page ${rawPath}`);

    nodes.push({ rawPath, instruction, kind: /\.css$/i.test(rawPath) ? 'css' : 'page' });
  }
  return nodes;
}

/* ------------------------------------------------------------ resolve path */

function collectionsByDirSlug(site) {
  const map = new Map();
  for (const [key, cfg] of Object.entries(site.collections)) {
    map.set(path.basename(cfg.dir), { key, cfg });
  }
  return map;
}

function titleFromSlug(slug) {
  const words = slug.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Absolute path to the predefined content file for one tree path, if any (a stylesheet's keeps its name). */
function predefinedContentFile(treeFile, rawPath) {
  return path.join(path.dirname(treeFile), 'site-tree-content', rawPath.replace(/\.html$/, '.md'));
}

/**
 * The global stylesheets the site tree declares, in tree order:
 * [{ path: "css/style.css", file: "styles/global/css/style.css", exists }].
 */
export function globalStylesheets(treeFile = path.join(ROOT, 'scripts/site-tree.md')) {
  if (!fs.existsSync(treeFile)) return [];
  return parseTree(fs.readFileSync(treeFile, 'utf8'))
    .filter((node) => node.kind === 'css')
    .map(({ rawPath }) => {
      const file = `${GLOBAL_CSS_DIR}/${rawPath}`;
      return { path: rawPath, file, exists: fs.existsSync(path.join(ROOT, file)) };
    });
}

/** What a newly scaffolded global stylesheet holds until the design's CSS is put in. */
function starterStylesheet(rawPath) {
  const name = path.posix.basename(rawPath);
  return `/* Global stylesheet "${rawPath}", declared in scripts/site-tree.md.
   Put the design's shared CSS here (the file its pages link as ${name}), or
   upload ${name} with the next page you convert with --keep-styles and it's
   saved here. Every page converted with --keep-styles that links ${name}
   gets this file, scoped to that page, in the place its <link> had. Convert
   a page again to pick up later changes. */
`;
}

function segmentsFor(rawPath) {
  return rawPath
    .replace(/\.html$/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg === 'index' || seg === '404' ? seg : slugify(seg)));
}

/** Maps one tree path to { type, file, slug, urlOverride, title, layout, extra } */
function resolveNode(rawPath, site, dirSlugMap) {
  const segments = segmentsFor(rawPath);

  if (segments.length === 1 && segments[0] === 'index') {
    return {
      type: 'pages',
      file: 'content/pages/home.md',
      slug: 'home',
      urlOverride: '/',
      layout: 'home',
      title: site.tagline || site.name,
    };
  }

  const [first, ...rest] = segments;
  const hit = dirSlugMap.get(first);

  if (hit && rest.length) {
    const { key, cfg } = hit;

    if (rest.length === 1 && rest[0] === 'index') {
      const url = cfg.index?.url || `/${first}.html`;
      return {
        type: 'pages',
        file: `content/pages/${first}.md`,
        slug: first,
        urlOverride: url,
        layout: cfg.index?.layout || `list-${first}`,
        title: cfg.index?.label || titleFromSlug(first),
      };
    }

    const last = rest[rest.length - 1];
    if (last === 'index') {
      const inner = rest.slice(0, -1);
      return {
        type: key,
        file: `${cfg.dir}/${inner.join('/')}/index.md`,
        slug: inner.join('/'),
        title: titleFromSlug(inner[inner.length - 1]),
      };
    }

    return {
      type: key,
      file: `${cfg.dir}/${rest.join('/')}.md`,
      slug: null, // matches the file's own relative path, no override needed
      title: titleFromSlug(last),
    };
  }

  // standalone page, nested exactly as written under content/pages/
  const relPath = segments.join('/');
  const is404 = relPath === '404';
  return {
    type: 'pages',
    file: `content/pages/${relPath}.md`,
    slug: relPath,
    urlOverride: is404 ? '/404.html' : null,
    title: is404 ? 'Page not found' : titleFromSlug(segments[segments.length - 1]),
    extra: is404 ? { noindex: true, navHidden: true } : {},
  };
}

/* --------------------------------------------------------------- generate */

function injectFrontmatterFields(body, fields) {
  // Insert extra "key: value" lines right after the "title:" line (or the
  // opening "---" if there isn't one) so files read the way a hand-written
  // one does, with slug/url/layout grouped near the top.
  const lines = body.split('\n');
  const titleAt = lines.findIndex((line) => /^title:\s/.test(line));
  const insertAt = titleAt >= 0 ? titleAt + 1 : (lines[0] === '---' ? 1 : 0);
  const extraLines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  lines.splice(insertAt, 0, ...extraLines);
  return lines.join('\n');
}

function buildFile(node, site) {
  const today = new Date().toISOString().slice(0, 10);
  let body = scaffoldBody(node.type, {
    title: node.title,
    today,
    defaultAuthor: site.automation.defaultAuthor,
  });

  const fields = { ...(node.extra || {}) };
  if (node.slug) fields.slug = node.slug;
  if (node.urlOverride) fields.url = node.urlOverride;
  if (node.layout) fields.layout = node.layout;

  if (Object.keys(fields).length) body = injectFrontmatterFields(body, fields);
  return body;
}

/* -------------------------------------------------------------------- run */

/**
 * treeFile: absolute path to a tree .md file.
 * Returns { created, skipped, failed, planned }. Logs progress to console
 * as it goes, same as any other scaffold/new/edit script in this repo.
 */
export function runScaffoldTree({ treeFile, dryRun = false, force = false }) {
  if (!fs.existsSync(treeFile)) {
    console.error(`\n  Tree file not found: ${path.relative(ROOT, treeFile)}\n`);
    return { created: 0, skipped: 0, failed: 1, planned: 0 };
  }

  const site = readJson(path.join(ROOT, 'site.config.json'));
  const dirSlugMap = collectionsByDirSlug(site);
  const notes = [];
  const nodes = parseTree(fs.readFileSync(treeFile, 'utf8'), notes);
  for (const note of notes) console.log(`  note: ${note}`);

  if (!nodes.length) {
    console.log(`\n  No page or stylesheet paths found in ${path.relative(ROOT, treeFile)}.\n`);
    return { created: 0, skipped: 0, failed: 0, planned: 0 };
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`\n  Scaffolding from ${path.relative(ROOT, treeFile)} (${nodes.length} path${nodes.length === 1 ? '' : 's'})\n`);

  for (const { rawPath, instruction, kind } of nodes) {
    if (kind === 'css') {
      const file = `${GLOBAL_CSS_DIR}/${rawPath}`;
      const target = path.join(ROOT, file);
      const exists = fs.existsSync(target);
      if (exists && !force) {
        console.log(`  = ${file}  (exists, skipped)`);
        skipped++;
        continue;
      }
      const predefinedFile = predefinedContentFile(treeFile, rawPath);
      const predefined = fs.existsSync(predefinedFile);
      if (dryRun) {
        console.log(`  + ${file}  (global stylesheet)${exists ? '  (would overwrite)' : ''}${predefined ? '  [predefined]' : ''}`);
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, predefined ? fs.readFileSync(predefinedFile, 'utf8') : starterStylesheet(rawPath));
      console.log(`  + ${file}  (global stylesheet)${exists ? '  (overwritten)' : ''}${predefined ? '  (from predefined template)' : ''}`);
      created++;
      continue;
    }

    let node;
    try {
      node = resolveNode(rawPath, site, dirSlugMap);
    } catch (error) {
      console.error(`  ! ${rawPath} — could not resolve: ${error.message}`);
      failed++;
      continue;
    }

    const target = path.join(ROOT, node.file);
    const exists = fs.existsSync(target);

    if (exists && !force) {
      console.log(`  = ${node.file}  (exists, skipped)`);
      skipped++;
      continue;
    }

    const predefinedFile = predefinedContentFile(treeFile, rawPath);
    const predefined = fs.existsSync(predefinedFile);

    if (dryRun) {
      const suffix = predefined ? '  [predefined]' : (instruction ? `\n      instruction: ${instruction}` : '');
      console.log(`  + ${node.file}${exists ? '  (would overwrite)' : ''}${suffix}`);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, predefined ? fs.readFileSync(predefinedFile, 'utf8') : buildFile(node, site));
    console.log(`  + ${node.file}${exists ? '  (overwritten)' : ''}${predefined ? '  (from predefined template)' : ''}`);
    created++;
  }

  if (dryRun) {
    console.log(`\n  Dry run — nothing written. ${nodes.length} path(s) planned.\n`);
  } else {
    console.log(`\n  ${created} created, ${skipped} skipped, ${failed} failed.`);
  }

  return { created, skipped, failed, planned: nodes.length };
}

/** Regenerates CHANGELOG.md in place from git history. */
export function updateChangelog() {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : null;
  fs.writeFileSync(changelogPath, generateChangelog(existing));
}

/** Appends any of `paths` not already listed as a plain top-level bullet at
 * the end of site-tree.md (matching how entries are already added there by
 * hand: no indentation, no instruction), so a page written by
 * scaffold-schedule.js stays reflected in the site's documented page tree.
 * Returns the ones actually added — already-listed paths are left alone,
 * never duplicated. */
export function appendToSiteTree(paths, treeFile = path.join(ROOT, 'scripts/site-tree.md')) {
  if (!paths.length || !fs.existsSync(treeFile)) return [];

  const text = fs.readFileSync(treeFile, 'utf8');
  const existing = new Set(parseTree(text).map((node) => node.rawPath));
  const additions = paths.filter((p) => !existing.has(p));
  if (!additions.length) return [];

  const trimmed = text.replace(/\n+$/, '');
  fs.writeFileSync(treeFile, `${trimmed}\n${additions.map((p) => `- ${p}`).join('\n')}\n`);
  return additions;
}
