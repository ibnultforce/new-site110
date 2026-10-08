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

/**
 * A file's text, or its proposed text when `overrides` (repo-relative path -> text) has one:
 * build.js --proposal builds the site as it would be with a Claude proposal applied.
 */
function readText(file, overrides) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  return overrides?.has(rel) ? overrides.get(rel) : fs.readFileSync(file, 'utf8');
}

function loadEntry({ file, dir, collection, config, site, overrides }) {
  const raw = readText(path.join(dir, file), overrides);
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
    // The description came from the body's start (lib/seo.js asks for a real one).
    descriptionAuto: !data.description,
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

  // Pages that list themselves (frontmatter `menu`) go after the ones named here, once each.
  const urlsIn = (items) => items.flatMap((item) => [item.url, ...urlsIn(item.children || [])]).filter(Boolean);
  const headerItems = expand(navConfig.header?.items || []);
  const headerUrls = new Set(urlsIn(headerItems));
  headerItems.push(...selfListed(collections, 'header').filter((item) => !headerUrls.has(item.url)));

  const columns = (navConfig.footer || []).map((column) => ({ ...column, links: expand(column.links || []) }));
  const footerOwn = selfListed(collections, 'footer').filter((item) => !columns.some((c) => urlsIn(c.links).includes(item.url)));
  if (footerOwn.length) {
    // Into the column marked "auto": true, else the first, else a new "Pages" column.
    const target = columns.find((c) => c.auto === true) ?? columns[0];
    if (target) target.links.push(...footerOwn);
    else columns.push({ title: 'Pages', links: footerOwn });
  }

  return {
    header: {
      items: withActive(headerItems),
      cta: navConfig.header?.cta || null,
    },
    footer: columns.map((column) => ({ ...column, links: withActive(column.links) })),
    legal: withActive(expand(navConfig.legal || [])),
    appearance: navAppearance(navConfig.appearance, site.brand),
    social: socialLinks(site.social),
  };
}

/**
 * The pages that put themselves in a menu, in order: frontmatter `menu:
 * header`, `footer` or `both` (or a list of those), with an optional
 * `menuLabel` and `menuOrder` (lower first, then by title). Drafts never do.
 */
function selfListed(collections, where) {
  const order = (entry) => (typeof entry.menuOrder === 'number' ? entry.menuOrder : 999);
  const wants = (menu) => [].concat(menu ?? []).some((m) => m === where || m === 'both');
  return Object.values(collections)
    .flat()
    .filter((entry) => !entry.draft && wants(entry.menu))
    .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title))
    .map((entry) => ({ label: entry.menuLabel || entry.navLabel || entry.shortTitle || entry.title, url: entry.url }));
}

