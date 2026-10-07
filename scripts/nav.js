#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, loadSite } from './lib/content.js';
import {
  slugify,
  sampleEntryTemplate,
  indexPageTemplate,
} from './lib/nav-scaffold.js';

const [, , label, url, ...args] = process.argv;
const navigationPath = path.join(ROOT, 'content/data/navigation.json');
const sitePath = path.join(ROOT, 'site.config.json');
const contentPath = path.join(ROOT, 'content');
const pagesPath = path.join(ROOT, 'content/pages');

const option = (name) => {
  const value = args.find((arg) => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : undefined;
};

let collection = option('collection');
const plain = args.includes('--plain');
const limit = option('limit') === undefined ? 8 : Number(option('limit'));
const extra = args.filter(
  (arg) => !arg.startsWith('--collection=') && !arg.startsWith('--limit=') && arg !== '--plain',
);

function normaliseUrl(value) {
  const gitBashPath = value.match(/^[A-Za-z]:[\\/].*[\\/]Git[\\/](.+)$/i);
  if (gitBashPath) return `/${gitBashPath[1].replaceAll('\\', '/')}`;
  return value;
}

function createSampleEntry(name, label) {
  const dir = path.join(contentPath, name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.md'))) {
    return { file: null, created: false };
  }

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sample-entry.md');
  fs.writeFileSync(file, sampleEntryTemplate(name, label));
  return { file, created: true };
}

function createIndexPage(navUrl, label, name) {
  const slug = navUrl.replace(/^\/|\/$/g, '').replace(/\.html$/, '');
  if (!slug || slug.includes('/')) {
    return { file: null, created: false, skipped: true };
  }

  const file = path.join(pagesPath, `${slug}.md`);
  if (fs.existsSync(file)) return { file, created: false };

  fs.mkdirSync(pagesPath, { recursive: true });
  fs.writeFileSync(file, indexPageTemplate(label, slug, name));
  return { file, created: true };
}

function addCollectionConfig(name, label, navUrl) {
  const site = readJson(sitePath);
  if (site.collections[name]) return { created: false };

  const trimmedUrl = navUrl.replace(/\.html$/, '').replace(/\/$/, '');
  site.collections[name] = {
    dir: `content/${name}`,
    urlPattern: `${trimmedUrl}/:slug.html`,
    layout: 'page',
    sort: 'order',
    index: { label, url: navUrl, layout: 'page' },
  };
  fs.writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`);
  return { created: true };
}

if (!label || !url || extra.length) {
  console.error(
    '\n  Usage: npm run nav:add -- "Label" "/path.html" [--collection=name] [--limit=8] [--plain]\n',
  );
  process.exit(1);
}

const normalisedUrl = normaliseUrl(url);

if (!normalisedUrl.startsWith('/') && !/^https?:\/\//.test(normalisedUrl)) {
  console.error('\n  URL must be root-relative or start with http:// or https://.\n');
  process.exit(1);
}

// A brand-new, single-segment root path scaffolds itself into a working
// collection so `npm run check` never breaks on a nav item with nowhere to
// go — no need to remember --collection=. Pass --plain to opt out, or point
// the link at a page that already exists (or a multi-segment/external URL)
// to add a bare link instead.
if (!collection && !plain && normalisedUrl.startsWith('/')) {
  const segments = normalisedUrl.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segments.length === 1) {
    const { byUrl } = loadSite({ includeDrafts: true, includeFuture: true });
    if (!byUrl.has(normalisedUrl)) {
      collection = slugify(segments[0]);
    }
  }
}

if (collection && (!Number.isInteger(limit) || limit < 1)) {
  console.error('\n  --limit must be a positive whole number.\n');
  process.exit(1);
}

const navigation = readJson(navigationPath);

if (
  navigation.header.items.some(
    (item) =>
      item.label.toLowerCase() === label.toLowerCase() || item.url.toLowerCase() === normalisedUrl.toLowerCase(),
  )
) {
  console.error(`\n  Navbar item already exists: ${label} (${normalisedUrl})\n`);
  process.exit(1);
}

const item = { label, url: normalisedUrl };
let sampleEntry;
let indexPage;
let collectionConfig;

if (collection) {
  Object.assign(item, { type: 'collection', collection, limit });

  const site = readJson(sitePath);
  const existingConfig = site.collections[collection];
  collectionConfig = existingConfig ? { created: false } : addCollectionConfig(collection, label, normalisedUrl);
  sampleEntry = createSampleEntry(collection, label);
  indexPage = createIndexPage(normalisedUrl, label, collection);
}

navigation.header.items.push(item);
fs.writeFileSync(navigationPath, `${JSON.stringify(navigation, null, 2)}\n`);

console.log(`\n  Added "${label}" -> ${normalisedUrl} to the header navbar.`);
console.log(`  Updated ${path.relative(ROOT, navigationPath)}\n`);

if (collectionConfig) {
  console.log(
    collectionConfig.created
      ? `  Added "${collection}" to site.config.json -> collections.`
      : `  Preserved existing site.config.json -> collections.${collection}.`,
  );
  console.log(
    sampleEntry.created
      ? `  Created content/${collection}/sample-entry.md so the collection isn't empty.`
      : `  Preserved existing content in content/${collection}/.`,
  );
  if (indexPage.skipped) {
    console.log(
      `  Skipped the listing page: "${normalisedUrl}" isn't a single top-level path, add a page there by hand that loops {{# each ${collection} }}.`,
    );
  } else {
    console.log(
      indexPage.created
        ? `  Created ${path.relative(ROOT, indexPage.file)} to serve ${normalisedUrl}.`
        : `  Preserved existing ${path.relative(ROOT, indexPage.file)}.`,
    );
  }
  console.log('\n  Run `npm run check` to build and verify the new collection.\n');
}