/**
 * Loads everything under content/ into one in-memory model:
 *
 *   site      site.config.json + derived helpers
 *   data      every JSON file in content/data (by filename)
 *   pages     content/pages/*.md
 *   products  content/products/*.md
 *   services  content/services/*.md
 *   blog      content/blog/*.md        (drafts and future dates excluded in prod)
 *   caseStudies content/case-studies/*.md
 *
 * Adding a new collection means adding an entry to site.config.json -> collections.
 * No build code needs to change.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, renderMarkdown, excerpt, readingTime } from './markdown.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const paths = {
  root: ROOT,
  content: path.join(ROOT, 'content'),
  data: path.join(ROOT, 'content/data'),
  templates: path.join(ROOT, 'templates'),
  partials: path.join(ROOT, 'templates/partials'),
  layouts: path.join(ROOT, 'templates/layouts'),
  assets: path.join(ROOT, 'assets'),
  dist: path.join(ROOT, 'dist'),
};

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export function formatDate(value, locale = 'en-GB') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Every .md file under dir, recursing into subdirectories, as paths relative
 * to dir with forward slashes (e.g. "who-sees-what/how-to-use.md"). Lets a
 * collection mirror a nested URL tree as real nested folders on disk. */
function listMarkdown(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdown(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

export function applyUrlPattern(pattern, slug) {
  const url = pattern.replace(':slug', slug);
  return url.endsWith('/') || url.endsWith('.html') ? url : `${url}/`;
}

/** Marks the nav item (and its children) matching `currentUrl` active, for
 * `aria-current` and highlighting. Shared by the main build and anything else
 * that renders the header/footer partials outside the normal page pipeline
 * (e.g. scaffold-schedule.js chroming a standalone static page). */
export function markActive(items, currentUrl) {
  return items.map((item) => {
    const children = item.children ? markActive(item.children, currentUrl) : [];
    const active =
      item.url === currentUrl ||
      (item.url && item.url !== '/' && currentUrl.startsWith(item.url)) ||
      children.some((child) => child.active);
    return { ...item, children, active, ariaCurrent: active ? ' aria-current="page"' : '' };
  });
}

/** Turn a URL into the file written inside dist/ */
export function outputPathFor(url) {
  if (url === '/') return 'index.html';
  if (url.endsWith('.html')) return url.replace(/^\//, '');
  return `${url.replace(/^\/|\/$/g, '')}/index.html`;
}

function loadEntry({ file, dir, collection, config, site }) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const dirPart = path.dirname(file); // "." for a top-level file
  const baseSlug = path
    .basename(file, '.md')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const derivedSlug = dirPart === '.' ? baseSlug : `${dirPart}/${baseSlug}`;
  const slug = data.slug || derivedSlug;
  const rendered = renderMarkdown(body);
  const url = data.url || applyUrlPattern(config.urlPattern, slug);

  return {
    ...data,
    collection,
    sourceFile: path.relative(ROOT, path.join(dir, file)),
    slug,
    url,
    absoluteUrl: `${site.url.replace(/\/$/, '')}${url}`,
    layout: data.layout || config.layout,
    title: data.title || slug,
    description: data.description || excerpt(body),
    excerpt: data.excerpt || excerpt(body, 190),
    body,
    content: rendered.html,
    headings: rendered.headings,
    readingTime: readingTime(body),
    date: data.date || null,
    dateFormatted: formatDate(data.date),
    draft: Boolean(data.draft),
    tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
    featured: Boolean(data.featured),
    order: typeof data.order === 'number' ? data.order : 999,
  };
}

function sortEntries(entries, sortSpec) {
  const [key, direction = 'asc'] = String(sortSpec || 'order').split(':');
  const factor = direction === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return a.title.localeCompare(b.title);
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return (av > bv ? 1 : -1) * factor;
  });
}

