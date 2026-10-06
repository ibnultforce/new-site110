#!/usr/bin/env node
/**
 * Builds the whole site into dist/.
 *
 *   node scripts/build.js            production build
 *   node scripts/build.js --drafts   include drafts and future-dated posts
 *
 * Nothing here is page-specific. Pages appear because content files exist,
 * navigation appears because content/data/navigation.json describes it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TemplateEngine, escapeHtml } from './lib/template.js';
import { basePath, loadSite, paths, outputPathFor, pick, markActive, ROOT } from './lib/content.js';
import { renderMarkdown, excerpt } from './lib/markdown.js';
import { buildJsonLd } from './lib/schema.js';
import { pageSeo, seoSettings } from './lib/seo.js';
import { buildCss } from './lib/css.js';

const args = new Set(process.argv.slice(2));
const includeDrafts = args.has('--drafts') || args.has('--dev');

// Every root-relative href/src gets this prefix: /dist in development (the
// site is often previewed from a server that serves this whole project
// directory), /<repo> on a GitHub Pages project site (see basePath()).
// Absolute URLs (canonical, og:*, JSON-LD, sitemap, RSS) are built from
// site.url instead, which already includes that path.
const base = basePath();

function withBase(html) {
  if (!base) return html;
  return html.replace(/((?:href|src)=")\/(?!\/)/g, `$1${base}/`);
}

/* ------------------------------------------------------------------- helpers */

function loadTemplates(engine) {
  for (const [dir, prefix] of [[paths.partials, ''], [paths.layouts, 'layout:']]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
      engine.add(prefix + file.replace(/\.html$/, ''), fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  }
}

/** `transform`, when given, is applied to `.html` files instead of a raw byte
 * copy — used for static/ so its root-relative href/src get the same /dist
 * dev-mode prefix every templated page already gets via withBase(). Without
 * it, a static page's own links (or an injected header/footer's) resolve
 * against the wrong root whenever dist/ is served from within the project
 * directory rather than at the domain root. */
function copyDir(from, to, transform) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, item.name);
    const dest = path.join(to, item.name);
    if (item.isDirectory()) {
      count += copyDir(src, dest, transform);
    } else if (transform && item.name.endsWith('.html')) {
      fs.writeFileSync(dest, transform(fs.readFileSync(src, 'utf8')));
      count++;
    } else {
      fs.copyFileSync(src, dest);
      count++;
    }
  }
  return count;
}

