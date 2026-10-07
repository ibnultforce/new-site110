/**
 * Markdown -> HTML and YAML-ish frontmatter parsing. Zero dependencies.
 *
 * Supports the subset a content site actually needs: headings, paragraphs, bold,
 * italic, inline code, links, images, autolinked URLs, ordered/unordered lists
 * (one level of nesting), blockquotes, fenced code, tables, horizontal rules and
 * raw HTML blocks.
 *
 * Frontmatter supports strings, numbers, booleans, inline arrays [a, b],
 * block arrays (- item) and one level of nested maps.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

/* ------------------------------------------------------------------ frontmatter */

function coerce(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((part) => coerce(part));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') depth--;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim());
}

export function parseFrontmatter(source) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text.trim() };

  const data = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentList = null;
  let currentMap = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent > 0 && trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      if (!currentList) continue;
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(item);
      if (kv) {
        currentMap = { [kv[1]]: coerce(kv[2]) };
        currentList.push(currentMap);
      } else {
        currentList.push(coerce(item));
        currentMap = null;
      }
      continue;
    }

    if (indent > 0 && currentMap) {
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
      if (kv) currentMap[kv[1]] = coerce(kv[2]);
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    currentKey = kv[1];
    currentMap = null;
    if (kv[2].trim() === '') {
      currentList = [];
      data[currentKey] = currentList;
    } else {
      currentList = null;
      data[currentKey] = coerce(kv[2]);
    }
  }

  return { data, body: text.slice(match[0].length).trim() };
}

/* ---------------------------------------------------------------------- inline */

export function renderInline(input) {
  let text = esc(input);

  const codeSpans = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, src, title) =>
      `<img src="${src}" alt="${alt}" loading="lazy" decoding="async"${title ? ` title="${title}"` : ''}>`);

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const external = /^https?:\/\//.test(href);
    const attrs = [`href="${href}"`];
    if (title) attrs.push(`title="${title}"`);
    if (external) attrs.push('target="_blank"', 'rel="noopener"');
    return `<a ${attrs.join(' ')}>${label}</a>`;
  });

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  text = text.replace(/ {2}\n/g, '<br>\n');

  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
}

/* ----------------------------------------------------------------------- block */

function slugifyHeading(text) {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').slice(0, 60);
}

function renderTable(rows) {
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const th = head.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const tb = body
    .map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<div class="table-scroll"><table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${tb}\n</tbody>\n</table></div>`;
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * The index of the line that closes the element opened at the start of lines[start], or -1
 * (not an opening tag, a void or self-closed one, or never closed). Counts nested elements of
 * the same name and ignores HTML comments.
 */
function closingLine(lines, start) {
  const open = /^<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/.exec(lines[start].trim());
  if (!open || open[2] || VOID_ELEMENTS.has(open[1].toLowerCase())) return -1;
  const name = open[1].toLowerCase();
  const tags = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, 'gi');
  let depth = 0;
  let inComment = false;
  for (let i = start; i < lines.length; i++) {
    let text = lines[i];
    // Drop comments (and the inside of one spanning lines) before counting tags.
    if (inComment) {
      const close = text.indexOf('-->');
      if (close === -1) continue;
      text = text.slice(close + 3);
      inComment = false;
    }
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    const opened = text.indexOf('<!--');
    if (opened !== -1) {
      text = text.slice(0, opened);
      inComment = true;
    }
    for (const m of text.matchAll(tags)) {
      if (m[2]) continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  const isBlank = (line) => !line || !line.trim();

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // fenced code
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buffer = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buffer.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buffer.join('\n'))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    // heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const html = renderInline(heading[2].trim());
      const id = slugifyHeading(heading[2]);
      if (level >= 2 && level <= 3) headings.push({ level, id, text: heading[2].trim() });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
      continue;
    }

    // table
    if (line.includes('|') && lines[i + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buffer = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buffer.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buffer.join('\n')).html}</blockquote>`);
      continue;
    }

    // lists (supports one level of nesting)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (!isBlank(lines[i]) && /^\s{2,}/.test(lines[i])))) {
        const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (item) {
          items.push({ indent: item[1].length, text: item[3], children: [] });
        } else if (items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
        }
        i++;
      }
      const baseIndent = Math.min(...items.map((it) => it.indent));
      const tree = [];
      for (const item of items) {
        if (item.indent > baseIndent && tree.length) tree[tree.length - 1].children.push(item);
        else tree.push(item);
      }
      const tag = ordered ? 'ol' : 'ul';
      const html = tree
        .map((item) => {
          const nested = item.children.length
            ? `<ul>${item.children.map((c) => `<li>${renderInline(c.text)}</li>`).join('')}</ul>`
            : '';
          return `<li>${renderInline(item.text)}${nested}</li>`;
        })
        .join('\n');
      out.push(`<${tag}>\n${html}\n</${tag}>`);
      continue;
    }

    // raw html block (a tag or an HTML comment; a comment may span blank lines)
    if (/^<(!--|\/?[a-zA-Z][\w-]*)/.test(line.trim())) {
      // An element opened here runs to its matching close tag, blank lines and all, so a
      // designed <section> with spacing inside stays one block. Unclosed: up to a blank line.
      let end = closingLine(lines, i);
      if (end !== -1) {
        // As before, lines right after it (no blank line between) belong to the block too.
        while (end + 1 < lines.length && !isBlank(lines[end + 1])) end++;
        out.push(lines.slice(i, end + 1).join('\n'));
        i = end + 1;
        continue;
      }
      const buffer = [];
      while (i < lines.length && !isBlank(lines[i])) {
        if (lines[i].lastIndexOf('<!--') > lines[i].lastIndexOf('-->')) {
          while (i < lines.length && !lines[i].includes('-->', lines[i].lastIndexOf('<!--'))) buffer.push(lines[i++]);
          if (i >= lines.length) break;
        }
        buffer.push(lines[i++]);
      }
      out.push(buffer.join('\n'));
      continue;
    }

    // paragraph
    const buffer = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      buffer.push(lines[i++]);
    }
    out.push(`<p>${renderInline(buffer.join('\n'))}</p>`);
  }

  return { html: out.join('\n'), headings };
}

/** A body without template syntax, HTML comments or tags: bodies are often HTML. */
function plainBody(markdown) {
  return String(markdown || '')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Plain-text excerpt, used for meta descriptions and blog cards. */
export function excerpt(markdown, maxLength = 165) {
  const text = plainBody(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s|]+/gm, ' ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, text.lastIndexOf(' ', maxLength)).trim()}…`;
}

export function readingTime(markdown) {
  const words = plainBody(markdown).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}
