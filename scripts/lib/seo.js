/**
 * Search engine metadata: what each page tells search engines and social
 * networks, and how good that is. Used by scripts/build.js (page.seo, which
 * templates/partials/base.html renders), scripts/check.js (warnings) and
 * scripts/seo.js (the audit, manual edits and Claude's suggestions).
 *
 * A page's own SEO fields are flat frontmatter fields (the parser has no
 * nested maps), all optional:
 *
 *   metaTitle        the whole <title>, used as-is   (default: site.seo.titleTemplate)
 *   metaDescription  the meta description            (default: description, else the body's start)
 *   focusKeyword     the search phrase the page is for; only used by the audit
 *   ogImage          the image shared on social sites (default: image, else brand.defaultOgImage)
 *   ogImageAlt       that image's alt text
 *   canonical        the URL search engines should index instead (absolute or root-relative)
 *   noindex          true keeps the page out of search engines and the sitemap
 *
 * Site-wide settings are site.config.json -> seo (every key optional):
 * titleTemplate and homeTitle ({title}, {site} = shortName, {name},
 * {tagline}), twitterHandle, googleVerification and bingVerification.
 *
 * Widths are measured the way search result previews measure them: Arial at
 * 20px for a title, cut off at about 600px, and at 13px for a description,
 * cut off at about 920px (roughly 155 to 160 characters). The
 * Twinstack web app's SEO tab has a copy of the width table and limits
 * (client/src/lib/seo.ts), so change them in both places.
 */

import fs from 'node:fs';
import path from 'node:path';

/* ----------------------------------------------------------------- widths */

// Arial advance widths for the printable ASCII range (space to ~), in 1/1000 em.
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const OTHER_WIDTHS = { '–': 556, '—': 1000, '‘': 222, '’': 222, '“': 333, '”': 333, '…': 1000, '·': 278, '•': 350, '©': 737, '®': 737, '™': 1000, '£': 556, '€': 556 };

function charWidth(char) {
  const code = char.codePointAt(0);
  if (code >= 32 && code <= 126) return ASCII_WIDTHS[code - 32];
  if (OTHER_WIDTHS[char]) return OTHER_WIDTHS[char];
  // CJK, Hangul and the like are full width; anything else is about an average letter.
  return code >= 0x2e80 ? 1000 : 556;
}

/** The text's width in pixels at this font size. */
export function textWidth(text, sizePx) {
  let units = 0;
  for (const char of String(text || '')) units += charWidth(char);
  return Math.round((units * sizePx) / 1000);
}

export const LIMITS = {
  titleSize: 20,
  titlePx: 600,
  titleMinChars: 30,
  descriptionSize: 13,
  descriptionPx: 920,
  descriptionMinChars: 70,
  keywordMaxChars: 80,
  minWords: 300,
};

/** The text as a search result would show it: cut at a word to fit maxPx, with "..." after. */
export function truncateToWidth(text, sizePx, maxPx) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (textWidth(value, sizePx) <= maxPx) return { text: value, cut: false };
  const room = maxPx - textWidth(' ...', sizePx);
  let out = '';
  for (const char of value) {
    if (textWidth(out + char, sizePx) > room) break;
    out += char;
  }
  const atWord = out.replace(/\s+\S*$/, '');
  return { text: `${(atWord.length > out.length * 0.6 ? atWord : out).replace(/[\s,;:.–—-]+$/, '')} ...`, cut: true };
}

/* --------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  titleTemplate: '{title} | {site}',
  homeTitle: '{name} | {tagline}',
  twitterHandle: '',
  googleVerification: '',
  bingVerification: '',
};

/** site.config.json -> seo with every setting present (the template's defaults when missing). */
export function seoSettings(site) {
  const own = site.seo && typeof site.seo === 'object' ? site.seo : {};
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    settings[key] = typeof own[key] === 'string' && own[key].trim() ? own[key].trim() : fallback;
  }
  settings.twitterHandle = settings.twitterHandle && !settings.twitterHandle.startsWith('@') ? `@${settings.twitterHandle}` : settings.twitterHandle;
  return settings;
}

/** The SEO fields a page's frontmatter may set, in the order they're written. */
export const SEO_FIELDS = ['metaTitle', 'metaDescription', 'focusKeyword', 'ogImage', 'ogImageAlt', 'canonical', 'noindex'];