/** Build the nav/footer trees, expanding any auto-generated collection groups. */
function buildNavigation(navConfig, collections, site) {
  const expand = (items = []) =>
    items.flatMap((item) => {
      if (item.type === 'collection') {
        const entries = (collections[item.collection] || [])
          .filter((entry) => entry.navHidden !== true)
          .slice(0, item.limit || 99);
        const children = entries.map((entry) => ({
          label: entry.navLabel || entry.shortTitle || entry.title,
          url: entry.url,
          description: entry.tagline || entry.excerpt,
        }));
        if (item.label) return [{ label: item.label, url: item.url || null, children }];
        return children;
      }
      return [{ ...item, children: item.children ? expand(item.children) : [] }];
    });

  const withActive = (items) =>
    items.map((item) => ({
      ...item,
      hasChildren: Boolean(item.children && item.children.length),
      external: /^https?:\/\//.test(item.url || '') && !String(item.url).includes(site.domain),
      children: item.children ? withActive(item.children) : [],
    }));

  return {
    header: {
      items: withActive(expand(navConfig.header?.items || [])),
      cta: navConfig.header?.cta || null,
    },
    footer: (navConfig.footer || []).map((column) => ({
      ...column,
      links: withActive(expand(column.links || [])),
    })),
    legal: withActive(expand(navConfig.legal || [])),
    appearance: navAppearance(navConfig.appearance, site.brand),
  };
}

const HEADER_THEMES = ['light', 'dark', 'brand'];
const HEADER_LAYOUTS = ['right', 'center', 'left'];
const FOOTER_THEMES = ['dark', 'light', 'brand'];

/**
 * How the header and footer look, from navigation.json → appearance, with
 * every value checked and defaulted (the template's own look when it's
 * missing). The partials put `theme`, `tone` and `layout` in data attributes
 * and style them with Tailwind variants, since templates can't compare
 * values. `tone` is "dark" for any theme with light text on it, and `logo` is
 * the logo for that background (the dark one when there is one), or "" to
 * show the icon and name.
 */
function navAppearance(config, brand = {}) {
  const header = config?.header || {};
  const footer = config?.footer || {};
  const headerTheme = HEADER_THEMES.includes(header.theme) ? header.theme : 'light';
  const footerTheme = FOOTER_THEMES.includes(footer.theme) ? footer.theme : 'dark';
  const logoOn = (tone) => (tone === 'dark' ? brand.logoDark || brand.logo : brand.logo) || '';
  const headerTone = headerTheme === 'light' ? 'light' : 'dark';
  const footerTone = footerTheme === 'light' ? 'light' : 'dark';
  return {
    header: {
      theme: headerTheme,
      tone: headerTone,
      layout: HEADER_LAYOUTS.includes(header.layout) ? header.layout : 'right',
      sticky: header.sticky !== false,
      logo: logoOn(headerTone),
    },
    footer: {
      theme: footerTheme,
      tone: footerTone,
      showTagline: footer.showTagline !== false,
      showContact: footer.showContact !== false,
      copyright: typeof footer.copyright === 'string' ? footer.copyright.trim() : '',
      logo: logoOn(footerTone),
    },
  };
}

/**
 * The prefix every root-relative href/src is written with. In development the
 * site is often served from the project directory, so dist/ is at /dist. On a
 * GitHub Pages project site it's at /<repo>, which the deploy workflow passes
 * as BASE_PATH (empty on a custom domain).
 */
export function basePath() {
  if (process.env.NODE_ENV === 'development') return '/dist';
  return (process.env.BASE_PATH || '').replace(/\/+$/, '');
}

