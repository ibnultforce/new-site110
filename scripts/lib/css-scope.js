/**
 * Scopes an imported page's CSS to that page (scripts/edit-page.js
 * --from-html --keep-styles). Zero dependencies.
 *
 * Every selector is put under one scope class (the wrapper the imported body
 * sits in), html/body/:root rules apply to the wrapper itself, and every class
 * name gets the same prefix the imported HTML's classes were given, so the
 * site's own classes and Tailwind utilities never match imported markup and
 * the imported rules never reach the site's header, footer or other pages.
 * Rules whose classes or ids no longer exist in the imported body (the old
 * header and footer, unused framework classes) are dropped. A zero-specificity
 * `all: revert` keeps the site's own base styles out of the scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';

// At-rules whose blocks hold rules (scoped recursively); any other block is copied as-is.
const NESTING_AT_RULES = /^@(media|supports|layer|container|document|-moz-document)\b/i;
const ROOT_COMPOUND = /^(?:html|body|:root)(?![\w-])(?:[.#:[][^\s>+~]*)?/i;

/** Removes comments, leaving strings alone. */
function stripComments(css) {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const end = stringEnd(css, i);
      out += css.slice(i, end);
      i = end - 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

function stringEnd(css, start) {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length && css[i] !== quote) i += css[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, css.length);
}

/** Index just past the "}" matching the "{" at `open`. */
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") i = stringEnd(css, i) - 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return css.length;
}

/** [{ type: 'statement', text } | { type: 'block', prelude, body }] at one level. */
function parse(css) {
  const nodes = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /[\s;]/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css[i] === '}') {
      i++; // stray closer
      continue;
    }
    let j = i;
    let parens = 0;
    while (j < css.length) {
      const c = css[j];
      if (c === '"' || c === "'") j = stringEnd(css, j) - 1;
      else if (c === '(') parens++;
      else if (c === ')') parens--;
      else if (parens <= 0 && (c === '{' || c === ';')) break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (css[j] === '{') {
      const end = blockEnd(css, j);
      nodes.push({ type: 'block', prelude, body: css.slice(j + 1, end - 1) });
      i = end;
    } else {
      if (prelude) nodes.push({ type: 'statement', text: prelude });
      i = j + 1;
    }
  }
  return nodes;
}

/** Splits on commas outside parentheses and strings. */
function splitList(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Applies `fn` to the parts of a selector outside quoted strings. */
function outsideStrings(selector, fn) {
  let out = '';
  let last = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '"' || selector[i] === "'") {
      const end = stringEnd(selector, i);
      out += fn(selector.slice(last, i)) + selector.slice(i, end);
      last = end;
      i = end - 1;
    }
  }
  return out + fn(selector.slice(last));
}

const unescape = (name) => name.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_, c) => (/^[0-9a-f]/i.test(c) && c.length > 1 ? String.fromCodePoint(parseInt(c, 16)) : c));

/** The scoped selector, or null if it refers to a class or id that isn't in the page. */
function scopeSelector(selector, { scope, prefix, classes, ids }) {
  let missing = false;
  outsideStrings(selector, (part) => {
    for (const m of part.matchAll(/\.((?:\\.|[\w-])+)/g)) if (!classes.has(unescape(m[1]))) missing = true;
    for (const m of part.matchAll(/#((?:\\.|[\w-])+)/g)) if (!ids.has(unescape(m[1]))) missing = true;
    return part;
  });
  if (missing) return null;

  let rest = outsideStrings(selector, (part) => part.replace(/\.((?:\\.|[\w-])+)/g, `.${prefix}$1`));
  let rooted = false;
  for (let m = ROOT_COMPOUND.exec(rest); m; m = ROOT_COMPOUND.exec(rest)) {
    rest = rest.slice(m[0].length).trimStart();
    rooted = true;
  }
  // "body > .x" becomes ".scope > .x", and a plain selector becomes a descendant of the scope.
  return rooted && !rest ? scope : `${scope} ${rest}`;
}

function urlWarnings(text, warnings) {
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
    const ref = m[2].trim();
    if (/^(https?:|data:|#)/i.test(ref)) continue;
    const exists = ref.startsWith('/') && fs.existsSync(path.join(ROOT, ref.split(/[?#]/)[0].slice(1)));
    if (!exists) warnings.add(`the CSS refers to ${ref}, which isn't in this site, so that background, font or image won't load`);
  }
}

function scopeNodes(nodes, options, imports, warnings) {
  const out = [];
  for (const node of nodes) {
    if (node.type === 'statement') {
      if (/^@import\b/i.test(node.text)) {
        if (/^@import\s+(?:url\(\s*)?["']?https?:/i.test(node.text)) imports.push(`${node.text};`);
        else warnings.add(`dropped ${node.text.slice(0, 120)}: upload that stylesheet as well to include it`);
      }
      continue; // @charset, @namespace and stray statements
    }
    const { prelude, body } = node;
    if (NESTING_AT_RULES.test(prelude)) {
      const inner = scopeNodes(parse(body), options, imports, warnings);
      if (inner.length) out.push(`${prelude} {\n${inner.join('\n')}\n}`);
    } else if (prelude.startsWith('@')) {
      // @font-face, @keyframes, @page, @property: not tied to any element.
      urlWarnings(body, warnings);
      out.push(`${prelude} {${body}}`);
    } else {
      const selectors = splitList(prelude).map((s) => scopeSelector(s, options)).filter(Boolean);
      if (!selectors.length) continue;
      urlWarnings(body, warnings);
      out.push(`${selectors.join(',\n')} {${body.trim() ? ` ${body.trim()} ` : ''}}`);
    }
  }
  return out;
}

/**
 * Scopes stylesheets (in cascade order) to `scope`, prefixing class names
 * with `prefix` and keeping only rules for `classes`/`ids` that exist.
 * Returns { css, warnings, rules } (rules: how many were kept).
 */
export function scopeCss(sheets, { scope, prefix, classes, ids }) {
  const imports = [];
  const warnings = new Set();
  const out = [];
  let rules = 0;
  for (const { name, css } of sheets) {
    const scoped = scopeNodes(parse(stripComments(css)), { scope, prefix, classes, ids }, imports, warnings);
    if (scoped.length) out.push(`/* ${name.replace(/\*\//g, '')} */`, ...scoped);
    rules += scoped.length;
  }
  // Makes the scope behave like the old page's own <body>: the wrapper starts from initial
  // values (so it doesn't inherit the site body's font size, colour or font), and inside it
  // the site's own styles (Tailwind's preflight and base layer: heading colours, text-wrap,
  // img/svg display…) roll back to browser defaults. Zero specificity: imported rules win.
  const isolate = [
    `/* The site's own styles don't apply inside ${scope}. */`,
    `:where(${scope}) { all: initial; display: block; }`,
    `:where(${scope} *) { all: revert; }`,
  ];
  const css = [...new Set(imports), ...isolate, ...out].join('\n');
  return { css: `${css}\n`, warnings: [...warnings], rules };
}