// Icons for site.config.json → social, drawn in a 24×24 box with currentColor.
const SOCIAL_ICONS = {
  linkedin: { label: 'LinkedIn', svg: '<path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.6 8.65 21 11.2 21 14.5V21h-4v-5.8c0-1.4-.03-3.2-1.95-3.2-1.95 0-2.25 1.52-2.25 3.1V21H9z"/>' },
  x: { label: 'X', svg: '<path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78zm-1.08 16.17h1.7L7.4 4.74H5.58z"/>' },
  facebook: { label: 'Facebook', svg: '<path fill="currentColor" d="M14 8h3V4h-3c-2.76 0-5 2.24-5 5v2H7v4h2v7h4v-7h3l1-4h-4V9c0-.55.45-1 1-1z"/>' },
  instagram: { label: 'Instagram', svg: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.25" fill="currentColor"/>' },
  youtube: { label: 'YouTube', svg: '<path fill="currentColor" fill-rule="evenodd" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.75 15.02V8.98L15.5 12z"/>' },
  github: { label: 'GitHub', svg: '<path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/>' },
};

/** site.config.json → social as links with icons, in a fixed order; empty ones left out. */
function socialLinks(social = {}) {
  return Object.entries(SOCIAL_ICONS)
    .filter(([name]) => /^https?:\/\//i.test(String(social?.[name] || '').trim()))
    .map(([name, icon]) => ({ name, label: icon.label, url: String(social[name]).trim(), svg: icon.svg }));
}

const HEADER_THEMES = ['light', 'dark', 'brand'];
const HEADER_LAYOUTS = ['right', 'center', 'left'];
const HEADER_STYLES = ['bar', 'floating'];
const FOOTER_THEMES = ['dark', 'light', 'brand'];
const FOOTER_LAYOUTS = ['columns', 'centered', 'minimal'];

/** The footer's call-to-action strip ({ title, text, label, url }), or null without a label and link. */
function footerCta(cta) {
  if (!cta || typeof cta !== 'object') return null;
  const value = (key) => (typeof cta[key] === 'string' ? cta[key].trim() : '');
  if (!value('label') || !value('url')) return null;
  return { title: value('title'), text: value('text'), label: value('label'), url: value('url') };
}

/**
 * How the header and footer look, from navigation.json → appearance, with
 * every value checked and defaulted (the template's own look when it's
 * missing). The partials put `theme`, `tone` and `layout` in data attributes
 * and style them with Tailwind variants, since templates can't compare
 * values. `tone` is "dark" for any theme with light text on it, and `logo` is
 * the logo for that background (the dark one when there is one), or "" to
 * show the icon and name. A header or footer Claude designed (data-designed="claude")
 * picks its own colours, so it uses `logoOnLight` or `logoOnDark` for the
 * background it chose instead.
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
      // "bar" spans the page; "floating" is a rounded bar with space around it.
      style: HEADER_STYLES.includes(header.style) ? header.style : 'bar',
      // See-through over the top of the page (a hero image shows under it) until it's scrolled.
      transparent: header.transparent === true,
      // Lower once the page is scrolled.
      shrink: header.shrink === true,
      logo: logoOn(headerTone),
      logoOnLight: logoOn('light'),
      logoOnDark: logoOn('dark'),
    },
    footer: {
      theme: footerTheme,
      tone: footerTone,
      showTagline: footer.showTagline !== false,
      showContact: footer.showContact !== false,
      // "columns" (logo beside the link columns), "centered" (stacked in the middle) or "minimal" (one row).
      layout: FOOTER_LAYOUTS.includes(footer.layout) ? footer.layout : 'columns',
      showSocial: footer.showSocial !== false,
      cta: footerCta(footer.cta),
      copyright: typeof footer.copyright === 'string' ? footer.copyright.trim() : '',
      logo: logoOn(footerTone),
      logoOnLight: logoOn('light'),
      logoOnDark: logoOn('dark'),
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

export function loadSite({ includeDrafts = false, includeFuture = false, overrides = null } = {}) {
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
      data[file.replace(/\.json$/, '')] = JSON.parse(readText(path.join(paths.data, file), overrides));
    }
  }

  const collections = {};
  for (const [name, config] of Object.entries(site.collections)) {
    const dir = path.join(ROOT, config.dir);
    let entries = listMarkdown(dir).map((file) =>
      loadEntry({ file, dir, collection: name, config, site, overrides }),
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
  const footerCtaLink = nav.appearance.footer.cta;
  if (footerCtaLink && !exists(footerCtaLink.url)) {
    missing.push({ where: 'footer call to action', label: footerCtaLink.label, url: footerCtaLink.url });
    nav.appearance = { ...nav.appearance, footer: { ...nav.appearance.footer, cta: null } };
  }
  return {
    header: { items: prune(nav.header.items, 'header'), cta },
    footer: nav.footer
      .map((column) => ({ ...column, links: prune(column.links, `footer "${column.title}"`) }))
      .filter((column) => column.links.length),
    legal: prune(nav.legal, 'footer legal links'),
    appearance: nav.appearance,
    social: nav.social,
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
