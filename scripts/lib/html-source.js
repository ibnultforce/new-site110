/**
 * Prepares an existing HTML page for conversion into a markdown content file
 * (scripts/edit-page.js --from-html). Zero dependencies.
 *
 * The page's own content is kept and the site around it is cut away before
 * Claude sees anything: scripts, styles and comments, everything outside
 * <main> (when <main> holds most of the text), and the site header, footer,
 * navigation, sidebars and cookie banners. A <header> or <footer> inside
 * <main> or <article> belongs to the content (an article's title and date)
 * and is kept; navigation is removed wherever it is. Attributes other than
 * href, src, alt and table spans are dropped, which shrinks the prompt a lot
 * without losing anything the markdown can express.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
// About 40k tokens: room for the prompt and a complete reply.
export const MAX_CLEAN_CHARS = 150000;

const KEEP_ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);
// Removed with everything inside them, wherever they are.
const DROP_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'object', 'head'];
// class/id tokens that mark site chrome outside the content.
const CHROME_TOKEN = /^(?:(?:site|page|global|main|top|primary)[-_])?(header|footer|masthead|navbar|topbar|top-bar|sidebar|cookie[-_]?(?:banner|notice|consent)?)$/i;

/** Reads an HTML file inside the repository. Throws a readable error otherwise. */
export function readHtmlSource(relPath) {
  const normalised = path.posix.normalize(String(relPath).replace(/\\/g, '/')).replace(/^\.\//, '');
  if (normalised.startsWith('../') || path.posix.isAbsolute(normalised) || /^[A-Za-z]:/.test(normalised)) {
    throw new Error(`the HTML file must be inside the repository, not ${relPath}`);
  }
  if (!/\.html?$/i.test(normalised)) throw new Error(`${relPath} isn't an .html file`);
  const absolute = path.join(ROOT, normalised);
  if (!fs.existsSync(absolute)) throw new Error(`${relPath} does not exist`);
  const size = fs.statSync(absolute).size;
  if (size > MAX_HTML_BYTES) throw new Error(`${relPath} is over ${MAX_HTML_BYTES / 1024 / 1024} MB`);
  return { file: normalised, html: fs.readFileSync(absolute, 'utf8') };
}

/** Text with the tags taken out and whitespace collapsed, for measuring how much content there is. */
export function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Where the element whose start tag ends at `from` ends, counting nested elements of the same name. -1 if never closed. */
function elementEnd(html, name, from) {
  const tag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (!m[0].endsWith('/>')) depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function dropElements(html, names) {
  let out = html;
  for (const name of names) {
    out = out.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<${name}\\b[^>]*/?>`, 'gi'), '');
  }
  return out;
}

function attribute(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

/** Why an element is site chrome ("header", "navigation"…), or null to keep it. */
function chromeReason(name, attrs, inContent) {
  const role = (attribute(attrs, 'role') || '').toLowerCase();
  const tokens = `${attribute(attrs, 'class') || ''} ${attribute(attrs, 'id') || ''}`.split(/\s+/).filter(Boolean);

  if (name === 'nav' || role === 'navigation') return 'navigation';
  if (tokens.some((t) => /^breadcrumbs?$/i.test(t))) return 'navigation';
  if (tokens.some((t) => /^cookie/i.test(t)) || role === 'alertdialog') return 'cookie banner';
  if (inContent) return null;

  if (name === 'header' || role === 'banner') return 'header';
  if (name === 'footer' || role === 'contentinfo') return 'footer';
  if (name === 'aside' || role === 'complementary') return 'sidebar';
  for (const token of tokens) {
    const hit = CHROME_TOKEN.exec(token);
    if (!hit) continue;
    const kind = hit[1].toLowerCase();
    if (kind === 'footer') return 'footer';
    if (kind === 'sidebar') return 'sidebar';
    if (kind.startsWith('cookie')) return 'cookie banner';
    if (kind === 'navbar') return 'navigation';
    return 'header';
  }
  return null;
}

/**
 * Removes header, footer, navigation, sidebar and cookie-banner elements.
 * Inside <main> or <article> only navigation and cookie banners go.
 */
function removeChrome(html, removed) {
  const tag = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let out = '';
  let last = 0;
  let content = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const [whole, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    // By name only: a closing tag carries no role, so role="main" couldn't be counted back down.
    if (name === 'main' || name === 'article') {
      if (!whole.endsWith('/>')) content = Math.max(0, content + (closing ? -1 : 1));
      continue;
    }
    if (closing || whole.endsWith('/>')) continue;
    const reason = chromeReason(name, attrs, content > 0);
    if (!reason) continue;
    const end = elementEnd(html, rawName, m.index + whole.length);
    if (end < 0) continue; // unclosed: leave it to Claude rather than cut the rest of the page
    out += html.slice(last, m.index);
    last = end;
    tag.lastIndex = end;
    removed[reason] = (removed[reason] || 0) + 1;
  }
  return out + html.slice(last);
}

/** The inner HTML of the first element matching `open`, or null. */
function innerOf(html, open) {
  const m = open.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = elementEnd(html, m[1], start);
  if (end < 0) return html.slice(start);
  const closeStart = html.lastIndexOf('<', end - 1);
  return html.slice(start, closeStart);
}

/** Keeps only the attributes markdown can carry; embedded data: images are dropped. */
function simplifyTags(html, removed) {
  return html
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?data:[^>]*>/gi, () => {
      removed['embedded data: image'] = (removed['embedded data: image'] || 0) + 1;
      return '';
    })
    .replace(/<(\/?)(div|span|font|center|section|picture|source)\b[^>]*>/gi, (_, closing, name) =>
      /^(div|section)$/i.test(name) ? '\n' : '',
    )
    .replace(/<([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g, (whole, name, attrs, selfClosing) => {
      const kept = [];
      for (const m of attrs.matchAll(/([^\s=/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
        if (KEEP_ATTRIBUTES.has(m[1].toLowerCase()) && m[2] !== undefined) kept.push(`${m[1].toLowerCase()}=${m[2]}`);
      }
      return `<${name.toLowerCase()}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClosing ? ' /' : ''}>`;
    });
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .trim();
}

/**
 * Cleans an HTML page down to its content.
 * Returns { title, description, html, removed: ["header", "navigation (3)"…], text }.
 */
export function cleanHtml(source) {
  const removed = {};
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(source)?.[1] ?? source;
  const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? '');
  const metaTag = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\bname\s*=\s*["']?description\b/i.test(t));
  const description = metaTag ? decodeEntities(attribute(metaTag.replace(/^<meta|\/?>$/gi, ''), 'content') || '') : '';

  let html = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  html = innerOf(html, /<(body)\b[^>]*>/i) ?? html;
  html = dropElements(html, DROP_ELEMENTS);
  html = html.replace(/<(link|meta|base)\b[^>]*>/gi, '');

  // When <main> holds most of the page, everything around it is the site, not the page.
  const main = innerOf(html, /<(main)\b[^>]*>/i) ?? innerOf(html, /<([a-zA-Z][\w-]*)\b[^>]*\brole\s*=\s*["']?main\b[^>]*>/i);
  const pageText = visibleText(removeChrome(html, {})).length;
  if (main !== null && visibleText(main).length >= pageText * 0.3) {
    if (visibleText(main).length < visibleText(html).length) removed['everything outside <main>'] = 1;
    html = main;
  }

  html = removeChrome(html, removed);
  html = simplifyTags(html, removed);
  html = html
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title,
    description,
    html,
    text: visibleText(html),
    removed: Object.entries(removed).map(([what, n]) => (n > 1 ? `${what} (${n})` : what)),
  };
}

/** The <img> sources in cleaned HTML, in order, with their alt text. */
export function htmlImages(html) {
  const seen = new Set();
  const images = [];
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const src = (attribute(m[1], 'src') || '').trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: attribute(m[1], 'alt') || '' });
  }
  return images;
}