export function loadSite({ includeDrafts = false, includeFuture = false } = {}) {
  const site = readJson(path.join(ROOT, 'site.config.json'));
  // The deploy workflow passes the address it publishes to (a github.io URL
  // until a custom domain is set), for canonical links, the sitemap and RSS.
  if (process.env.SITE_URL) site.url = process.env.SITE_URL.replace(/\/+$/, '');
  site.domain = site.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  site.year = new Date().getFullYear();
  site.buildTime = new Date().toISOString();

  const data = {};
  if (fs.existsSync(paths.data)) {
    for (const file of fs.readdirSync(paths.data).filter((f) => f.endsWith('.json'))) {
      data[file.replace(/\.json$/, '')] = readJson(path.join(paths.data, file));
    }
  }

  const collections = {};
  for (const [name, config] of Object.entries(site.collections)) {
    const dir = path.join(ROOT, config.dir);
    let entries = listMarkdown(dir).map((file) =>
      loadEntry({ file, dir, collection: name, config, site }),
    );

    if (!includeDrafts) entries = entries.filter((entry) => !entry.draft);
    if (!includeFuture) {
      const now = Date.now();
      entries = entries.filter((entry) => !entry.date || new Date(entry.date).getTime() <= now);
    }

    entries = sortEntries(entries, config.sort);
    entries.forEach((entry, index) => {
      entry.previous = entries[index - 1] ? pick(entries[index - 1]) : null;
      entry.next = entries[index + 1] ? pick(entries[index + 1]) : null;
    });
    collections[name] = entries;
  }

  const all = Object.values(collections).flat();
  const byUrl = new Map(all.map((entry) => [entry.url, entry]));
  const pageExists = linkTarget(byUrl);

  // Navigation may still name pages this site doesn't have (the template's own, after a site
  // tree replaced them): those links are left out and listed in nav.missing, never built broken.
  const nav = pruneNavigation(buildNavigation(data.navigation || { header: { items: [] } }, collections, site), pageExists);

  return { site, data, collections, nav, all, byUrl, pageExists };
}

// Files the build writes besides pages, which internal links may point at.
const GENERATED_FILES = new Set(['/sitemap.xml', '/rss.xml', '/robots.txt', '/search-index.json']);

/**
 * Whether an internal link resolves: to a page, a generated file, or a file in
 * assets/ or static/. External links, mailto:, anchors and empty values aren't
 * internal, so they count as resolving.
 */
function linkTarget(byUrl) {
  return (url) => {
    if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return true;
    const bare = url.split(/[?#]/)[0] || '/';
    if (GENERATED_FILES.has(bare)) return true;
    const trimmed = bare.length > 1 ? bare.replace(/\/$/, '') : bare;
    if ([bare, `${trimmed}/`, trimmed, `${trimmed}.html`].some((u) => byUrl.has(u))) return true;
    const rel = decodeURIComponent(bare.slice(1));
    if (!rel || rel.split('/').includes('..')) return false;
    return (rel.startsWith('assets/') && fs.existsSync(path.join(ROOT, rel))) || fs.existsSync(path.join(ROOT, 'static', rel));
  };
}

/**
 * The navigation without links to pages that don't exist. A dropdown whose own
 * page is missing keeps its children with no link of its own (url null); one
 * left with nothing goes, as does an emptied footer column. Returns the nav with
 * `missing`: [{ where, label, url }].
 */
function pruneNavigation(nav, exists) {
  const missing = [];
  const prune = (items, where) =>
    items.flatMap((item) => {
      const children = prune(item.children || [], where);
      const ok = !item.url || exists(item.url);
      if (!ok) missing.push({ where, label: item.label, url: item.url });
      if (!ok && !children.length) return [];
      return [{ ...item, url: ok ? item.url : null, children, hasChildren: children.length > 0 }];
    });
  const cta = nav.header.cta && !exists(nav.header.cta.url) ? null : nav.header.cta;
  if (nav.header.cta && !cta) missing.push({ where: 'header button', label: nav.header.cta.label, url: nav.header.cta.url });
  return {
    header: { items: prune(nav.header.items, 'header'), cta },
    footer: nav.footer
      .map((column) => ({ ...column, links: prune(column.links, `footer "${column.title}"`) }))
      .filter((column) => column.links.length),
    legal: prune(nav.legal, 'footer legal links'),
    appearance: nav.appearance,
    missing,
  };
}

/** Lightweight version of an entry, safe to embed in other entries. */
export function pick(entry) {
  if (!entry) return null;
  return {
    title: entry.title,
    shortTitle: entry.shortTitle || entry.title,
    tagline: entry.tagline || '',
    url: entry.url,
    slug: entry.slug,
    excerpt: entry.excerpt,
    description: entry.description,
    image: entry.image || '',
    logo: entry.logo || '',
    icon: entry.icon || '',
    category: entry.category || '',
    date: entry.date,
    dateFormatted: entry.dateFormatted,
    readingTime: entry.readingTime,
    tags: entry.tags,
    price: entry.price || '',
    badge: entry.badge || '',
    collection: entry.collection,
    highlights: entry.highlights || [],
  };
}
