#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from './lib/content.js';
import { sampleEntryTemplate, indexPageTemplate } from './lib/nav-scaffold.js';

const [, , identifier, ...extra] = process.argv;
const navigationPath = path.join(ROOT, 'content/data/navigation.json');
const sitePath = path.join(ROOT, 'site.config.json');
const contentPath = path.join(ROOT, 'content');
const pagesPath = path.join(ROOT, 'content/pages');

function normaliseUrl(value) {
  const gitBashPath = value.match(/^[A-Za-z]:[\\/].*[\\/]Git[\\/](.+)$/i);
  if (gitBashPath) return `/${gitBashPath[1].replaceAll('\\', '/')}`;
  return value;
}

if (!identifier || extra.length) {
  console.error('\n  Usage: npm run nav:remove -- "Label or /path/"\n');
  process.exit(1);
}

function matchesItem(item, target) {
  const targetLower = target.toLowerCase();
  if (item.label.toLowerCase() === targetLower) return true;
  if (item.url.toLowerCase() === targetLower) return true;
  // Tolerate a bare slug typed without leading/trailing slashes, e.g. "tests2".
  const targetPath = `/${target.replace(/^\/|\/$/g, '')}/`.toLowerCase();
  return item.url.toLowerCase() === targetPath;
}

const target = normaliseUrl(identifier);
const navigation = readJson(navigationPath);
const matches = navigation.header.items.filter((item) => matchesItem(item, target));

if (!matches.length) {
  console.error(`\n  Navbar item not found: ${identifier}\n`);
  console.error(`  (matching is case-insensitive on label/URL, but must otherwise match exactly)\n`);
  process.exit(1);
}

if (matches.length > 1) {
  console.error(`\n  More than one navbar item matches: ${identifier}\n`);
  process.exit(1);
}

const [removed] = matches;
navigation.header.items = navigation.header.items.filter((item) => item !== removed);
fs.writeFileSync(navigationPath, `${JSON.stringify(navigation, null, 2)}\n`);

console.log(`\n  Removed "${removed.label}" -> ${removed.url} from the header navbar.`);
console.log(`  Updated ${path.relative(ROOT, navigationPath)}`);

if (removed.type !== 'collection') {
  console.log('');
  process.exit(0);
}

// This nav item pointed at a collection created by nav:add. Only tear down
// the rest of the scaffold (content dir, index page, site.config.json
// entry; layouts are shared, so never) when every generated file for it still matches exactly what was
// created (nothing hand-edited, no real content added) and nothing else
// still references the collection. Otherwise leave the whole thing alone.
const name = removed.collection;

const stillReferenced =
  navigation.header.items.some((item) => item.collection === name) ||
  (navigation.footer || []).some((column) => (column.links || []).some((link) => link.collection === name));

if (stillReferenced) {
  console.log(`  Kept content/${name}/ still referenced elsewhere in navigation.json.\n`);
  process.exit(0);
}

const site = readJson(sitePath);
const config = site.collections[name];

if (!config) {
  console.log('');
  process.exit(0);
}

const dir = path.join(contentPath, name);
const slug = config.index?.url ? config.index.url.replace(/^\/|\/$/g, '') : null;
const indexPagePath = slug ? path.join(pagesPath, `${slug}.md`) : null;

function matchesOrAbsent(filePath, expected) {
  if (!fs.existsSync(filePath)) return true;
  return fs.readFileSync(filePath, 'utf8') === expected;
}

let sampleFile = null;
let contentUntouched = true;
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir);
  if (files.length === 1 && files[0] === 'sample-entry.md') {
    sampleFile = path.join(dir, 'sample-entry.md');
    contentUntouched = fs.readFileSync(sampleFile, 'utf8') === sampleEntryTemplate(name, removed.label);
  } else if (files.length) {
    contentUntouched = false;
  }
}

const scaffoldUntouched =
  contentUntouched &&
  (!indexPagePath || matchesOrAbsent(indexPagePath, indexPageTemplate(removed.label, slug, name)));

if (!scaffoldUntouched) {
  console.log(
    `\n  Kept content/${name}/ and site.config.json -> collections.${name}: something was customised since creation.\n`,
  );
  process.exit(0);
}

const removedPaths = [];
function removeIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
  removedPaths.push(path.relative(ROOT, filePath));
}

if (indexPagePath) removeIfExists(indexPagePath);
if (sampleFile) removeIfExists(sampleFile);
if (fs.existsSync(dir)) {
  fs.rmdirSync(dir);
  removedPaths.push(path.relative(ROOT, dir));
}

delete site.collections[name];
fs.writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`);
removedPaths.push(`site.config.json -> collections.${name}`);

console.log('\n  Also removed:');
for (const file of removedPaths) console.log(`    ${file}`);
console.log('');