function write(file, contents) {
  const target = path.join(paths.dist, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

/* --------------------------------------------------------------------- build */

function build() {
  const started = Date.now();
  const model = loadSite({ includeDrafts, includeFuture: includeDrafts });
  const { site, data, collections, nav, all, pageExists } = model;
  // Site-wide SEO settings with their defaults, for base.html (verification tags, X handle).
  site.seo = seoSettings(site);

  // Pages the templates link to by name, null when this site doesn't have them (a site tree
  // may replace the template's own pages): the contact page and each collection's listing.
  const pageUrls = { contact: pageExists('/contact.html') ? '/contact.html' : null };
  for (const [name, config] of Object.entries(site.collections)) {
    pageUrls[name] = config.index?.url && pageExists(config.index.url) ? config.index.url : null;
  }

  const engine = new TemplateEngine();
  loadTemplates(engine);

  fs.rmSync(paths.dist, { recursive: true, force: true });
  fs.mkdirSync(paths.dist, { recursive: true });

  const written = [];
  const searchIndex = [];

  const lists = Object.fromEntries(
    Object.entries(collections).map(([name, entries]) => [name, entries.map(pick)]),
  );

  for (const entry of all) {
    // A page converted with its own styles (edit-page.js --keep-styles) replaces the page
    // completely: its HTML shows edge to edge, without its layout's hero, FAQ, call to action
    // or related items, whatever layout it has.
    const imported = typeof entry.stylesheet === 'string' && entry.stylesheet.startsWith('/assets/css/imported/');
    const layoutName = imported ? 'layout:imported' : `layout:${entry.layout}`;
    if (!engine.templates[layoutName]) {
      throw new Error(`${entry.sourceFile}: layout "${entry.layout}" not found in templates/layouts/`);
    }

    // Breadcrumb parents come from the collection config, never hand-written.
    // A listing page that doesn't exist isn't a parent.
    const parent = site.collections[entry.collection]?.index;
    const parentOk = Boolean(parent?.url && pageExists(parent.url));
    const page = {
      ...entry,
      parentLabel: entry.parentLabel || (parentOk ? parent.label : null) || null,
      parentUrl: entry.parentUrl || (parentOk ? parent.url : null),
    };
    // Title, description, canonical, robots and social tags, with the site's defaults (lib/seo.js).
    page.seo = pageSeo(page, site);

    // FAQ entries are filtered from the one shared file by topic. An imported page shows none.
    const allFaq = data.faq?.items || [];
    const topics = page.faqTopics || page.faqTopic;
    const ownFaq = Array.isArray(page.faq) ? page.faq : [];
    const faqItems = imported
      ? []
      : ownFaq.length
        ? ownFaq
        : topics
          ? allFaq.filter((item) => [].concat(topics).includes(item.topic))
          : page.showFaq
            ? allFaq
            : [];

    // Content bodies may use template syntax, so shared values stay in one place.
    const context = {
      site,
      data,
      nav: { ...nav, header: { ...nav.header, items: markActive(nav.header.items, entry.url) } },
      page,
      collections: lists,
      ...lists,
      faqItems,
      pageUrls,
      isHome: entry.url === '/',
      latestPosts: (lists.blog || []).filter((p) => p.url !== entry.url).slice(0, 3),
      recentPosts: (lists.blog || []).filter((p) => p.url !== entry.url).slice(0, 5),
      productPosts: (collections.blog || [])
        .filter((p) => typeof p.relatedProduct === 'string' && p.relatedProduct.startsWith('/products/'))
        .slice(0, 5)
        .map(pick),
      otherProducts: (lists.products || []).filter((p) => p.url !== entry.url),
      otherServices: (lists.services || []).filter((p) => p.url !== entry.url).slice(0, 3),
      relatedItems: [page.relatedProduct]
        .filter(Boolean)
        .map((url) => model.byUrl.get(url))
        .filter(Boolean)
        .map(pick),
    };

    const rerendered = renderMarkdown(engine.renderString(entry.body, context));
    context.page = { ...page, content: rerendered.html, headings: rerendered.headings };

    const main = engine.render(layoutName, context);
    const html = engine.render('base', {
      ...context,
      main,
      jsonLd: buildJsonLd({ site, page: context.page, faqItems }),
    });

    const file = outputPathFor(entry.url);
    write(file, withBase(html));
    written.push({ url: entry.url, file, collection: entry.collection });

    if (entry.noindex !== true) {
      searchIndex.push({
        title: entry.title,
        url: entry.url,
        collection: entry.collection,
        description: entry.description,
        tags: entry.tags,
        text: excerpt(entry.body, 400),
      });
    }
  }

  /* ---------------------------------------------------------------- feeds */

  // A page whose canonical points at another URL asks search engines to index that one instead.
  const indexable = all.filter((e) => e.noindex !== true && !pageSeo(e, site).canonicalElsewhere);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    indexable
      .map((entry) => {
        const lastmod = entry.updated || entry.date || site.buildTime;
        const priority = entry.url === '/' ? '1.0' : entry.collection === 'blog' ? '0.6' : '0.8';
        return `  <url>\n    <loc>${entry.absoluteUrl}</loc>\n    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>\n    <changefreq>${entry.collection === 'blog' ? 'monthly' : 'weekly'}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
      })
      .join('\n') +
    `\n</urlset>\n`;
  write('sitemap.xml', sitemap);

  const posts = (collections.blog || []).slice(0, 25);
  const rss =
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n` +
    `  <title>${escapeHtml(site.name)} Blog</title>\n  <link>${site.url}</link>\n` +
    `  <description>${escapeHtml(site.description)}</description>\n  <language>${site.language || 'en'}</language>\n` +
    `  <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml"/>\n` +
    posts
      .map(
        (post) =>
          `  <item>\n    <title>${escapeHtml(post.title)}</title>\n    <link>${post.absoluteUrl}</link>\n    <guid isPermaLink="true">${post.absoluteUrl}</guid>\n    <pubDate>${new Date(post.date || site.buildTime).toUTCString()}</pubDate>\n    <description>${escapeHtml(post.excerpt)}</description>\n  </item>`,
      )
      .join('\n') +
    `\n</channel>\n</rss>\n`;
  write('rss.xml', rss);

  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);
  write('search-index.json', JSON.stringify(searchIndex));

  // Only when this build is for that domain: a copy published on github.io
  // must not claim the template's domain.
  if (site.deploy?.cname && new URL(site.url).hostname === site.deploy.cname) write('CNAME', `${site.deploy.cname}\n`);
  write('.nojekyll', '');

  const redirects = (data.redirects || [])
    .map((rule) => `${rule.from} ${rule.to} ${rule.status || 301}`)
    .join('\n');
  if (redirects) write('_redirects', `${redirects}\n`);

  // Tailwind scans the templates, so CSS is compiled after pages are rendered
  // and before assets are copied into dist/.
  const css = buildCss({ minify: !includeDrafts });

  const assetCount = copyDir(paths.assets, path.join(paths.dist, 'assets'));
  const staticCount = copyDir(path.join(ROOT, 'static'), paths.dist, withBase);

  /* --------------------------------------------------------------- report */

  const byCollection = written.reduce((acc, item) => {
    acc[item.collection] = (acc[item.collection] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n  ${site.name} — build complete in ${Date.now() - started}ms`);
  console.log(`  ${written.length} pages, ${assetCount + staticCount} static files, ${(css.bytes / 1024).toFixed(1)}kB CSS -> dist/\n`);
  for (const [name, count] of Object.entries(byCollection).sort()) {
    console.log(`    ${String(count).padStart(3)}  ${name}`);
  }
  if (includeDrafts) console.log('\n  (drafts and future-dated posts included)');
  if (base) console.log(`  (internal links prefixed with ${base})`);
  if (nav.missing.length) {
    console.log("\n  Navigation links to pages this site doesn't have, left out of every page:");
    for (const { where, label, url } of nav.missing) console.log(`    ${where}: "${label}" -> ${url}`);
    console.log('  Point them at real pages, or remove them, in content/data/navigation.json.');
  }
  console.log('');

  return { written, model };
}

try {
  build();
} catch (error) {
  console.error(`\n  Build failed: ${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
}
