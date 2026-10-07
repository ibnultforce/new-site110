/**
 * Tiny logic-light template engine. Zero dependencies.
 *
 * Supported syntax
 *   {{ value }}                 escaped output
 *   {{{ value }}}               raw HTML output
 *   {{# if value }} … {{ else }} … {{/ if }}
 *   {{# unless value }} … {{/ unless }}
 *   {{# each list }} … {{/ each }}   inside: {{ this }}, {{ @index }}, {{ @number }},
 *                                            {{ @first }}, {{ @last }}, {{ @odd }}
 *   {{> partial-name }}         include templates/partials/partial-name.html
 *   {{> [value] }}              include the partial NAMED by the looked-up value —
 *                                lets a section list in data choose which partial
 *                                renders each entry, e.g. {{# each data.<file>.sections }}
 *                                {{> [partial] }}{{/ each }} with each entry shaped
 *                                { "partial": "section-products", ... }
 *
 * Name lookup walks the whole context stack, so a partial or an {{#each}} block can
 * still reach `site`, `nav`, `page` etc. without prop drilling.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function lookup(stack, path) {
  const trimmed = path.trim();
  if (trimmed === 'this' || trimmed === '.') {
    const top = stack[stack.length - 1];
    // {{#each}} wraps primitives as { this: value }, so unwrap when present.
    if (top !== null && typeof top === 'object' && 'this' in top) return top.this;
    return top;
  }

  const parts = trimmed.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    let current = stack[i];
    if (current === null || current === undefined) continue;
    let found = true;
    for (const part of parts) {
      if (current !== null && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found) return current;
  }
  return undefined;
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

const TOKEN = /\{\{([#/>{]?)\s*([^{}]+?)\s*\}?\}\}/g;

function tokenize(source) {
  const tokens = [];
  let lastIndex = 0;
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: source.slice(lastIndex, match.index) });
    }
    const [raw, sigil, body] = match;
    if (sigil === '{') tokens.push({ type: 'raw', value: body });
    else if (sigil === '>') {
      const name = body.trim();
      const dynamic = /^\[(.+)\]$/.exec(name);
      if (dynamic) tokens.push({ type: 'partial-dynamic', value: dynamic[1].trim() });
      else tokens.push({ type: 'partial', value: name });
    }
    else if (sigil === '#') {
      const [keyword, ...rest] = body.split(/\s+/);
      tokens.push({ type: 'open', keyword, value: rest.join(' ').trim() });
    } else if (sigil === '/') {
      tokens.push({ type: 'close', keyword: body.split(/\s+/)[0] });
    } else if (body.trim() === 'else') {
      tokens.push({ type: 'else' });
    } else {
      tokens.push({ type: 'value', value: body });
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < source.length) tokens.push({ type: 'text', value: source.slice(lastIndex) });
  return tokens;
}

function parse(tokens, name) {
  let position = 0;

  function walk(stopKeyword) {
    const nodes = [];
    let branch = nodes;
    let alternate = null;

    while (position < tokens.length) {
      const token = tokens[position++];

      if (token.type === 'close') {
        if (token.keyword !== stopKeyword) {
          throw new Error(`Template "${name}": {{/${token.keyword}}} closes an unopened block`);
        }
        return { nodes, alternate };
      }
      if (token.type === 'else') {
        alternate = [];
        branch = alternate;
        continue;
      }
      if (token.type === 'open') {
        const block = walk(token.keyword);
        branch.push({
          type: 'block',
          keyword: token.keyword,
          value: token.value,
          nodes: block.nodes,
          alternate: block.alternate,
        });
        continue;
      }
      branch.push(token);
    }

    if (stopKeyword) throw new Error(`Template "${name}": unclosed {{#${stopKeyword}}} block`);
    return { nodes, alternate };
  }

  return walk(null).nodes;
}

export class TemplateEngine {
  /** @param {Record<string,string>} templates  name -> template source */
  constructor(templates = {}) {
    this.templates = templates;
    this.compiled = new Map();
  }

  add(name, source) {
    this.templates[name] = source;
    this.compiled.delete(name);
  }

  ast(name) {
    if (!this.compiled.has(name)) {
      const source = this.templates[name];
      if (source === undefined) throw new Error(`Template not found: "${name}"`);
      this.compiled.set(name, parse(tokenize(source), name));
    }
    return this.compiled.get(name);
  }

  render(name, context = {}) {
    return this.renderNodes(this.ast(name), [context]);
  }

  renderString(source, context = {}) {
    return this.renderNodes(parse(tokenize(source), 'inline'), [context]);
  }

  renderNodes(nodes, stack) {
    let out = '';
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          out += node.value;
          break;
        case 'value':
          out += escapeHtml(lookup(stack, node.value));
          break;
        case 'raw': {
          const value = lookup(stack, node.value);
          out += value === null || value === undefined ? '' : String(value);
          break;
        }
        case 'partial':
          out += this.renderNodes(this.ast(node.value), stack);
          break;
        case 'partial-dynamic': {
          const name = lookup(stack, node.value);
          if (typeof name !== 'string' || !name) {
            throw new Error(`{{> [${node.value}] }} looked up "${node.value}" and got ${JSON.stringify(name)}, not a partial name`);
          }
          out += this.renderNodes(this.ast(name), stack);
          break;
        }
        case 'block':
          out += this.renderBlock(node, stack);
          break;
        default:
          break;
      }
    }
    return out;
  }

  renderBlock(node, stack) {
    const value = lookup(stack, node.value);

    if (node.keyword === 'if' || node.keyword === 'unless') {
      const pass = node.keyword === 'if' ? truthy(value) : !truthy(value);
      if (pass) return this.renderNodes(node.nodes, stack);
      return node.alternate ? this.renderNodes(node.alternate, stack) : '';
    }

    if (node.keyword === 'each') {
      const list = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
      if (list.length === 0) return node.alternate ? this.renderNodes(node.alternate, stack) : '';
      let out = '';
      list.forEach((item, index) => {
        const scope = item !== null && typeof item === 'object' ? { ...item } : { this: item };
        scope['@index'] = index;
        scope['@number'] = index + 1;
        scope['@padded'] = String(index + 1).padStart(2, '0');
        scope['@first'] = index === 0;
        scope['@last'] = index === list.length - 1;
        scope['@odd'] = index % 2 === 1;
        if (item !== null && typeof item === 'object') scope.this = item;
        out += this.renderNodes(node.nodes, [...stack, scope]);
      });
      return out;
    }

    throw new Error(`Unknown block helper: {{#${node.keyword}}}`);
  }
}
