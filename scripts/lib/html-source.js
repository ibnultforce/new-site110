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
 *
 * With { keepStyles: true } (--keep-styles) the same parts are cut away, but
 * the rest keeps its structure and attributes (classes, ids, inline styles,
 * SVG) so it can be shown as-is with the old page's CSS, and every class gets
 * a prefix so the site's own classes and Tailwind utilities never match it.
 * The page's scripts are kept too: the attributes they use (data-*, event
 * handlers, javascript: links) stay in the markup, and scriptsIn() lists the
 * scripts themselves in document order. stylesheetsIn() lists the page's <style> blocks and linked stylesheets in
 * cascade order, for scripts/lib/css-scope.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
// About 40k tokens: room for the prompt and a complete reply.
export const MAX_CLEAN_CHARS = 150000;

const KEEP_ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);
// With keepStyles every other attribute stays (SVG needs its own, the page's scripts their data-*
// and event handlers), except these.
const DROP_STYLED_ATTRIBUTE = /^(srcset|sizes|nonce|integrity|crossorigin|is|slot|contenteditable)$/i;
// Removed with everything inside them, wherever they are.
const DROP_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'object', 'head'];
// Scripts leave the markup but are kept (scriptsIn); <template>, <canvas> and <noscript> stay for them.
const DROP_STYLED_ELEMENTS = ['script', 'style', 'head'];
// class/id tokens that mark site chrome outside the content.
const CHROME_TOKEN = /^(?:(?:site|page|global|main|top|primary)[-_])?(header|footer|masthead|navbar|topbar|top-bar|sidebar|cookie[-_]?(?:banner|notice|consent)?)$/i;
// A start tag, with attribute values that may contain ">".
const START_TAG = /<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** Reads a file of the given kind inside the repository. Throws a readable error otherwise. */
function readSource(relPath, extension, kind) {
  const normalised = path.posix.normalize(String(relPath).replace(/\\/g, '/')).replace(/^\.\//, '');
  if (normalised.startsWith('../') || path.posix.isAbsolute(normalised) || /^[A-Za-z]:/.test(normalised)) {
    throw new Error(`the ${kind} file must be inside the repository, not ${relPath}`);
  }
  if (!extension.test(normalised)) throw new Error(`${relPath} isn't a ${kind} file`);
  const absolute = path.join(ROOT, normalised);
  if (!fs.existsSync(absolute)) throw new Error(`${relPath} does not exist`);
  const size = fs.statSync(absolute).size;
  if (size > MAX_HTML_BYTES) throw new Error(`${relPath} is over ${MAX_HTML_BYTES / 1024 / 1024} MB`);
  return { file: normalised, text: fs.readFileSync(absolute, 'utf8') };
}

/** Reads an HTML file inside the repository. Throws a readable error otherwise. */
export function readHtmlSource(relPath) {
  const { file, text } = readSource(relPath, /\.html?$/i, 'HTML');
  return { file, html: text };
}

/** Reads a stylesheet inside the repository. Throws a readable error otherwise. */
export function readCssSource(relPath) {
  const { file, text } = readSource(relPath, /\.css$/i, 'CSS');
  return { file, css: text };
}

/** Reads a script inside the repository. Throws a readable error otherwise. */
export function readJsSource(relPath) {
  const { file, text } = readSource(relPath, /\.m?js$/i, 'JavaScript');
  return { file, code: text };
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

/**
 * Why an element is site chrome ("header", "navigation"…), or null to keep it.
 * `atEdge` is true above the page's main heading or below its last heading:
 * a <nav> there is the old site's menu or footer links, while one between
 * the page's headings (a section bar, a table of contents) is the page's own.
 */
function chromeReason(name, attrs, inContent, atEdge) {
  const role = (attribute(attrs, 'role') || '').toLowerCase();
  const tokens = `${attribute(attrs, 'class') || ''} ${attribute(attrs, 'id') || ''}`.split(/\s+/).filter(Boolean);

  if (tokens.some((t) => /^breadcrumbs?$/i.test(t))) return 'navigation';
  if (tokens.some((t) => /^cookie/i.test(t)) || role === 'alertdialog') return 'cookie banner';
  if ((name === 'nav' || role === 'navigation') && atEdge && !inContent) return 'navigation';
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
  const firstHeading = html.search(/<h1\b/i);
  const headings = [...html.matchAll(/<h[1-3]\b/gi)];
  const lastHeading = headings.length ? headings.at(-1).index : -1;
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
    const atEdge = firstHeading < 0 || m.index < firstHeading || m.index > lastHeading;
    const reason = chromeReason(name, attrs, content > 0, atEdge);
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

/** The first element matching `open`, start and end tags included, or null. */
function outerOf(html, open) {
  const m = open.exec(html);
  if (!m) return null;
  const end = elementEnd(html, m[1], m.index + m[0].length);
  return html.slice(m.index, end < 0 ? html.length : end);
}

const MAIN_TAG = /<(main)\b[^>]*>/i;
const MAIN_ROLE = /<([a-zA-Z][\w-]*)\b[^>]*\brole\s*=\s*["']?main\b[^>]*>/i;

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

/**
 * keepStyles: every element and attribute stays (minus responsive-image and
 * integrity attributes), and each class gets `prefix`. Returns the HTML and
 * the class names and ids it uses, unprefixed, for scoping the CSS.
 */
function styledTags(html, prefix) {
  const classes = new Set();
  const ids = new Set();
  const out = html.replace(START_TAG, (whole, name, attrs, selfClosing) => {
    const kept = [];
    for (const m of attrs.matchAll(/([^\s=/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
      const [, attr, raw] = m;
      if (DROP_STYLED_ATTRIBUTE.test(attr)) continue;
      const value = raw === undefined ? null : raw.replace(/^["']|["']$/g, '');
      if (/^class$/i.test(attr) && value !== null) {
        const names = value.split(/\s+/).filter(Boolean);
        for (const n of names) classes.add(n);
        if (names.length) kept.push(`class="${names.map((n) => prefix + n).join(' ')}"`);
        continue;
      }
      if (/^id$/i.test(attr) && value) ids.add(value);
      kept.push(raw === undefined ? attr : `${attr}=${raw}`);
    }
    return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClosing ? ' /' : ''}>`;
  });
  return { html: out, classes, ids };
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

const removedList = (removed) => Object.entries(removed).map(([what, n]) => (n > 1 ? `${what} (${n})` : what));

/**
 * Cleans an HTML page down to its content.
 * Returns { title, description, html, removed: ["header", "navigation (3)"…], text },
 * plus { classes, ids } with keepStyles.
 */
export function cleanHtml(source, { keepStyles = false, prefix = '' } = {}) {
  const removed = {};
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(source)?.[1] ?? source;
  const title = decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? '');
  const metaTag = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\bname\s*=\s*["']?description\b/i.test(t));
  const description = metaTag ? decodeEntities(attribute(metaTag.replace(/^<meta|\/?>$/gi, ''), 'content') || '') : '';

  let html = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  html = innerOf(html, /<(body)\b[^>]*>/i) ?? html;
  html = dropElements(html, keepStyles ? DROP_STYLED_ELEMENTS : DROP_ELEMENTS);
  html = html.replace(/<(link|meta|base)\b[^>]*>/gi, '');
  // Every class and id of the whole page, before its header and footer go (see removedIds below).
  const whole = keepStyles ? styledTags(html, '') : null;

  // When <main> holds most of the page, everything around it is the site, not the page.
  const main = innerOf(html, MAIN_TAG) ?? innerOf(html, MAIN_ROLE);
  const pageText = visibleText(removeChrome(html, {})).length;
  if (main !== null && visibleText(main).length >= pageText * 0.3) {
    if (visibleText(main).length < visibleText(html).length) removed['everything outside <main>'] = 1;
    // Kept with its own tag when styles are kept: its classes may carry the layout.
    html = keepStyles ? (outerOf(html, MAIN_TAG) ?? outerOf(html, MAIN_ROLE)) : main;
  }

  html = removeChrome(html, removed);

  if (keepStyles) {
    const styled = styledTags(html.trim(), prefix);
    // What the old <html> and <body> carried: their rules ("body.home .x") now describe the wrapper.
    const rootClasses = new Set();
    const rootIds = new Set();
    const tagClasses = { html: [], body: [] };
    for (const m of source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(html|body)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      for (const c of (attribute(m[2], 'class') || '').split(/\s+/).filter(Boolean)) {
        rootClasses.add(c);
        tagClasses[m[1].toLowerCase()].push(c);
      }
      const id = attribute(m[2], 'id');
      if (id) rootIds.add(id);
    }
    return {
      title,
      description,
      html: styled.html,
      text: visibleText(styled.html),
      classes: styled.classes,
      ids: styled.ids,
      rootClasses,
      rootIds,
      // The old <html> and <body> classes, apart: the page's scripts may look for them there.
      htmlClasses: [...new Set(tagClasses.html)],
      bodyClasses: [...new Set(tagClasses.body)],
      // Ids and classes that left with the header, footer and navigation, which a kept script may
      // still look up (assets/js/imported-page.js gives it a stand-in rather than null).
      removedIds: [...whole.ids].filter((id) => !styled.ids.has(id)),
      removedClasses: [...whole.classes].filter((c) => !styled.classes.has(c)),
      removed: removedList(removed),
    };
  }

  html = simplifyTags(html, removed);
  html = html
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, description, html, text: visibleText(html), removed: removedList(removed) };
}

const SCRIPT_TYPE = /^(|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|module)$/i;

/**
 * The page's scripts in document order: [{ head, src, code, module, defer,
 * async, nomodule }], `head` when the script sits in <head>. JSON-LD (the site
 * writes its own), templates and other non-JavaScript types are left out.
 */
export function scriptsIn(source) {
  const html = source.replace(/<!--[\s\S]*?-->/g, '');
  const bodyAt = /<\/head\s*>|<body\b/i.exec(html)?.index ?? -1;
  const scripts = [];
  for (const m of html.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    const type = (attribute(attrs, 'type') || '').trim();
    if (!SCRIPT_TYPE.test(type)) continue;
    const has = (name) => attribute(attrs, name) !== null || new RegExp(`(^|\\s)${name}(?=\\s|/|$)`, 'i').test(attrs);
    const src = (attribute(attrs, 'src') || '').trim();
    if (!src && !m[2].trim()) continue;
    scripts.push({
      head: bodyAt >= 0 && m.index < bodyAt,
      src: src || null,
      code: src ? null : m[2],
      module: /^module$/i.test(type),
      defer: has('defer'),
      async: has('async'),
      nomodule: has('nomodule'),
    });
  }
  return scripts;
}

/** The <img> sources in cleaned HTML, in order, with their alt text. */
export function htmlImages(html) {
  const seen = new Set();
  const images = [];
  for (const m of html.matchAll(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const src = (attribute(m[1], 'src') || '').trim();
    if (!src || /^data:/i.test(src) || seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: attribute(m[1], 'alt') || '' });
  }
  return images;
}

/** Replaces each <img>'s src with `resolve(src)`, or removes the image when that returns null. */
export function rewriteImages(html, resolve) {
  return html.replace(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (whole, attrs) => {
    const src = (attribute(attrs, 'src') || '').trim();
    if (!src || /^data:/i.test(src)) return whole;
    const next = resolve(src);
    if (next === null) return '';
    return whole.replace(/(\ssrc\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/i, `$1"${next}"`);
  });
}

/**
 * The page's stylesheets in cascade order: { inline: css } for each <style>
 * block and { href } for each <link rel="stylesheet">, each with its `media`
 * when it has one other than "all" (a print stylesheet must stay print-only).
 * Alternate stylesheets and disabled ones are left out, as browsers do.
 */
export function stylesheetsIn(source) {
  const html = source.replace(/<!--[\s\S]*?-->/g, '');
  const sheets = [];
  for (const m of html.matchAll(/<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>|<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = m[1] ?? m[3];
    const media = (attribute(attrs, 'media') || '').trim();
    const extra = media && !/^all$/i.test(media) ? { media } : {};
    if (m[2] !== undefined) {
      if (m[2].trim()) sheets.push({ inline: m[2], ...extra });
      continue;
    }
    const rel = (attribute(attrs, 'rel') || '').toLowerCase();
    if (!/\bstylesheet\b/.test(rel) || /\balternate\b/.test(rel) || /(^|\s)disabled(\s|=|$)/i.test(attrs)) continue;
    const href = attribute(attrs, 'href');
    if (href) sheets.push({ href: href.trim(), ...extra });
  }
  return sheets;
}

const FONT_SIZES = { 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };
const length = (v) => (/^\d+(\.\d+)?$/.test(v) ? `${v}px` : /^\d+(\.\d+)?%$/.test(v) ? v : null);

/**
 * Old HTML attributes that browsers turn into styling (<font color>, <table
 * border cellpadding>, bgcolor, align, valign, width/height on images and
 * cells…) as zero-specificity CSS rules for `scope`. The copy needs them as
 * rules because its isolation (`all: revert`) also reverts those attribute
 * styles. Placed after the isolation, they rank like browsers rank attribute
 * styling: above defaults, below every real CSS rule. `bodyAttrs` (the old
 * <body>'s bgcolor, text, background) apply to the wrapper.
 */
export function presentationalHints(html, scope, bodyAttrs = '') {
  const rules = new Map();
  const add = (selector, decl) => {
    if (!decl) return;
    rules.set(selector, `${rules.get(selector) || ''}${decl};`);
  };
  const sel = (inner) => `:where(${scope} ${inner})`;
  const q = (v) => JSON.stringify(v);

  for (const [, rawName, attrs] of html.matchAll(START_TAG)) {
    const name = rawName.toLowerCase();
    const get = (a) => attribute(attrs, a);
    const self = (a) => `${name}[${a}=${q(get(a))}]`;
    const color = get('color');
    if (name === 'font') {
      if (color) add(sel(self('color')), `color:${color}`);
      if (get('face')) add(sel(self('face')), `font-family:${get('face')}`);
      if (FONT_SIZES[get('size')]) add(sel(self('size')), `font-size:${FONT_SIZES[get('size')]}`);
    }
    if (get('bgcolor')) add(sel(self('bgcolor')), `background-color:${get('bgcolor')}`);
    if (get('background') && /^(https?:)?\/\/|^\//.test(get('background'))) add(sel(self('background')), `background-image:url(${q(get('background'))})`);
    const align = (get('align') || '').toLowerCase();
    if (align) {
      if (name === 'table') add(sel(self('align')), align === 'center' ? 'margin-left:auto;margin-right:auto' : /^(left|right)$/.test(align) ? `float:${align}` : '');
      else if (/^(img|iframe|object|embed|video)$/.test(name)) add(sel(self('align')), /^(left|right)$/.test(align) ? `float:${align}` : /^(top|middle|bottom|baseline)$/.test(align) ? `vertical-align:${align}` : '');
      // Browsers map align to -webkit-left/right/center, which also align block children (a
      // nested table). The plain value comes first for browsers without the prefixed one.
      else if (/^(div|p|h[1-6]|td|th|tr|thead|tbody|tfoot|caption|legend|center)$/.test(name)) add(sel(self('align')), /^(left|right|center)$/.test(align) ? `text-align:${align};text-align:-webkit-${align}` : `text-align:${align}`);
    }
    const valign = (get('valign') || '').toLowerCase();
    if (valign && /^(td|th|tr|thead|tbody|tfoot|col)$/.test(name)) add(sel(self('valign')), `vertical-align:${valign}`);
    const w = length(get('width') || '');
    const h = length(get('height') || '');
    if (w && /^(img|table|td|th|col|colgroup|iframe|video|canvas|embed|object|hr)$/.test(name)) add(sel(self('width')), `width:${w}`);
    if (h && /^(img|table|td|th|tr|iframe|video|canvas|embed|object)$/.test(name)) add(sel(self('height')), `height:${h}`);
    if (/^(img|video|canvas)$/.test(name) && /^\d+$/.test(get('width') || '') && /^\d+$/.test(get('height') || '')) {
      add(sel(`${self('width')}${`[height=${q(get('height'))}]`}`), `aspect-ratio:auto ${get('width')} / ${get('height')}`);
    }
    if (get('nowrap') !== null && /^(td|th)$/.test(name)) add(sel(`${name}[nowrap]`), 'white-space:nowrap');
    if (name === 'table') {
      const border = get('border');
      if (border !== null) {
        const n = /^\d+$/.test(border) ? Number(border) : 1;
        if (n > 0) {
          add(sel(self('border')), `border-width:${n}px;border-style:outset`);
          add(sel(`${self('border')} > * > tr > td, ${scope} ${self('border')} > * > tr > th`), 'border-width:1px;border-style:inset');
        }
      }
      if (/^\d+$/.test(get('cellpadding') || '')) add(sel(`${self('cellpadding')} > * > tr > td, ${scope} ${self('cellpadding')} > * > tr > th`), `padding:${get('cellpadding')}px`);
      if (/^\d+$/.test(get('cellspacing') || '')) add(sel(self('cellspacing')), `border-spacing:${get('cellspacing')}px`);
    }
  }

  const body = [];
  if (attribute(bodyAttrs, 'bgcolor')) body.push(`background-color:${attribute(bodyAttrs, 'bgcolor')}`);
  if (attribute(bodyAttrs, 'text')) body.push(`color:${attribute(bodyAttrs, 'text')}`);
  if (/^(https?:)?\/\/|^\//.test(attribute(bodyAttrs, 'background') || '')) body.push(`background-image:url(${q(attribute(bodyAttrs, 'background'))})`);
  const out = [...rules].map(([selector, decl]) => `${selector} { ${decl} }`);
  // A table gives its cells 1px of padding as attribute styling even without cellpadding (it
  // isn't in the browser's default stylesheet), so the isolation's revert removes it too.
  if (/<table\b/i.test(html)) out.unshift(`${sel('table:not([cellpadding]) > * > tr > td')}, ${sel('table:not([cellpadding]) > * > tr > th')} { padding:1px; }`);
  if (body.length) out.unshift(`:where(${scope}) { ${body.join(';')}; }`);
  return out;
}

const SVG_REFERENCE = /\b(?:xlink:)?href\s*=\s*["']#([\w:.-]+)["']|url\(\s*["']?#([\w:.-]+)["']?\s*\)/gi;
const SVG_DEFINITION = /^<(symbol|linearGradient|radialGradient|clipPath|mask|pattern|filter|marker|g|path|defs)\b/i;

/**
 * SVG definitions the kept content uses but that were cut away with the rest
 * of the page: an icon sprite (a hidden <svg> of <symbol>s, often the first
 * thing in <body>) that <use href="#i-arrow"> draws from, or a gradient a
 * fill="url(#g)" points at. Each is copied, with what it refers to in turn,
 * into one hidden <svg> to append to the content (classes get `prefix`, and
 * <title>s go so they add no text). Returns '' when nothing is missing.
 */
export function svgDefinitions(source, kept, prefix = '') {
  const html = source.replace(/<!--[\s\S]*?-->/g, '');
  const escape = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defined = (text, id) => new RegExp(`\\bid\\s*=\\s*["']?${escape(id)}(?=["'\\s/>])`).test(text);
  const queue = [...kept.matchAll(SVG_REFERENCE)].map((m) => m[1] || m[2]).filter((id) => !defined(kept, id));
  const done = new Set();
  const found = [];
  while (queue.length) {
    const id = queue.shift();
    if (done.has(id)) continue;
    done.add(id);
    const open = new RegExp(`<([a-zA-Z][\\w:-]*)\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\bid\\s*=\\s*(["']?)${escape(id)}\\2(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'i');
    const m = open.exec(html);
    if (!m || !SVG_DEFINITION.test(m[0])) continue;
    const element = m[0].endsWith('/>') ? m[0] : outerOf(html.slice(m.index), open);
    if (!element) continue;
    found.push(element);
    for (const ref of element.matchAll(SVG_REFERENCE)) queue.push(ref[1] || ref[2]);
  }
  if (!found.length) return '';
  const markup = found
    .join('')
    .replace(/<title\b[\s\S]*?<\/title\s*>/gi, '')
    .replace(/\bclass\s*=\s*(["'])([^"']*)\1/gi, (_, q, names) => `class=${q}${names.split(/\s+/).filter(Boolean).map((n) => prefix + n).join(' ')}${q}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${markup}</svg>`;
}

/** The attributes of the page's <body> tag, as written. */
export function bodyAttributes(source) {
  return /<body\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(source.replace(/<!--[\s\S]*?-->/g, ''))?.[1] || '';
}

/**
 * Makes HTML safe as one raw block in a markdown content file: the renderer
 * ends a raw block at the first blank line, and the template engine reads "{{".
 * A blank line inside <pre> becomes a line holding an entity space, so it shows.
 */
export function asRawBlock(html) {
  let inPre = 0;
  const lines = [];
  for (const line of html.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim()) lines.push(line.replace(/\s+$/, ''));
    else if (inPre > 0) lines.push('&#32;');
    inPre = Math.max(0, inPre + (line.match(/<pre\b/gi) || []).length - (line.match(/<\/pre\s*>/gi) || []).length);
  }
  return lines.join('\n').replace(/\{\{/g, '&#123;{').replace(/\}\}/g, '}&#125;');
}
