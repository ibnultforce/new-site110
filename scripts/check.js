#!/usr/bin/env node
/**
 * Validates the built site before it goes anywhere. Run after build.
 *
 *   node scripts/check.js
 *
 * Fails the build on broken internal links or duplicate URLs. Warns on SEO
 * problems (lib/seo.js: missing, overlong or duplicate titles and descriptions,
 * broken social images or canonicals), missing alt text and thin pages.
 * npm run seo shows the full audit, with tips and search-result previews.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, basePath, paths, loadSite } from './lib/content.js';
import { auditPages } from './lib/seo.js';

if (!fs.existsSync(paths.dist)) {
  console.error('\n  dist/ does not exist. Run the build first.\n');
  process.exit(1);
}

const { all, site } = loadSite();
const errors = [];
const warnings = [];

// Mirrors scripts/build.js: every internal href/src is written with the base
// prefix (/dist in development, /<repo> on a Pages project site), so links
// must be stripped back to their real dist/ path before checking they resolve
// to a file that was actually written.
const base = basePath();
function stripBase(href) {
  return base && href.startsWith(base) ? href.slice(base.length) || '/' : href;
}

/* Every URL the built site actually serves */
const served = new Set();
(function walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, `${prefix}/${item.name}`);
    else if (item.name === 'index.html') served.add(`${prefix}/`);
    else served.add(`${prefix}/${item.name}`);
  }
})(paths.dist);

/* Duplicate URLs */
const seen = new Map();
for (const entry of all) {
  if (seen.has(entry.url)) {
    errors.push(`duplicate URL ${entry.url}: ${seen.get(entry.url)} and ${entry.sourceFile}`);
  }
  seen.set(entry.url, entry.sourceFile);
}

/* Internal links and images */
const linkPattern = /(?:href|src)="(\/[^"#?]*)(?:[#?][^"]*)?"/g;
for (const entry of all) {
  const file = path.join(paths.dist, entry.url === '/' ? 'index.html' : entry.url.endsWith('.html') ? entry.url.slice(1) : `${entry.url.slice(1)}index.html`);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');

  for (const [, href] of html.matchAll(linkPattern)) {
    const bare = stripBase(href);
    const target = bare.endsWith('/') || path.extname(bare) ? bare : `${bare}/`;
    if (!served.has(target) && !served.has(bare)) {
      errors.push(`${entry.url} links to missing ${href}`);
    }
  }

  const imagesWithoutAlt = [...html.matchAll(/<img (?![^>]*\balt=)[^>]*>/g)];
  if (imagesWithoutAlt.length) warnings.push(`${entry.url}: ${imagesWithoutAlt.length} image(s) without alt`);
}

/* SEO and content hygiene */
for (const { page, issues } of auditPages(all, site, ROOT)) {
  for (const issue of issues) {
    if (issue.level === 'error' || (issue.level === 'warning' && issue.field !== 'body')) warnings.push(`${page.url}: ${issue.message}`);
  }
}
for (const entry of all) {
  if (entry.collection === 'blog' && !entry.date) errors.push(`${entry.sourceFile}: blog post without a date`);
  if (entry.body.trim().length < 120 && entry.collection !== 'pages') {
    warnings.push(`${entry.url}: very little body content`);
  }
}

/* Report */
const dedupe = (list) => [...new Set(list)];
for (const warning of dedupe(warnings)) console.log(`  warning  ${warning}`);
for (const error of dedupe(errors)) console.error(`  error    ${error}`);

console.log(`\n  ${site.name}: ${all.length} pages checked, ${dedupe(errors).length} errors, ${dedupe(warnings).length} warnings\n`);
process.exit(dedupe(errors).length ? 1 : 0);