const str = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '');
const siteRoot = (site) => String(site.url || '').replace(/\/+$/, '');

function absolute(site, value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? `${siteRoot(site)}${value}` : '';
}

/** Whether a canonical value is usable: an http(s) URL or a root-relative path. */
export const validCanonical = (value) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value) || /^\/(?!\/)\S*$/.test(value);

function fill(template, page, site) {
  const values = { title: str(page.title), site: site.shortName || site.name || '', name: site.name || '', tagline: site.tagline || '' };
  return template
    .replace(/\{(title|site|name|tagline)\}/g, (_, key) => values[key])
    .replace(/\s*\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Everything a page tells search engines and social sites, with the page's
 * own fields applied over the site's defaults. `page` is a loaded content
 * entry (lib/content.js), so `description` already falls back to the body's
 * start; `descriptionAuto` says when it did.
 */
export function pageSeo(page, site) {
  const settings = seoSettings(site);
  const isHome = page.url === '/';
  const defaultTitle = fill(isHome ? settings.homeTitle : settings.titleTemplate, page, site) || str(page.title);
  const title = str(page.metaTitle) || defaultTitle;
  const defaultDescription = str(page.description);
  const description = str(page.metaDescription) || defaultDescription;
  const descriptionSource = str(page.metaDescription) ? 'seo' : page.descriptionAuto ? 'body' : 'page';
  const imagePath = str(page.ogImage) || str(page.image) || str(site.brand?.defaultOgImage);
  const canonicalField = str(page.canonical);
  const canonical = canonicalField && validCanonical(canonicalField) ? absolute(site, canonicalField) : page.absoluteUrl;
  return {
    title,
    defaultTitle,
    description,
    defaultDescription,
    descriptionSource,
    socialTitle: str(page.metaTitle) || str(page.title) || title,
    image: absolute(site, imagePath),
    imagePath,
    imageOwn: Boolean(str(page.ogImage) || str(page.image)),
    imageAlt: str(page.ogImageAlt),
    canonical,
    canonicalElsewhere: canonical !== page.absoluteUrl,
    robots: page.noindex === true ? 'noindex, follow' : '',
    type: page.date ? 'article' : 'website',
    published: page.date ? new Date(page.date).toISOString() : '',
    keyword: str(page.focusKeyword),
  };
}

/* ------------------------------------------------------------------ audit */

const normalise = (text) => ` ${String(text || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Whether the text has the phrase, or failing that every one of its words. */
export function hasKeyword(text, keyword) {
  const phrase = normalise(keyword).trim();
  if (!phrase) return false;
  const haystack = normalise(text);
  if (haystack.includes(` ${phrase} `)) return true;
  const words = phrase.split(' ').filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => haystack.includes(` ${w} `));
}

/** The body as plain text: no frontmatter-style templates, HTML, markdown syntax or code. */
export function plainText(body) {
  return String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/[*_`>|#-]+/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first paragraph of the body that isn't a heading, image, template tag or HTML. */
function introduction(page) {
  const blocks = String(page.body || '').split(/\n\s*\n/);
  const first = blocks.find((b) => {
    const t = b.trim();
    return t && !/^(#|!\[|<|\{\{|```|\||-{3,})/.test(t);
  });
  return [page.heroText, page.tagline, first ? plainText(first) : ''].filter(Boolean).join(' ');
}

const wordCount = (text) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

function imageExists(root, value) {
  if (!value || /^https?:\/\//i.test(value)) return true;
  if (!value.startsWith('/')) return false;
  const rel = decodeURIComponent(value.split(/[?#]/)[0].slice(1));
  if (rel.split('/').includes('..')) return false;
  return fs.existsSync(path.join(root, rel)) || fs.existsSync(path.join(root, 'static', rel));
}

const PENALTY = { error: 25, warning: 10, tip: 3, note: 0 };

// The description npm run new and npm run scaffold write until someone writes a real one.
const PLACEHOLDER_DESCRIPTION = /^under 160 characters, written for search results\.?$/i;
export const isPlaceholder = (description) => PLACEHOLDER_DESCRIPTION.test(String(description || '').trim());

const listUrls = (urls) => (urls.length > 3 ? `${urls.slice(0, 3).join(', ')} and ${urls.length - 3} more` : urls.join(', '));

/**
 * Issues for every page, worst first, and a score out of 100:
 * [{ page, seo, issues: [{ level, field, message }], score }].
 * Levels: "error" (search engines get something broken), "warning" (it'll
 * show badly), "tip" (worth improving), "note" (for information).
 * `root` is the site's directory, for checking that images exist.
 */
export function auditPages(pages, site, root) {
  const results = pages.map((page) => ({ page, seo: page.seo || pageSeo(page, site), issues: [] }));
  const indexed = results.filter((r) => r.page.noindex !== true && !r.page.draft && !r.seo.canonicalElsewhere);
  const byTitle = new Map();
  const byDescription = new Map();
  for (const r of indexed) {
    const t = r.seo.title.toLowerCase();
    const d = r.seo.description.toLowerCase();
    byTitle.set(t, [...(byTitle.get(t) || []), r.page.url]);
    if (d && !isPlaceholder(d)) byDescription.set(d, [...(byDescription.get(d) || []), r.page.url]);
  }

  for (const r of results) {
    const { page, seo, issues } = r;
    const add = (level, field, message) => issues.push({ level, field, message });

    const titlePx = textWidth(seo.title, LIMITS.titleSize);
    if (!seo.title) add('error', 'metaTitle', 'No title.');
    else if (titlePx > LIMITS.titlePx) add('warning', 'metaTitle', `The title is ${titlePx}px wide; search results cut it off at about ${LIMITS.titlePx}px.`);
    else if (seo.title.length < LIMITS.titleMinChars) add('tip', 'metaTitle', `The title is short (${seo.title.length} characters). 30 to 60 gives searchers more to go on.`);

    const descriptionPx = textWidth(seo.description, LIMITS.descriptionSize);
    if (!seo.description) add('warning', 'metaDescription', 'No description. Search engines will pick text from the page.');
    else if (isPlaceholder(seo.description)) add('error', 'metaDescription', 'The description is still the placeholder text from when the page was created, and search results would show it.');
    else if (seo.descriptionSource === 'body') add('warning', 'metaDescription', 'No description: the start of the page text is used instead. Write one for search results.');
    if (isPlaceholder(seo.description)) {
      // Already reported; its length says nothing.
    } else if (seo.description && descriptionPx > LIMITS.descriptionPx) {
      add('warning', 'metaDescription', `The description is ${descriptionPx}px wide; search results cut it off at about ${LIMITS.descriptionPx}px (roughly 155 characters).`);
    } else if (seo.description && seo.description.length < LIMITS.descriptionMinChars) {
      add('tip', 'metaDescription', `The description is short (${seo.description.length} characters). Aim for 120 to 155.`);
    }

    if (indexed.includes(r)) {
      const sameTitle = (byTitle.get(seo.title.toLowerCase()) || []).filter((u) => u !== page.url);
      if (sameTitle.length) add('warning', 'metaTitle', `Same title as ${listUrls(sameTitle)}.`);
      const sameDescription = (byDescription.get(seo.description.toLowerCase()) || []).filter((u) => u !== page.url);
      if (seo.description && sameDescription.length) add('warning', 'metaDescription', `Same description as ${listUrls(sameDescription)}.`);
    }

    if (!seo.keyword) {
      add('tip', 'focusKeyword', 'No focus keyphrase: the search phrase this page should be found for.');
    } else {
      if (seo.keyword.length > LIMITS.keywordMaxChars) add('tip', 'focusKeyword', 'The focus keyphrase is very long. Use the few words people would search for.');
      if (!hasKeyword(seo.title, seo.keyword)) add('warning', 'focusKeyword', 'The focus keyphrase isn\'t in the title.');
      if (seo.description && !hasKeyword(seo.description, seo.keyword)) add('tip', 'focusKeyword', 'The focus keyphrase isn\'t in the description.');
      if (!hasKeyword(page.heroHeading || page.title, seo.keyword)) add('tip', 'focusKeyword', 'The focus keyphrase isn\'t in the page heading.');
      if (!hasKeyword(introduction(page), seo.keyword)) add('tip', 'focusKeyword', 'The focus keyphrase isn\'t in the introduction.');
      if (page.url !== '/' && !hasKeyword(page.url.replace(/[/_.-]+/g, ' '), seo.keyword)) add('note', 'focusKeyword', 'The focus keyphrase isn\'t in the URL.');
    }

    const canonicalField = str(page.canonical);
    if (canonicalField && !validCanonical(canonicalField)) add('error', 'canonical', `"${canonicalField}" isn't a URL: use https://… or a path starting with /.`);
    else if (seo.canonicalElsewhere) add('note', 'canonical', `Search engines are told to index ${seo.canonical} instead of this page.`);

    if (!imageExists(root, seo.imagePath)) add('error', 'ogImage', `The social image ${seo.imagePath} doesn't exist.`);
    else if (!seo.imagePath) add('tip', 'ogImage', 'No social image: links to this page are shared without one.');
    else if (/\.svg($|\?)/i.test(seo.imagePath)) {
      add('tip', 'ogImage', `${seo.imageOwn ? 'The social image' : 'The site\'s default social image'} is an SVG, which social sites don't show. Use a PNG or JPEG, ideally 1200 × 630.`);
    } else if (!seo.imageOwn) add('note', 'ogImage', 'Shared with the site\'s default image.');

    const missingAlt = [...String(page.body || '').matchAll(/!\[\s*\]\(|<img\b(?![^>]*\balt=)[^>]*>/g)].length;
    if (missingAlt) add('warning', 'body', `${missingAlt} image${missingAlt === 1 ? '' : 's'} without alt text.`);
    const words = wordCount(plainText(page.body));
    if (words < LIMITS.minWords && page.noindex !== true) add('note', 'body', `${words} words of text. Pages with more substance tend to rank better.`);

    if (page.noindex === true) add('note', 'noindex', 'Hidden from search engines (noindex) and left out of the sitemap.');
    if (page.draft) add('note', 'draft', 'A draft: not published yet.');

    const order = Object.keys(PENALTY);
    issues.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    r.score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + PENALTY[issue.level], 0));
  }
  return results;
}

/* ------------------------------------------------------ frontmatter edits */

// Values the site's frontmatter parser would read as something other than
// plain text (true, 12, [list]…), or YAML would, are written in quotes. The
// parser only strips the outer pair, so quotes inside need no escaping.
function formatValue(value) {
  if (value === true || value === false) return String(value);
  const text = String(value).replace(/[\r\n]+/g, ' ').trim();
  const risky = /^(true|false|null|yes|no|~|-?\d+(\.\d+)?)$/i.test(text) || /^[[\]{}>|*&!%@`'"#,?:-]/.test(text) || /:\s|\s#/.test(text);
  return risky ? `"${text}"` : text;
}

/**
 * The file with these top-level frontmatter fields set ({ field: value }; ''
 * or null removes the field). Existing lines are replaced where they are, new
 * ones go after `description` (or at the end of the frontmatter), and
 * everything else, including the line endings, is kept.
 */
export function setFrontmatterFields(source, fields) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  let text = source.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!/^---\n[\s\S]*?\n---(\n|$)/.test(text)) text = `---\n---\n${text}`;
  const end = text.indexOf('\n---', 3);
  const lines = text.slice(4, end).split('\n');
  if (lines.length === 1 && lines[0] === '') lines.pop();
  const rest = text.slice(end);

  for (const [field, value] of Object.entries(fields)) {
    const at = lines.findIndex((line) => line.startsWith(`${field}:`));
    const remove = value === '' || value === null || value === undefined || value === false && field === 'noindex';
    if (remove) {
      if (at !== -1) lines.splice(at, 1);
      continue;
    }
    const line = `${field}: ${formatValue(value)}`;
    if (at !== -1) {
      lines[at] = line;
      continue;
    }
    // After the SEO field before it, else after description, else at the end.
    const before = SEO_FIELDS.slice(0, SEO_FIELDS.indexOf(field)).reverse();
    let anchor = -1;
    for (const name of [...before, 'description', 'title']) {
      anchor = lines.findIndex((l) => l.startsWith(`${name}:`));
      if (anchor !== -1) break;
    }
    lines.splice(anchor === -1 ? lines.length : anchor + 1, 0, line);
  }
  return `---\n${lines.join('\n')}${lines.length ? '\n' : ''}${rest.replace(/^\n/, '')}`.replace(/\n/g, eol);
}
