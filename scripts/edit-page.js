#!/usr/bin/env node
/**
 * Modify one existing content or template file with Claude. Two modes:
 *
 * Edit (default): apply a plain English instruction — for changes too
 * specific to be worth a build-script feature (add a section, restyle a
 * block, tighten some copy) but too fiddly to hand-edit template syntax for.
 *
 *   node scripts/edit-page.js <page> "<instruction>"   run this one edit now
 *   node scripts/edit-page.js <page> "<instruction>" --dry-run
 *
 * Generate (--generate): write a page's .md yourself — rough copy, notes,
 * images, image URLs — then have Claude turn that draft into the finished
 * page: structured, in house style, with the layout's frontmatter fields
 * filled from the draft and every image placed with real alt text. Nothing
 * that isn't in the draft is added. The instruction is optional extra
 * direction.
 *
 *   node scripts/edit-page.js <page> --generate ["<extra direction>"]
 *   node scripts/edit-page.js <page> --generate --dry-run
 *
 * Convert (--from-html=<file>): bring an existing HTML page (from an old site,
 * say) in as the page. By default its HTML and CSS are kept as they are (see
 * "--keep-styles" below, now the default); --markdown rewrites it as markdown
 * in the site's design instead, as described here. The site's header, footer, navigation,
 * sidebars, scripts and styles are cut out before Claude sees the HTML
 * (scripts/lib/html-source.js), and Claude leaves out any it still finds.
 * The wording is kept. The HTML replaces the page completely: only the fields
 * that identify the page (REPLACE_KEEPS: slug, url, layout…) survive, and its
 * old body and content fields (hero, highlights, FAQ topics, call to action…)
 * are dropped before Claude sees it, so nothing of the old page carries over.
 * The instruction is optional extra direction.
 *
 *   node scripts/edit-page.js <page> --from-html=old/about.html ["<extra direction>"]
 *   node scripts/edit-page.js <page> --from-html=old/about.html --dry-run
 *
 * Keeping the page's look (the default; --keep-styles is still accepted): the body is copied
 * as-is (classes, inline styles, SVG; header, footer and navigation still
 * removed) rather than converted to markdown, and the page's <style> blocks
 * plus any --css=<file.css> (its linked stylesheets, repeatable) are scoped to
 * that page and saved as assets/css/imported/<page>.css, which the page loads
 * through its "stylesheet" frontmatter field. Claude only writes the
 * frontmatter. See scripts/lib/css-scope.js. The global stylesheets declared
 * in scripts/site-tree.md ("- css/style.css" lines, kept in styles/global/)
 * are applied to every such page that links them, without being uploaded, and a --css upload
 * with the same name replaces the stored one. An imported page renders edge to
 * edge whatever its layout (scripts/build.js).
 *
 *   node scripts/edit-page.js <page> --from-html=old/about.html --keep-styles --css=old/site.css
 *
 * The queue:
 *   node scripts/edit-page.js                          run every queued edit in
 *                                                       scripts/page-commands.json
 *   node scripts/edit-page.js --dry-run                same, print only
 *   node scripts/edit-page.js --list                    show the queue, run nothing
 *
 * Options for a single edit:
 *   --image=<path|url>       an image Claude should see and may place in the
 *                            page; repeat for several. A path is a file in this
 *                            repo (e.g. assets/img/uploads/team.jpg, shown on
 *                            the site as /assets/img/uploads/team.jpg), a URL
 *                            is used as-is. Queue entries take an "images" list.
 *                            With --generate, images already in the draft
 *                            (![](…), <img src>, bare image paths and URLs,
 *                            frontmatter image/logo) are found automatically.
 *   --proposal-out=<file>    with --dry-run: also save the proposed file as JSON
 *                            ({ file, mode, content, problems, warnings, … }) at
 *                            this path, so a tool can show it and then write
 *                            exactly that version.
 *
 * <page> is a content slug (e.g. "products"), a URL, or a file path under
 * content/ or templates/. --generate and --from-html only take a markdown page
 * under content/. The HTML file must be inside the repository.
 *
 * With no <page> argument, every { file, instruction, images?, mode?, source? }
 * entry in scripts/page-commands.json's "queue" is applied in order and removed
 * from the queue as it succeeds ("mode": "generate" runs a generate job, and
 * "mode": "convert" with "source": "<file.html>" a convert job; the instruction
 * of either may be empty). With a <page> argument, that one edit runs
 * immediately and scripts/page-commands.json is not touched — add entries to
 * the queue by hand.
 *
 * "Problems" (a cut-off reply, unbalanced template blocks, a lost image, a
 * changed slug…) stop the file being written. "Warnings" are printed, but
 * don't.
 *
 * Requires ANTHROPIC_API_KEY.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson, loadSite } from './lib/content.js';
import { parseFrontmatter, renderMarkdown } from './lib/markdown.js';
import { TemplateEngine } from './lib/template.js';
import { renderCheck, scriptCheck } from './lib/render-check.js';
import { bannedPhraseWarnings, requestClaude, resolveImages, stripFence } from './lib/claude-writer.js';
import { knowledgePrompt, recordWork, summarizeChange } from './lib/knowledge.js';
import { BLANK_LAYOUT_RULES, DESIGN_RULES, layoutShowsTitle } from './lib/design-rules.js';
import {
  MAX_CLEAN_CHARS,
  asRawBlock,
  bodyAttributes,
  cleanHtml,
  presentationalHints,
  htmlImages,
  readCssSource,
  readHtmlSource,
  readJsSource,
  rewriteImages,
  scriptsIn,
  stylesheetsIn,
  svgDefinitions,
  visibleText,
} from './lib/html-source.js';
import { detectReveal, scaleInlineRem, scopeCss } from './lib/css-scope.js';
import { globalStylesheets } from './lib/scaffold-tree-runner.js';

const COMMANDS_PATH = path.join(ROOT, 'scripts/page-commands.json');
const DEFAULT_QUEUE_COMMENT = 'Queue of pending edits for `npm run page:edit` (no arguments). Each entry is one job: { file, instruction }, optionally with "images": [...] and "mode": "generate" (turn the file\'s own draft into the finished page; the instruction may then be empty). Running with no arguments processes every entry in order, writes each one, then removes it from this queue. Add entries by hand any time; running `npm run page:edit -- <page> "<instruction>"` with arguments applies that edit immediately instead and never touches this file.';
const EDITABLE_ROOTS = ['content', 'templates', 'styles/main.css', 'site.config.json'];
const MAX_TOKENS = 16000;
// Keeps the request well inside the API's 32 MB limit (base64 adds a third).
const MAX_VISION_IMAGES = 20;
const MAX_VISION_BYTES = 18 * 1024 * 1024;
// Fields that decide where a page lives and whether it's published.
const LOCKED_FIELDS = ['slug', 'url', 'layout', 'date', 'draft', 'order'];
// What a converted page keeps of the page it replaces: where it lives, whether it's listed and
// indexed, the search phrase and canonical URL it's meant for (lib/seo.js), and the listing facts
// an HTML page doesn't carry. The title is kept only as a fallback and the description never (see
// replacedPage). Everything else (body, hero, highlights, FAQ topics, call to action, the SEO title
// and description written for the old copy…) is the old page's content and goes.
const REPLACE_KEEPS = [...LOCKED_FIELDS, 'title', 'description', 'noindex', 'navHidden', 'author', 'category', 'tags', 'focusKeyword', 'canonical'];

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const positional = argv.filter((a) => !a.startsWith('--'));
const dryRun = Boolean(flag('dry-run'));
const generateFlag = Boolean(flag('generate'));
const imageArgs = argv.filter((a) => a.startsWith('--image=')).map((a) => a.slice('--image='.length));
const proposalOut = flag('proposal-out');
const fromHtml = flag('from-html');
// A conversion keeps the page's own HTML and CSS unless --markdown asks for it to be rewritten in
// the site's design. --keep-styles is still accepted (it was needed before this was the default).
const markdownFlag = Boolean(flag('markdown'));
const keepStylesFlag = !markdownFlag;
const cssArgs = argv.filter((a) => a.startsWith('--css=')).map((a) => a.slice('--css='.length));
// Scripts the page loads from its own files (<script src="js/main.js">), like --css for stylesheets.
const jsArgs = argv.filter((a) => a.startsWith('--js=')).map((a) => a.slice('--js='.length));
const noRenderCheck = Boolean(flag('no-render-check'));

const site = readJson(path.join(ROOT, 'site.config.json'));
// The Twinstack web app passes the account's chosen model; run by hand, the site's own setting.
const CLAUDE_MODEL = process.env.TWINSTACK_MODEL || site.automation.model;
const apiKey = process.env.ANTHROPIC_API_KEY;

/* ------------------------------------------------------------------ queue */

function loadQueue() {
  if (!fs.existsSync(COMMANDS_PATH)) return { _comment: '', queue: [] };
  const parsed = readJson(COMMANDS_PATH);
  return { _comment: parsed._comment || '', queue: parsed.queue || [] };
}

function writeQueue(registry) {
  fs.writeFileSync(COMMANDS_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

if (flag('list')) {
  const { queue } = loadQueue();
  if (!queue.length) {
    console.log('\n  Queue is empty. scripts/page-commands.json has nothing pending.\n');
  } else {
    console.log(`\n  Pending (${queue.length}):\n`);
    for (const job of queue) {
      console.log(`  file:        ${job.file}`);
      if (job.mode === 'generate') console.log('  mode:        generate');
      if (job.mode === 'convert') console.log(`  mode:        convert from ${job.source || '(no source given)'}`);
      console.log(`  instruction: ${job.instruction}\n`);
    }
  }
  process.exit(0);
}

/* ----------------------------------------------------------------- target */

function resolveFile(pageArg) {
  const direct = path.posix.normalize(String(pageArg).replace(/\\/g, '/')).replace(/^\.\//, '');
  if (
    direct.startsWith('content/') ||
    direct.startsWith('templates/') ||
    direct.startsWith('styles/') ||
    direct === 'site.config.json'
  ) {
    return direct;
  }

  const { all } = loadSite({ includeDrafts: true, includeFuture: true });
  const bare = direct.replace(/^\/|\/$/g, '').replace(/\.html$/, '');
  const match =
    all.find((e) => e.slug === direct) ||
    all.find((e) => e.url === direct) ||
    all.find((e) => e.url.replace(/^\/|\/$/g, '').replace(/\.html$/, '') === bare);

  return match ? match.sourceFile.replace(/\\/g, '/') : null;
}

function isEditable(relPath) {
  // Normalised first, so "content/../.env" can't pass as a content file.
  const normalised = path.posix.normalize(relPath);
  if (normalised !== relPath || normalised.startsWith('../') || path.posix.isAbsolute(normalised)) return false;
  return EDITABLE_ROOTS.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

/* ------------------------------------------------------- site knowledge */

const listNames = (dir, ext) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort()
    : [];

const partialNames = () => listNames(path.join(ROOT, 'templates/partials'), '.html').filter((n) => n !== 'base');
const dataNames = () => listNames(path.join(ROOT, 'content/data'), '.json');

/** The collection a content file belongs to, from site.config.json's dirs. */
function collectionFor(relFile) {
  const entries = Object.entries(site.collections || {})
    .filter(([, c]) => typeof c.dir === 'string' && relFile.startsWith(`${c.dir.replace(/\/$/, '')}/`))
    .sort((a, b) => b[1].dir.length - a[1].dir.length);
  return entries[0] ? { name: entries[0][0], ...entries[0][1] } : null;
}

/** Every URL a page can link to: pages, collection indexes and the homepage. */
function internalUrls() {
  const urls = new Set(['/']);
  try {
    for (const entry of loadSite({ includeDrafts: true, includeFuture: true }).all) urls.add(entry.url);
  } catch {
    // A broken page elsewhere shouldn't stop this one being edited.
  }
  for (const collection of Object.values(site.collections || {})) {
    if (collection.index?.url) urls.add(collection.index.url);
  }
  return [...urls].sort();
}

const TEMPLATE_SYNTAX = `TEMPLATE ENGINE SYNTAX (only what exists — do not use anything not listed here)
  {{ value }}                 escaped output
  {{{ value }}}               raw HTML output
  {{# if value }} … {{ else }} … {{/ if }}
  {{# unless value }} … {{/ unless }}
  {{# each list }} … {{/ each }}   inside: {{ this }}, {{ @index }}, {{ @number }}, {{ @first }}, {{ @last }}, {{ @odd }}
  {{> partial-name }}         include templates/partials/partial-name.html
  {{> [value] }}              include the partial NAMED by the looked-up value, not a
                               literal — e.g. a data file's section list with entries
                               like { "partial": "section-products", ... } rendered by
                               {{# each data.<file>.sections }}{{> [partial] }}{{/ each }}

GOTCHA — {{#each}} inside a markdown content file, producing a markdown list:
Rendering happens BEFORE markdown conversion, so a line break right after
"{{# each x }}" or right before "{{/ each }}" becomes a real blank line
between each rendered item, and the markdown parser then reads every item as
its own separate one-item list instead of one shared list. Write the loop
with the item's own markdown line immediately after the opening tag, e.g.:
  {{# each recentPosts }}- [{{ title }}]({{ url }}) — {{ dateFormatted }}
  {{/ each }}
(item text on the same line as the opening tag, closing tag on its own line)
— not with a line break after the opening tag.`;

/** What a content body or template can reference, read from the site as it is now. */
function contextVariables() {
  const collections = Object.keys(site.collections || {}).join(', ');
  const data = dataNames().map((n) => `data.${n}`).join(', ');
  const partials = partialNames().map((n) => `{{> ${n} }}`).join(', ');
  return `Variables in scope: site (site.config.json, e.g. site.contact.email, site.name), data.<jsonFileName> (every file in content/data/: ${data || 'none yet'}), nav (header.items/header.cta/footer/legal), page (this file's own frontmatter plus derived fields: title, description, url, tagline, content, headings, dateFormatted, readingTime...), and every collection as a flat list usable directly in {{#each}}: ${collections} (each item has at least title, url, description, excerpt, tagline, image, date, dateFormatted, tags). Also in scope: faqItems, isHome, latestPosts (3 most recent blog posts, excluding this page), recentPosts (5 most recent blog posts, excluding this page), productPosts (up to 5 most recent blog posts whose relatedProduct frontmatter points at a /products/ page), otherProducts, otherServices (up to 3), relatedItems. The template engine cannot slice or numerically compare inside {{#each}} — no "first N" of an arbitrary list. If you need a specific count that isn't already one of the pre-sliced lists above, loop the whole collection instead of inventing comparison logic that doesn't exist in this engine. The partials that exist are: ${partials || 'none'}. Never include one that isn't listed.`;
}

const HOUSE_RULES = `HOUSE RULES (from CLAUDE.md — follow these exactly)
- Never hardcode a fact that appears, or could appear, on more than one page (contact details, stats, FAQ entries). Reference site.*, data.* or a collection instead.
- Never hand-list content that a collection already provides (products, services, posts, case studies) — loop over the collection with {{#each}}.
- Do not invent facts: statistics, client names, release numbers, or claims about how a product or platform behaves need to already be true of the codebase you can see. If unsure, describe the shape of the thing rather than quantifying it.
- British spelling, sentence case headings, plain verbs. No exclamation marks, no "unlock", "seamless", "game-changing", "dive in".
- Utilities belong inline in templates; only touch styles/main.css for tokens or patterns already repeated three or more times elsewhere, and never touch assets/css/main.css (it is compiled output).`;

/** knowledge/ (the owner's notes and the work log) as a prompt section ending in a blank line, or ''. */
function knowledgeSection() {
  const section = knowledgePrompt();
  return section ? `${section}\n\n` : '';
}

/* ------------------------------------------------------------ edit prompt */

function buildEditPrompts(relFile, instruction, original, images = []) {
  const isContent = relFile.startsWith('content/') && relFile.endsWith('.md');

  const contextNote = isContent
    ? `This file is a markdown content file. Its body is rendered as a template BEFORE markdown conversion, so template syntax works directly in the body. ${contextVariables()}

${bodyRules(layoutFor(relFile, parseFrontmatter(original).data))}`
    : relFile.startsWith('templates/')
      ? `This file is an HTML template rendered with the same template engine as content files. It has no server-side logic beyond the engine's own syntax. ${contextVariables()}`
      : `This is a site-wide config or stylesheet file, not rendered through the template engine.`;

  const systemPrompt = `You edit one existing file in the source of ${site.name}'s static site (${site.description}). You will be given the file's full current contents and an instruction. Return the complete new file, and nothing else.

${TEMPLATE_SYNTAX}

${contextNote}

${DESIGN_RULES}

${HOUSE_RULES}
- Preserve everything about the file that the instruction doesn't ask you to change: frontmatter fields and their order, unrelated sections, existing classes and structure, indentation style.

${knowledgeSection()}OUTPUT
Return only the raw contents of the new file, starting from its very first character (frontmatter's opening "---" for a content file). No commentary, no explanation, no surrounding code fence.`;

  const userPrompt = `File: ${relFile}

----- current contents -----
${original}
----- end current contents -----

Instruction: ${instruction}${editImagesNote(images)}`;

  return { systemPrompt, userPrompt, isContent };
}

// Partials every page has around it; they aren't part of one page's content.
const CHROME_PARTIALS = new Set(['base', 'header', 'footer', 'breadcrumbs']);

/**
 * What a content page shows besides its own file, found from its layout: the
 * content/data/*.json files it reads (data.<name>), directly or through the
 * partials it includes, whether named in the template ({{> stats }}) or by a
 * data file ({{> [partial] }} with "partial" fields, a data-driven list of
 * sections). Returns { layout, dataFiles, partials: [{ name,
 * source }], showsBody } — showsBody is false when nothing renders the page's
 * own body (a layout made of data-driven sections, unless a "section-content"
 * section is listed).
 */
function pageSources(relFile, original) {
  const layout = layoutFor(relFile, parseFrontmatter(original).data);
  const dataUsed = new Set();
  const partials = new Map();
  let dynamic = false;
  let showsBody = /\bpage\.content\b/.test(layout.source);
  const visit = (source) => {
    for (const m of source.matchAll(/\bdata\.([A-Za-z_]\w*)/g)) dataUsed.add(m[1]);
    for (const m of source.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)) addPartial(m[1]);
    if (/\{\{>\s*\[/.test(source)) dynamic = true;
  };
  const addPartial = (name) => {
    if (partials.has(name) || CHROME_PARTIALS.has(name)) return;
    const file = path.join(ROOT, 'templates/partials', `${name}.html`);
    if (!/^[\w-]+$/.test(name) || !fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf8');
    partials.set(name, source);
    visit(source);
  };
  visit(layout.source);
  // Sections picked by a data file's "partial" fields, and every section type it could pick.
  if (dynamic) {
    for (const name of [...dataUsed]) {
      const file = path.join(ROOT, 'content/data', `${name}.json`);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/"partial"\s*:\s*"([\w-]+)"/g)) {
        addPartial(m[1]);
        if (/\bpage\.content\b/.test(partials.get(m[1]) || '')) showsBody = true;
      }
    }
    for (const name of partialNames()) if (/^section-/.test(name)) addPartial(name);
  }
  const dataFiles = [...dataUsed]
    .map((name) => `content/data/${name}.json`)
    .filter((file) => fs.existsSync(path.join(ROOT, file)));
  return { layout, dataFiles, partials: [...partials].map(([name, source]) => ({ name, source })), showsBody, dynamic };
}

const FILE_BLOCK = /^=====\s*FILE:\s*(\S+)\s*=====\r?\n([\s\S]*?)\r?\n=====\s*END FILE\s*=====/gm;

/**
 * Editing a page that shows shared data (the homepage's sections, say): Claude
 * gets the page and those data files, with the templates that render them for
 * reference, and returns each file it changes in a FILE block.
 */
function buildPageEditPrompts(relFile, instruction, original, images, sources) {
  const files = [relFile, ...sources.dataFiles];
  // Partials a section entry can name: the ones that render a whole <section> (not section-head, a part of one).
  const sectionPartials = sources.partials.filter((p) => /<section\b/.test(p.source)).map((p) => p.name);
  const bodyNote = sources.showsBody
    ? "The page's body is shown on the page."
    : `This layout doesn't show the page's body: what the page shows is its frontmatter fields the layout reads (${sources.layout.fields.join(', ') || 'none'}) and the data files below. Writing in the body alone changes nothing visible.${sectionPartials.includes('section-content') ? ' To put free-form content on the page, write it in the body and list a section with "partial": "section-content" (it may have kicker, heading and text) where it should appear.' : ''}`;

  const systemPrompt = `You edit one page of ${site.name}'s static site (${site.description}). The page is made of more than one file: its content file and the shared data files its templates read. You get them all, with the templates for reference, and an instruction. Change whichever files the instruction needs, and only those.

${TEMPLATE_SYNTAX}

HOW THIS PAGE IS BUILT
${relFile} renders through templates/layouts/${sources.layout.name}.html. ${bodyNote}
${sources.dynamic ? `Sections listed in a data file are rendered by the partial each one names in "partial". The section partials that exist: ${sectionPartials.join(', ')}. A section may only use one of these, and only the fields its template reads.\n` : ''}- Data files are shared: other pages may show them too (stats, process steps). Keep their JSON valid and their structure (the keys the templates read).
- You can't change templates here: they decide what fields exist. If the instruction needs a new kind of section or a layout change, do what the files allow and say nothing about the rest.

${contextVariables()}

${DESIGN_RULES}

${HOUSE_RULES}
- Preserve everything the instruction doesn't ask you to change: fields and their order, unrelated sections, JSON key order and indentation.

${knowledgeSection()}OUTPUT
Return each file you change, complete, in a block:
===== FILE: <path> =====
<the whole new file>
===== END FILE =====
Only files from this list: ${files.join(', ')}. Leave out the ones you don't change. Nothing outside the blocks: no commentary, no code fences.`;

  const fileText = (file) => (file === relFile ? original : fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const userPrompt = `${files.map((file) => `----- ${file} -----\n${fileText(file)}\n----- end ${file} -----`).join('\n\n')}

----- templates (for reference, not editable) -----
templates/layouts/${sources.layout.name}.html:
${sources.layout.source}
${sources.partials.map((p) => `\ntemplates/partials/${p.name}.html:\n${p.source.trim()}`).join('\n')}
----- end templates -----

Instruction: ${instruction}${editImagesNote(images)}`;

  return { systemPrompt, userPrompt, isContent: true, files };
}

/**
 * The files in a multi-file edit reply. Returns { raw (the page, unchanged if
 * not returned), files: [{ file, content }] (changed data files), problems,
 * warnings }.
 */
function readPageEditReply(text, relFile, original, sources) {
  const problems = [];
  const warnings = [];
  const allowed = new Set([relFile, ...sources.dataFiles]);
  let raw = original;
  const files = [];
  const blocks = [...stripFence(text.trim()).matchAll(FILE_BLOCK)];
  if (!blocks.length) problems.push("Claude's reply had no FILE blocks, so nothing could be read from it");
  for (const [, file, body] of blocks) {
    if (!allowed.has(file)) {
      problems.push(`the reply changes ${file}, which isn't one of this page's files`);
      continue;
    }
    if (file === relFile) {
      raw = fileFromReply(body);
      continue;
    }
    const current = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const content = body.endsWith('\n') ? body : `${body}\n`;
    try {
      JSON.parse(content);
    } catch (error) {
      problems.push(`${file} is no longer valid JSON: ${error.message}`);
      continue;
    }
    if (content.trim() !== current.trim()) files.push({ file, content });
  }
  if (raw !== original) {
    const checked = editChecks(original, raw, true);
    problems.push(...checked.problems, ...frontmatterProblems(original, raw));
  }
  // A section must name a partial that exists.
  const known = new Set(partialNames());
  for (const { file, content } of files) {
    for (const m of content.matchAll(/"partial"\s*:\s*"([^"]*)"/g)) {
      if (!known.has(m[1])) problems.push(`${file} lists a section with partial "${m[1]}", which doesn't exist`);
    }
  }
  if (raw === original && !files.length && blocks.length) warnings.push('Claude changed nothing');
  for (const { file } of files) warnings.push(`also changes ${file}, which other pages may show too`);
  return { raw, files, problems, warnings };
}

/** The part of an edit prompt that tells Claude how to use the supplied images. */
function editImagesNote(images) {
  if (!images.length) return '';
  const list = images
    .map((image, i) => `  ${i + 1}. ${image.ref}${image.block ? '' : ` (not shown to you: ${image.why || 'unsupported type or too large'})`}`)
    .join('\n');
  return `

Images supplied with this instruction (the ones you can see are attached above, in the same order):
${list}
Use them where the instruction asks. Reference each one with exactly the path or URL listed, e.g. ![Alt text](${images[0].ref}). Write alt text that describes what the image actually shows. Never invent other image paths.`;
}

/* -------------------------------------------------------- generate prompt */

const FRONTMATTER_SYNTAX = `FRONTMATTER SYNTAX (the site's own parser reads only these forms)
  key: value                  one line; wrap the value in double quotes if it contains ": " or " #", or starts with a quote, [, {, >, |, - or *
  key: [a, b, c]              an inline list of short plain values
  key:                        a block list, one item per line, indented two spaces:
    - First item
  key:                        a list of objects, the object's other fields indented to line up:
    - title: First
      body: Text
No multi-line strings (| or >), no nested lists, no inline {…} objects, no blank "key:" lines that aren't followed by a list.`;

function buildGeneratePrompts(relFile, instruction, original, images, layoutInfo) {
  const urls = internalUrls();
  const imageList = images.length
    ? images
        .map((image, i) => {
          const where = image.inFrontmatter ? ` — from frontmatter "${image.inFrontmatter}", keep it there` : '';
          const seen = image.block
            ? ''
            : ` (not shown to you: ${image.why || 'unsupported type or too large'} — take its alt text from the draft's own words about it, not from other images)`;
          return `  ${i + 1}. ${image.ref}${where}${seen}`;
        })
        .join('\n')
    : '  None. The draft has no images, so add none.';

  const systemPrompt = `You turn an author's draft into the finished page for ${site.name}'s website (${site.description}). The draft is an existing markdown content file: the author has written what the page should say, perhaps roughly — notes, pasted copy, lists, images and image URLs. Rewrite it into the complete, publishable file.

WORKING FROM THE DRAFT — the most important rules here
- The draft is your only source of facts. Keep every fact, figure, name, link and image the author included, and add none of your own: no statistics, clients, quotes, dates or claims that aren't in it. Don't add detail the draft doesn't contain even when it's plausible or generally true — no extra features, examples, reassurances ("no risk", "guaranteed"), outcomes or figures. If the draft is thin, write a short page rather than padding it.
- Improve everything else: give it a clear structure with "##" (and if needed "###") section headings in a sensible order, turn rough notes into clear sentences, use a list where the material is a list and a table where it is a comparison, remove repetition.
- Improving is rewording, not elaborating. A short phrase in the draft ("ship small") stays a short item; don't explain it with reasons or practices the draft doesn't give. In a table, a cell the draft says nothing about is "—", never a guess. Don't write a sentence to introduce an image or a section when the draft has nothing to say there.
- The description of the company at the top of these instructions is background, not material: don't copy it into the page.
- Keep the author's meaning, emphasis and tone. Where the draft already reads well, keep its wording.
- Text addressed to the writer rather than the reader — HTML comments, lines starting "TODO", "Note:" or "Claude:", or [square-bracketed requests] — is an instruction: follow it, and leave it out of the page.
- Keep existing links (with their URLs unchanged). Add a link only where it genuinely helps the reader, and only to a page from this list:
${urls.map((u) => `    ${u}`).join('\n')}
  Never invent a URL.

FRONTMATTER
- Keep every existing field and its value unless the draft's own notes ask for a change. Keep the title.
- Never add, change or remove ${LOCKED_FIELDS.join(', ')}: the site derives them when they're missing, and changing them moves or unpublishes the page.
- Fill in fields the layout reads (listed below) that are missing or empty, but only when the draft contains the material for them — for example a tagline, highlights, deliverables or steps. Material that has moved into such a field should not also be repeated in the body.
- If description is missing or empty, write one: a plain sentence of at most 160 characters summarising the page.

${FRONTMATTER_SYNTAX}

${layoutSection(layoutInfo)}

IMAGES
${imageList}
- Every image listed must still appear in the file, referenced by exactly the path or URL listed (paths are root-relative, starting with "/"). Never invent or alter an image path.
- The images you can see are attached above the draft, in the same order. Alt text says what is visibly in the image, specifically — never "image of", and never a meaning the draft doesn't give it (a chart with no labels is "a bar chart with three rising bars", not a claim about what it measures). For an image you can't see, base the alt text only on what the draft says about it.
- Put each image where it fits the text around it. Use markdown for a plain image: ![Alt text](path). Add a caption only when the draft says what the image shows, and then only in the draft's terms, as an HTML block with blank lines before and after it and none inside it:
<figure>
  <img src="path" alt="Alt text" loading="lazy">
  <figcaption>Caption</figcaption>
</figure>

${TEMPLATE_SYNTAX}

This file's body is rendered as a template BEFORE markdown conversion, so template syntax works directly in the body. ${contextVariables()}

${DESIGN_RULES}

${HOUSE_RULES}

${knowledgeSection()}OUTPUT
Before answering, check each sentence, list item and frontmatter value against the draft: if it states something the draft doesn't (a detail, qualifier, promise or next step), remove it. Then return only the raw contents of the finished file, starting with the opening "---" of the frontmatter. No commentary, no explanation, no surrounding code fence.`;

  const userPrompt = `File: ${relFile}

----- draft -----
${original}
----- end draft -----

${instruction ? `Extra direction from the author: ${instruction}` : 'Turn this draft into the finished page.'}`;

  return { systemPrompt, userPrompt, isContent: true };
}

/** What the body must do given its layout: not repeat a title the layout shows, or be the whole page. */
function bodyRules(layoutInfo) {
  return layoutShowsTitle(layoutInfo.source)
    ? '- Do not add a leading "# Title" heading in the body: the layout renders the title separately.'
    : BLANK_LAYOUT_RULES;
}

/** The generate and convert prompts' description of the page's layout. */
function layoutSection(layoutInfo) {
  const showsTitle = layoutShowsTitle(layoutInfo.source);
  const intro = showsTitle
    ? `This page renders through templates/layouts/${layoutInfo.name}.html. The layout already shows the title and hero above the body and any FAQ, call to action and related items after it, so the body must not repeat them. Fields this layout reads from the frontmatter: ${layoutInfo.fields.length ? layoutInfo.fields.join(', ') : 'none beyond title'}.`
    : `This page renders through templates/layouts/${layoutInfo.name}.html, which shows only the body. Where the instructions above say markdown, headings or fields the layout reads, apply them to the HTML you write instead: "##" sections become <h2> headings inside <section>s, and no frontmatter fields beyond title and description are shown.

${BLANK_LAYOUT_RULES}`;
  return `THE PAGE'S LAYOUT
${intro}
----- templates/layouts/${layoutInfo.name}.html -----
${layoutInfo.source || '(layout file not found)'}
----- end layout -----`;
}

/** The layout a content file renders with: its source and the page.* fields it reads. */
function layoutFor(relFile, frontmatter) {
  const name = String(frontmatter.layout || collectionFor(relFile)?.layout || 'page');
  const file = path.join(ROOT, 'templates/layouts', `${name}.html`);
  const source = /^[\w-]+$/.test(name) && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  const derived = new Set(['content', 'headings', 'url', 'absoluteUrl', 'slug', 'readingTime', 'dateFormatted', 'excerpt', 'body', 'parentLabel', 'parentUrl', 'collection', 'sourceFile']);
  const fields = [...new Set([...source.matchAll(/\bpage\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].filter((f) => !derived.has(f));
  return { name, source, fields };
}

/* --------------------------------------------------------- convert prompt */

function buildConvertPrompts(relFile, instruction, original, images, layoutInfo, page) {
  const urls = internalUrls();
  const imageList = images.length
    ? images
        .map((image, i) => {
          const from = image.src && image.src !== image.ref ? ` (src="${image.src}" in the HTML)` : '';
          const seen = image.block ? '' : ` (not shown to you: ${image.why || 'unsupported type or too large'} — use its alt text from the HTML)`;
          return `  ${i + 1}. ${image.ref}${from}${seen}`;
        })
        .join('\n')
    : '  None.';
  const unavailable = page.unavailable.length
    ? `\nThese images in the HTML aren't available to this site, so leave them out entirely (the author will add them later): ${page.unavailable.join(', ')}`
    : '';
  const { data } = parseFrontmatter(original);

  const systemPrompt = `You convert an existing web page's HTML into a markdown content file for ${site.name}'s website (${site.description}). The page has been moved here from somewhere else. The author wants the same page, with the same content, in this site's format.

WHAT TO KEEP AND WHAT TO LEAVE OUT
- Convert the page's own content: every heading, paragraph, list, table, quote, link and image, in the same order and with the same wording. This is a conversion, not a rewrite. Don't summarise, shorten, expand or reword, except to fix obvious HTML debris (stray entities, words split by tags).
- Leave out everything that belongs to the old site rather than to this page: its header (logo, site name, top menu), footer (copyright, footer links, addresses repeated on every page, social icons, newsletter sign-up), navigation, breadcrumbs, sidebars, cookie banners, "skip to content" links, search boxes, share buttons and related-post widgets. Most of these have already been removed from the HTML you're given; leave out any that remain. The new site renders its own header, footer, navigation and call to action around this page.
- Leave out forms and buttons that only worked with the old site's scripts. Keep links that point somewhere real.
- Add nothing: no facts, sentences, headings or images that aren't in the HTML. The description of the company at the top of these instructions is background, not material.

HOW TO WRITE IT
- Headings: the page's main heading (usually the <h1>) becomes the page title, not a body heading. Body headings start at "##"; keep their relative levels ("###" under "##").
- Use markdown for paragraphs, emphasis, lists, links, images and simple tables. Keep raw HTML only for what markdown can't express (a table with merged cells, an embedded video), as an HTML block with blank lines before and after it and none inside it.
- Links: keep each link's URL unchanged. If it clearly points at a page that exists on this site, use that page's address from this list instead:
${urls.map((u) => `    ${u}`).join('\n')}
- Never write "{{" or "}}": this file is rendered as a template, so literal braces break it. Reword around them.

FRONTMATTER
- The HTML page completely replaces the page that was there. The current file below has only the fields that identify the page: the old page's body and content fields (hero text, highlights, FAQ topics, call to action…) have been removed and must not come back.
- title: the page's main heading (its <h1>), or else the HTML <title> without the site name. Keep the current title only if the HTML has neither.
- description: if the current file has one, it's the HTML's meta description: keep it exactly. Otherwise use the HTML's meta description shortened to at most 160 characters if it's longer, or else write one plain sentence summarising the page. A current description that is a note to the writer (such as "Under 160 characters, written for search results.") counts as missing.
- Keep every other existing field and its value. Never add, change or remove ${LOCKED_FIELDS.join(', ')}: changing them moves or unpublishes the page.
- Fill in fields this layout reads (listed below), but only from material that is in the HTML — for example an intro paragraph under the main heading as heroText, or a list that matches deliverables. Leave out any field the HTML has nothing for. Material moved into such a field shouldn't also be repeated in the body.

${FRONTMATTER_SYNTAX}

${layoutSection(layoutInfo)}

IMAGES
${imageList}${unavailable}
- Reference each image by exactly the path or URL listed (not the HTML's src when they differ). Never invent or alter an image path.
- The images you can see are attached above, in the same order. Keep the HTML's alt text when it describes the image; otherwise write alt text that says what is visibly in the image. Use ![Alt text](path), or the HTML <figure> form for an image that had a caption:
<figure>
  <img src="path" alt="Alt text" loading="lazy">
  <figcaption>Caption</figcaption>
</figure>
- Leave out purely decorative images (spacers, dividers, icons next to a heading).

${DESIGN_RULES}

${HOUSE_RULES.replace(/^- (British spelling|Do not invent facts).*\n/gm, '')}
- Keep the original wording even where it doesn't follow this site's style: the author asked for a conversion. Only follow the style rules for text you have to write yourself (a description, alt text).

${knowledgeSection()}OUTPUT
Return only the raw contents of the finished file, starting with the opening "---" of the frontmatter. No commentary, no explanation, no surrounding code fence.`;

  const userPrompt = `File: ${relFile}

----- current file (what's left of the old page: the fields that identify it) -----
${original}
----- end current file -----

HTML page to convert: ${page.file}${page.title ? `\n<title>: ${page.title}` : ''}${page.description ? `\nMeta description: ${page.description}` : ''}${data.title ? '' : '\nThe current file has no title.'}
${page.removed.length ? `Already removed from it: ${page.removed.join(', ')}.\n` : ''}
----- HTML -----
${page.html}
----- end HTML -----

${instruction ? `Extra direction from the author: ${instruction}` : 'Convert this page.'}`;

  return { systemPrompt, userPrompt, isContent: true };
}

/** With --keep-styles Claude writes only the frontmatter; the body is the old page's own HTML. */
function buildStyledFrontmatterPrompts(relFile, instruction, original, page, textPage) {
  const systemPrompt = `You write the frontmatter for a page on ${site.name}'s website (${site.description}). The page's body is an existing web page's HTML, copied as-is with its own styling, so you don't write or change the body: you return only the frontmatter block.

FRONTMATTER
- This page completely replaces the one that was there. The current file below has only the fields that identify the page; the old page's content is gone and must not come back.
- title: the page's name, as its HTML <title> gives it without the old site's name ("About us | Northwind" gives "About us"). The page shows its own heading, so the title is only used in the browser tab, search results and listings: keep it short. If the <title> is missing or is only the site's name, use a short form of the main heading (<h1>). Keep the current title only if the page has neither.
- description: if the current file has one, it's the HTML's meta description: keep it exactly. Otherwise use the HTML's meta description shortened to at most 160 characters if it's longer, or else write one plain sentence summarising the page from its text.
- Keep every other field and its value exactly. Never add, change or remove ${LOCKED_FIELDS.join(', ')}: changing them moves or unpublishes the page.
- Add no other fields (heroHeading, heroText, kicker, highlights…): the page shows its own HTML edge to edge, so they would never appear, and they're removed anyway.
- Add nothing that isn't in the page's text. British spelling, no exclamation marks.

${FRONTMATTER_SYNTAX}

${knowledgeSection()}OUTPUT
Return only the frontmatter block: a line "---", the fields, and a closing line "---". Nothing before or after it, no code fence.`;

  const userPrompt = `File: ${relFile}

----- current file (what's left of the old page: the fields that identify it) -----
${original}
----- end current file -----

The page it now shows: ${page.file}${page.title ? `\n<title>: ${page.title}` : ''}${page.description ? `\nMeta description: ${page.description}` : ''}
----- the page's text (simplified HTML) -----
${textPage.html.slice(0, 40000)}
----- end page -----

${instruction ? `Extra direction from the author: ${instruction}` : 'Write the frontmatter.'}`;

  return { systemPrompt, userPrompt };
}

/** Where a page's imported scripts live: assets/js/imported/<page>/. */
function importedScriptDir(relFile) {
  return importedStylesheet(relFile).replace(/^assets\/css\/imported\/(.*)\.css$/, 'assets/js/imported/$1');
}

/**
 * The page's scripts, kept in their order and place (<head> or the end of the
 * body): inline ones saved as files in assets/js/imported/<page>/, ones from a
 * URL loaded from it, and ones from the old site's own files taken from the
 * uploads (`jsFiles`, matched by file name) or the repo. Returns { entries
 * (the "scripts" frontmatter), files, sources (what runs, for the script
 * check), warnings }.
 */
function keptScripts(html, jsFiles, relFile) {
  const dir = importedScriptDir(relFile);
  const uploads = jsFiles.map((f) => readJsSource(f));
  const used = new Set();
  const entries = [];
  const files = [];
  const sources = [];
  const warnings = [];
  let inline = 0;
  const keep = (script, src, code) => {
    entries.push({ src, head: script.head, module: script.module, nomodule: script.nomodule, defer: script.defer, async: script.async });
    sources.push({ ...script, src: code === null ? src : null, code });
  };
  for (const script of scriptsIn(html)) {
    if (script.code !== null) {
      const file = `${dir}/inline-${++inline}.js`;
      files.push({ file, content: script.code.replace(/^\s*\n/, '') });
      keep(script, `/${file}`, script.code);
      if (/\bdocument\.write(ln)?\s*\(/.test(script.code)) warnings.push(`inline script ${inline} uses document.write, which may not work as it did`);
      continue;
    }
    const src = script.src.startsWith('//') ? `https:${script.src}` : script.src;
    if (/^https?:/i.test(src)) {
      keep(script, src, null);
      continue;
    }
    const base = path.posix.basename(src.split(/[?#]/)[0]).toLowerCase();
    const upload = uploads.find((u) => !used.has(u) && path.posix.basename(u.file).toLowerCase() === base);
    if (upload) {
      used.add(upload);
      const file = `${dir}/${base.replace(/[^a-z0-9._-]+/g, '-')}`;
      files.push({ file, content: upload.code });
      keep(script, `/${file}`, upload.code);
      continue;
    }
    const inRepo = siteImage(src);
    if (inRepo) keep(script, inRepo, fs.readFileSync(path.join(ROOT, inRepo.slice(1)), 'utf8'));
    else warnings.push(`the page loads ${script.src}, which wasn't uploaded, so it's left out. Upload it with the HTML to keep it`);
  }
  for (const u of uploads.filter((x) => !used.has(x))) warnings.push(`${path.posix.basename(u.file)} was uploaded, but the page doesn't load it`);
  return { entries, files, sources, warnings };
}

/** Where a page's imported stylesheet lives: assets/css/imported/<page>.css. */
function importedStylesheet(relFile) {
  const name = path.posix.basename(relFile, '.md').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  return `assets/css/imported/${name}.css`;
}

const IMPORT_SCOPE = 'imported-page';
const IMPORT_PREFIX = 'imp-';
const MAX_IMPORTED_CSS = 600 * 1024;
// Web-font services whose stylesheets only declare fonts, so the page loads them as they are.
const FONT_STYLESHEET = /^(https?:)?\/\/(fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|api\.fontshare\.com)\//i;

/** Points an <img> at what the site can show: URLs as they are, repo files as "/…", anything else null. */
function siteImage(src) {
  const value = src.startsWith('//') ? `https:${src}` : src;
  if (/^https?:\/\//i.test(value)) return value;
  const relative = path.posix.normalize(value.split(/[?#]/)[0].replace(/^\/+/, '').replace(/^\.\//, ''));
  if (!relative.startsWith('../') && relative.split('/')[0] !== '.git' && fs.existsSync(path.join(ROOT, relative))) return `/${relative}`;
  return null;
}

const sheetName = (ref) => path.posix.basename(String(ref).split(/[?#]/)[0]).toLowerCase();

/**
 * The global stylesheets (declared in scripts/site-tree.md, kept in
 * styles/global/) for one conversion. An upload with a global's file name
 * replaces it: it's used for this page and saved over the stored one
 * (`globalUpdates`), so later pages get it without uploading it again.
 * Returns { globals: [{ path, file, css }], globalUpdates: [{ file, content }], notes }.
 */
function globalSheets(uploads) {
  const globals = [];
  const globalUpdates = [];
  const notes = [];
  const taken = new Set();
  for (const declared of globalStylesheets()) {
    const current = declared.exists ? fs.readFileSync(path.join(ROOT, declared.file), 'utf8') : null;
    const upload = uploads.find((u) => !taken.has(u) && sheetName(u.file) === sheetName(declared.path));
    if (!upload) {
      if (current !== null) globals.push({ ...declared, css: current });
      continue;
    }
    taken.add(upload);
    if (current === upload.css) continue;
    globalUpdates.push({ file: declared.file, content: upload.css });
    notes.push(current === null || /^\/\* Global stylesheet "/.test(current)
      ? `${sheetName(upload.file)} is saved as the site's global stylesheet ${declared.file}, so later pages get it without uploading it`
      : `${sheetName(upload.file)} replaces the global stylesheet ${declared.file}. Pages converted before keep the earlier version until they're converted again`);
  }
  return { globals, globalUpdates, notes };
}

/**
 * The stylesheets that stand in for a page's <link>s: the upload with the
 * link's file name, or else the global stylesheet its href points at.
 * `forLink(href)` takes each one once ({ name, css } or null); `rest()` is the
 * uploads no link took, which apply before the page's own CSS. A global
 * stylesheet the page doesn't link is left out: the page wasn't designed with
 * it (it may come from another design), and the copy must look like it.
 */
function standIns(uploads, globals) {
  const used = new Set();
  const take = (sheet, name) => {
    used.add(sheet);
    return { name, css: sheet.css };
  };
  return {
    forLink(href) {
      const base = sheetName(href);
      const upload = uploads.find((u) => !used.has(u) && sheetName(u.file) === base);
      if (upload) return take(upload, path.posix.basename(upload.file));
      const bare = href.split(/[?#]/)[0].replace(/^(?:\.{1,2}\/|\/)+/, '');
      const named = globals.filter((g) => !used.has(g) && sheetName(g.path) === base);
      const global = named.find((g) => bare === g.path || bare.endsWith(`/${g.path}`) || g.path.endsWith(`/${bare}`)) ?? named[0];
      return global ? take(global, global.file) : null;
    },
    rest: () => uploads.filter((u) => !used.has(u)).map((u) => ({ name: path.posix.basename(u.file), css: u.css })),
    // The global stylesheets the page's links took.
    usedGlobals: () => globals.filter((g) => used.has(g)),
  };
}

/**
 * --keep-styles: the body (the old page's HTML in one raw block, inside the
 * scope wrapper), the scoped stylesheet and the web fonts it needs. `cssFiles`
 * stand in for the page's linked stylesheets: one whose name matches a
 * <link href> takes that link's place in the cascade, and the rest come first.
 * The site tree's global stylesheets stand in for the links that point at them.
 */
function buildStyledPage(source, cssFiles, relFile, jsFiles = []) {
  const { file, html } = readHtmlSource(source);
  const page = cleanHtml(html, { keepStyles: true, prefix: IMPORT_PREFIX });
  if (!page.text && !/<(img|svg)\b/i.test(page.html)) throw new Error(`${file} has no content left once its header and footer are removed`);

  const warnings = [];
  const scripts = keptScripts(html, jsFiles, relFile);
  warnings.push(...scripts.warnings);
  const unavailable = [];
  let body = rewriteImages(page.html, (src) => {
    const resolved = siteImage(src);
    if (resolved === null) unavailable.push(src);
    return resolved;
  });
  for (const src of [...new Set(unavailable)]) {
    warnings.push(`left out ${src}: it isn't in this site. Upload the image and add it to the page if it's needed`);
  }
  for (const m of body.matchAll(/style\s*=\s*"[^"]*url\(\s*['"]?(?!https?:|data:|\/assets\/)([^'")]+)/gi)) {
    warnings.push(`an inline style refers to ${m[1]}, which isn't in this site, so that background won't load`);
  }

  // The page's own cascade: <style> blocks and <link>ed sheets in order, uploads and the site
  // tree's global stylesheets standing in for the links.
  const uploads = cssFiles.map((f) => readCssSource(f));
  const { globals, globalUpdates, notes } = globalSheets(uploads);
  warnings.push(...notes);
  const links = standIns(uploads, globals);
  const sheets = [];
  const fonts = [];
  const inMedia = (css, media) => (media ? `@media ${media} {\n${css}\n}` : css);
  for (const entry of stylesheetsIn(html)) {
    if (entry.inline !== undefined) {
      sheets.push({ name: 'inline <style>', css: inMedia(entry.inline, entry.media) });
      continue;
    }
    const match = links.forLink(entry.href);
    if (match) {
      sheets.push({ name: match.name, css: inMedia(match.css, entry.media) });
    } else if (FONT_STYLESHEET.test(entry.href)) {
      // Only @font-face rules: loaded from the page's <head> like the original did, so text doesn't
      // show in fallback fonts first.
      fonts.push(entry.href.replace(/^\/\//, 'https://'));
    } else if (!/^https?:|^\/\//i.test(entry.href)) {
      warnings.push(`the page links ${entry.href}, which wasn't uploaded, so its styles are missing. Upload it with the HTML`);
    } else {
      warnings.push(`the page links ${entry.href}; that stylesheet isn't copied. Download it and upload it with the HTML to include it`);
    }
  }
  const unmatched = links.rest().map(({ name, css }) => ({ name, css }));
  const appliedGlobals = links.usedGlobals();
  const unlinked = globals.filter((g) => !appliedGlobals.includes(g));
  if (unlinked.length) {
    warnings.push(`not applied: ${unlinked.map((g) => g.file).join(', ')}, because the page doesn't link ${unlinked.length === 1 ? 'it' : 'them'}`);
  }
  const allSheets = [...unmatched, ...sheets];
  const reveal = detectReveal(allSheets, page.classes);
  const scoped = scopeCss(allSheets, {
    scope: `.${IMPORT_SCOPE}`, prefix: IMPORT_PREFIX, classes: page.classes, ids: page.ids,
    rootClasses: page.rootClasses, rootIds: page.rootIds, reveal,
    hints: presentationalHints(body, `.${IMPORT_SCOPE}`, bodyAttributes(html)),
    // Scripts may add classes later, so rules for classes not in the markup stay (bar the removed parts').
    scripted: scripts.entries.length > 0, dropClasses: page.removedClasses, dropIds: page.removedIds,
  });
  // Icons drawn from a sprite outside the kept content (<use href="#i-arrow">) need it with them.
  const sprite = svgDefinitions(html, body, IMPORT_PREFIX);
  if (sprite) body += `\n${sprite}`;
  body = scaleInlineRem(body, scoped.remFactor);
  warnings.push(...scoped.warnings);
  if (!scoped.rules) warnings.push("no CSS rules apply to this page's content, so it will show with browser default styles");
  if (scoped.css.length > MAX_IMPORTED_CSS) throw new Error(`the page's CSS is over ${MAX_IMPORTED_CSS / 1024} KB even after unused rules are removed`);
  if (page.removed.length) warnings.push(`removed from the HTML: ${page.removed.join(', ')}`);

  // The old <html>/<body> classes now belong to the wrapper, so their rules still apply.
  const wrapperClass = [IMPORT_SCOPE, ...[...page.rootClasses].map((c) => IMPORT_PREFIX + c)].join(' ');
  return {
    file,
    html,
    uploads,
    // The site tree's global stylesheets the page links, which are applied to it.
    globals: appliedGlobals,
    // Global stylesheets an upload replaced, written with the page.
    globalUpdates,
    title: page.title,
    description: page.description,
    removed: page.removed,
    body: `<div class="${wrapperClass}"${revealAttributes(reveal, html)}>\n${asRawBlock(body)}\n</div>\n`,
    reveal,
    fonts: [...new Set(fonts)],
    stylesheet: { file: importedStylesheet(relFile), content: `/* Imported with ${path.posix.basename(file)} by scripts/edit-page.js --keep-styles. Scoped to .${IMPORT_SCOPE}; regenerate it by converting again. */\n${scoped.css}` },
    rules: scoped.rules,
    hoverClasses: hoverClassesIn(allSheets),
    // The page's scripts, and what assets/js/imported-page.js needs to run them (see base.html).
    scripts: scripts.entries,
    scriptFiles: scripts.files,
    scriptSources: scripts.sources,
    scriptConfig: {
      htmlClass: page.htmlClasses.join(' '),
      bodyClass: page.bodyClasses.join(' '),
      removed: [...page.removedIds.map((id) => `#${id}`), ...page.removedClasses.map((c) => `.${c}`)].join(' '),
    },
    warnings,
  };
}

/** Classes the CSS gives a :hover state, for the render check. */
function hoverClassesIn(sheets) {
  const found = new Set();
  for (const { css } of sheets) for (const m of css.matchAll(/\.([\w-]+)(?:[.:\w-]*):hover\b/g)) found.add(m[1]);
  return [...found];
}

/**
 * The wrapper's data-reveal-* attributes, which assets/js/site.js reads to play
 * back the page's scroll-reveal effect. The trigger settings come from the
 * page's own script when it uses the common forms (an IntersectionObserver's
 * rootMargin and threshold, and a "(i % n) * ms" transition-delay stagger).
 */
function revealAttributes(reveal, html) {
  if (!reveal) return '';
  const scripts = [...html.matchAll(/<script\b(?![^>]*\btype\s*=\s*["']?application\/(?:ld\+)?json)[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]).join('\n');
  const attrs = {
    'data-reveal': IMPORT_PREFIX + reveal.target,
    'data-reveal-root': IMPORT_PREFIX + reveal.root,
    'data-reveal-state': IMPORT_PREFIX + reveal.state,
  };
  const margin = /rootMargin\s*:\s*["']([-\d.px%\s]+)["']/.exec(scripts);
  const threshold = /threshold\s*:\s*([\d.]+)/.exec(scripts);
  const stagger = /transitionDelay\s*=\s*\(\s*\w+\s*%\s*(\d+)\s*\)\s*\*\s*(\d+)/.exec(scripts);
  if (margin) attrs['data-reveal-margin'] = margin[1].trim();
  if (threshold) attrs['data-reveal-threshold'] = threshold[1];
  if (stagger) attrs['data-reveal-stagger'] = `${stagger[1]}x${stagger[2]}`;
  return Object.entries(attrs).map(([k, v]) => ` ${k}="${v.replace(/"/g, '')}"`).join('');
}

/** Frontmatter lines without the given top-level keys (and their list items). */
function withoutKeys(lines, keys) {
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const key = /^([A-Za-z0-9_.-]+)\s*:/.exec(line)?.[1];
    if (key) skipping = keys.includes(key);
    else if (!/^\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out;
}

/** Frontmatter lines with only the given top-level keys (and their list items). */
function onlyKeys(lines, keys) {
  const present = lines.map((line) => /^([A-Za-z0-9_.-]+)\s*:/.exec(line)?.[1]).filter(Boolean);
  return withoutKeys(lines, present.filter((key) => !keys.includes(key)));
}

/**
 * The page a conversion starts from: its frontmatter cut down to REPLACE_KEEPS
 * and no body, so the old page's content can't carry over into the new one.
 * The old description goes too, and the old title when the HTML has its own (`html`:
 * the raw page), so Claude can't keep them out of habit.
 * Returns { base, dropped } (the content fields that were removed).
 */
function replacedPage(original, html = '') {
  const match = FRONTMATTER_BLOCK.exec(original);
  const lines = (match ? match[1] : '').split(/\r?\n/);
  const { title, description } = htmlFacts(html);
  // The old description always goes: it described the old page.
  const keeps = REPLACE_KEEPS.filter((key) => !(key === 'title' && title) && key !== 'description');
  const kept = onlyKeys(lines, keeps);
  // A meta description that fits is the page's description as it is, so it's set here rather than left to Claude.
  if (description && description.length <= 160) kept.push(`description: ${frontmatterScalar(description)}`);
  const dropped = [...new Set(lines.map((line) => /^([A-Za-z0-9_.-]+)\s*:/.exec(line)?.[1]).filter((key) => key && !REPLACE_KEEPS.includes(key)))];
  return { base: `---\n${kept.join('\n')}\n---\n`, dropped };
}

/** A one-line value the site's frontmatter parser reads back as the same string. */
function frontmatterScalar(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  const plain = !/^["'[{|>#&*!%@`-]|^(true|false)$|^-?\d+(\.\d+)?$|["']$|\s#/i.test(text);
  return plain ? text : `"${text}"`;
}

/** Whether the HTML names its page (a <title> or <h1>), and its meta description. */
function htmlFacts(html) {
  const { title, description } = cleanHtml(html || '<p></p>');
  return { title: Boolean(title) || /<h1\b/i.test(html), description: description.trim() };
}

/**
 * Problems with the title and description of a page that replaced another:
 * no title, or a description that isn't the HTML's meta description when that
 * one fits (at most 160 characters).
 */
function replacementProblems(updated, html) {
  const { data } = parseFrontmatter(updated);
  const problems = [];
  if (!String(data.title ?? '').trim()) problems.push('the page has no title: take it from the HTML');
  const { description } = htmlFacts(html);
  if (description && description.length <= 160 && comparable(String(data.description ?? '')) !== comparable(description)) {
    problems.push(`description must be the HTML's meta description, word for word: "${description}"`);
  }
  return problems;
}

/** Claude's frontmatter, limited to what a replaced page keeps, with "stylesheet", "fonts" and "hideCta" set, then the copied body. */
function assembleStyledFile(reply, styled) {
  const match = FRONTMATTER_BLOCK.exec(reply.trim());
  const lines = onlyKeys((match ? match[1] : '').split(/\r?\n/), REPLACE_KEEPS);
  lines.push(`stylesheet: /${styled.stylesheet.file}`);
  if (styled.fonts.length) lines.push('fonts:', ...styled.fonts.map((url) => `  - "${url.replace(/"/g, '%22')}"`));
  // The imported page brings its own call to action; the site's would be added after it.
  if (!lines.some((line) => /^hideCta\s*:/.test(line))) lines.push('hideCta: true');
  // Its scripts, in order, which base.html loads with assets/js/imported-page.js before them.
  if (styled.scripts.length) {
    lines.push('scripts:');
    for (const script of styled.scripts) {
      lines.push(`  - src: "${script.src.replace(/"/g, '%22')}"`);
      for (const key of ['head', 'module', 'nomodule', 'defer', 'async']) lines.push(`    ${key}: ${script[key] ? 'true' : 'false'}`);
    }
    const { htmlClass, bodyClass, removed } = styled.scriptConfig;
    if (htmlClass) lines.push(`scriptHtmlClass: ${frontmatterScalar(htmlClass)}`);
    if (bodyClass) lines.push(`scriptBodyClass: ${frontmatterScalar(bodyClass)}`);
    if (removed) lines.push(`scriptRemoved: ${frontmatterScalar(removed)}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n${styled.body}`;
}

/**
 * The self-tests a --keep-styles conversion runs before it's shown or written.
 * Pass 1 (always): the body goes through the site's own template engine and
 * markdown renderer unchanged, and keeps all of the original's text.
 * Passes 2–4 (when a browser is available): the original and the copy are
 * rendered side by side at three widths and compared element by element
 * (scripts/lib/render-check.js). Returns { checks, problems, warnings }.
 */
async function testStyledPage(styled, raw) {
  const checks = [];
  const problems = [];
  const warnings = [];

  const { body } = parseFrontmatter(raw);
  const rendered = renderMarkdown(new TemplateEngine().renderString(body, {})).html.trim();
  const wrapperStart = styled.body.slice(0, styled.body.indexOf('\n'));
  if (!rendered.startsWith(wrapperStart) || rendered.length < body.trim().length * 0.98) {
    problems.push("the site's markdown renderer changes the copied HTML, so the page wouldn't show as the original");
  }
  const decode = (s) => visibleText(s.replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/^&#32;$/gm, ''));
  const originalText = decode(cleanHtml(styled.html, { keepStyles: true, prefix: '' }).html);
  const copiedText = decode(rendered);
  if (originalText !== copiedText) problems.push("the copy's text differs from the original's");
  checks.push(problems.length ? 'pass 1, content: failed' : `pass 1, content: the site's renderer keeps the page as it is, with all ${originalText.length} characters of its text`);

  if (noRenderCheck) {
    checks.push('render check: skipped (--no-render-check)');
    return { checks, problems, warnings };
  }
  const result = await renderCheck({
    originalDoc: originalTestDocument(styled),
    convertedDoc: convertedTestDocument(styled, rendered),
    hoverClasses: styled.hoverClasses,
    root: ROOT,
  });
  if (!result.ran) {
    checks.push(`render check: skipped, ${result.reason}`);
    return { checks, problems, warnings };
  }
  result.passes.forEach((pass, i) => {
    const what = `${pass.elements} elements${pass.hovers ? ` and ${pass.hovers} hover states` : ''}`;
    if (!pass.differences.length) {
      checks.push(`pass ${i + 2}, ${pass.width}px wide: identical to the original (${what} compared)`);
      return;
    }
    checks.push(`pass ${i + 2}, ${pass.width}px wide: ${pass.differences.length} difference${pass.differences.length === 1 ? '' : 's'} from the original (${what} compared)`);
    for (const d of pass.differences.slice(0, 5)) warnings.push(`at ${pass.width}px, ${d}`);
    if (pass.differences.length > 5) warnings.push(`at ${pass.width}px, ${pass.differences.length - 5} more differences`);
  });

  // Pass 5: the page's scripts run in the copy, and raise no error the original doesn't.
  if (styled.scripts.length) {
    const run = await scriptCheck({ originalDoc: styled.html, convertedDoc: scriptTestDocument(styled, rendered), root: ROOT });
    if (!run.ran) {
      checks.push(`pass 5, scripts: skipped, ${run.reason}`);
    } else {
      const before = new Set(run.original);
      const added = run.converted.filter((e) => !before.has(e));
      const count = `${styled.scripts.length} script${styled.scripts.length === 1 ? '' : 's'}`;
      checks.push(added.length
        ? `pass 5, scripts: ${count} ran with ${added.length} error${added.length === 1 ? '' : 's'} the original doesn't have`
        : `pass 5, scripts: ${count} ran without errors${run.original.length ? ' the original doesn\'t also have' : ''}`);
      for (const e of added.slice(0, 5)) warnings.push(`a script fails in the copy: ${e}`);
      if (added.length > 5) warnings.push(`${added.length - 5} more script errors`);
    }
  }
  return { checks, problems, warnings };
}

/** The copy as the script check runs it: convertedTestDocument plus imported-page.js and the page's scripts, inline code inlined. */
function scriptTestDocument(styled, renderedBody) {
  const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const tag = (s) => (s.code !== null
    ? `<script${s.module ? ' type="module"' : ''}>${s.code.replace(/<\/script/gi, '<\\/script')}</script>`
    : `<script src="${attr(s.src)}"${s.module ? ' type="module"' : ''}${s.nomodule ? ' nomodule' : ''}${s.defer ? ' defer' : ''}${s.async ? ' async' : ''}></script>`);
  const { htmlClass, bodyClass, removed } = styled.scriptConfig;
  const runtime = `<script src="/assets/js/imported-page.js" data-html-class="${attr(htmlClass)}" data-body-class="${attr(bodyClass)}" data-removed="${attr(removed)}"></script>`;
  const head = styled.scriptSources.filter((s) => s.head).map(tag).join('\n');
  const tail = styled.scriptSources.filter((s) => !s.head).map(tag).join('\n');
  return convertedTestDocument(styled, renderedBody)
    .replace('</head>', () => `${runtime}\n${head}\n</head>`)
    .replace('<body>', () => '<body><script>TwinstackImported.body()</script>')
    .replace('</main></body>', () => `</main><script>TwinstackImported.ready()</script>\n${tail}\n</body>`);
}

/**
 * The original page as the test compares it: minus its header, footer,
 * navigation and scripts, with images resolved and uploaded and global
 * stylesheets standing in for its <link>s exactly as in the copy, and a viewport tag (a
 * page without one shows zoomed out on phones; the site always has one).
 */
function originalTestDocument(styled) {
  const source = styled.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const links = standIns(styled.uploads, styled.globals);
  const styleTag = (css, media) => `<style${media ? ` media="${media.replace(/"/g, '')}"` : ''}>${css}</style>`;
  let head = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i.exec(source)?.[0] ?? '<head><meta charset="utf-8"></head>';
  head = head.replace(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] || '';
    if (FONT_STYLESHEET.test(href)) return tag;
    const match = links.forLink(href);
    return match ? styleTag(match.css, /\bmedia\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]) : '';
  });
  const unmatched = links.rest().map((s) => styleTag(s.css)).join('');
  head = head.replace(/<head\b[^>]*>/i, (open) => `${open}${/name\s*=\s*["']?viewport/i.test(head) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">'}${unmatched}`);
  const htmlTag = /<html\b[^>]*>/i.exec(source)?.[0] ?? '<html>';
  const bodyTag = /<body\b[^>]*>/i.exec(source)?.[0] ?? '<body>';
  const kept = cleanHtml(styled.html, { keepStyles: true, prefix: '' }).html;
  const content = rewriteImages(`${kept}\n${svgDefinitions(styled.html, kept)}`, siteImage);
  return `<!DOCTYPE html>\n${htmlTag}${head}${bodyTag}\n${content}\n</body></html>\n`;
}

/** The copy as the site shows it: the site's compiled stylesheet, the page's fonts and stylesheet, the body inside <main>. */
function convertedTestDocument(styled, renderedBody) {
  const siteCss = path.join(ROOT, 'assets/css/main.css');
  const fontLinks = styled.fonts.map((url) => `<link rel="stylesheet" href="${url.replace(/"/g, '%22')}">`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${fontLinks}
<style>body{margin:0}</style>
${fs.existsSync(siteCss) ? `<style>${fs.readFileSync(siteCss, 'utf8')}</style>` : ''}
<style>${styled.stylesheet.content}</style>
</head><body><main id="main">
${renderedBody}
</main></body></html>
`;
}

/**
 * The HTML page to convert, cleaned, with its images split into ones the site
 * can show (URLs, files in the repo) and ones it can't (relative paths to the
 * old site's files). Throws a readable error for a missing or oversized file.
 */
function loadHtmlPage(source) {
  const { file, html } = readHtmlSource(source);
  const cleaned = cleanHtml(html);
  if (!cleaned.text) throw new Error(`${file} has no text left once its header, footer and scripts are removed`);
  if (cleaned.html.length > MAX_CLEAN_CHARS) {
    throw new Error(`${file} is too long to convert in one request (${cleaned.html.length} characters of content once cleaned, the limit is ${MAX_CLEAN_CHARS}). Split it into smaller pages first.`);
  }

  const entries = [];
  const unavailable = [];
  for (const { src } of htmlImages(cleaned.html)) {
    const value = src.startsWith('//') ? `https:${src}` : src;
    if (/^https?:\/\//i.test(value)) {
      entries.push({ value, src });
      continue;
    }
    const relative = path.posix.normalize(value.split(/[?#]/)[0].replace(/^\/+/, '').replace(/^\.\//, ''));
    const usable =
      !relative.startsWith('../') &&
      relative.split('/')[0] !== '.git' &&
      new RegExp(`\\.(${IMAGE_EXT})$`, 'i').test(relative) &&
      fs.existsSync(path.join(ROOT, relative));
    if (usable) entries.push({ value: relative, src });
    else unavailable.push(src);
  }
  return { file, ...cleaned, entries, unavailable, source: html };
}

/* ----------------------------------------------------------------- images */

const IMAGE_EXT = 'png|jpe?g|gif|webp|svg|avif';
const FRONTMATTER_BLOCK = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

/**
 * Every image a draft refers to, in order of appearance: frontmatter image/logo,
 * ![](src), <img src>, and bare image URLs or assets/img/ paths on their own.
 * Template expressions and data: URIs are left alone.
 */
function findDraftImages(text) {
  const { data } = parseFrontmatter(text);
  const found = [];
  const add = (raw, index, inFrontmatter = null) => {
    const value = String(raw).trim().replace(/^<|>$/g, '');
    if (!value || value.includes('{{') || /^data:/i.test(value)) return;
    if (!/^https?:\/\//i.test(value) && !new RegExp(`\\.(${IMAGE_EXT})$`, 'i').test(value.split(/[?#]/)[0])) return;
    found.push({ value, index, inFrontmatter });
  };

  for (const key of ['image', 'logo']) {
    if (typeof data[key] === 'string') add(data[key], -1, key);
  }
  const patterns = [
    /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi,
    new RegExp(`(?:^|[\\s(])(https?:\\/\\/[^\\s)<>"'\\]]+?\\.(?:${IMAGE_EXT})(?:\\?[^\\s)<>"'\\]]*)?)(?=$|[\\s)<>"'\\]])`, 'gim'),
    new RegExp(`(?:^|\\s)(\\/?assets\\/img\\/[\\w./-]+\\.(?:${IMAGE_EXT}))(?=$|\\s)`, 'gim'),
  ];
  const bodyStart = FRONTMATTER_BLOCK.exec(text)?.[0].length ?? 0;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index < bodyStart) continue; // frontmatter was handled above
      add(match[1], match.index);
    }
  }

  const seen = new Set();
  return found
    .sort((a, b) => a.index - b.index)
    .filter(({ value }) => {
      const key = canonicalImage(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The form a page references an image by: URLs as-is, repo files as "/assets/…". */
function canonicalImage(value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `/${path.posix.normalize(value.replace(/\\/g, '/').replace(/^\/+/, ''))}`;
}

/** Resolves draft images and --image entries into { ref, block, why, inFrontmatter }. */
function collectImages(entries) {
  const images = [];
  for (const entry of entries) {
    const ref = canonicalImage(entry.value);
    if (!/^https?:\/\//i.test(ref)) {
      const relative = ref.slice(1);
      if (relative.startsWith('../') || relative.split('/')[0] === '.git') {
        console.log(`  ! image "${entry.value}" — outside the site's files, skipped entirely`);
        continue;
      }
      if (!fs.existsSync(path.join(ROOT, relative))) {
        images.push({ ref, block: null, why: 'file not found in the repo', missing: true, inFrontmatter: entry.inFrontmatter });
        continue;
      }
    }
    const [resolved] = resolveImages([entry.value]);
    if (resolved) images.push({ ...resolved, inFrontmatter: entry.inFrontmatter });
  }
  return limitVision(images);
}

/** Past the request's limits, later images are named but not shown. */
function limitVision(images) {
  let count = 0;
  let bytes = 0;
  return images.map((image) => {
    if (!image.block) return image;
    const size = image.block.source.type === 'base64' ? image.block.source.data.length : 0;
    if (count + 1 > MAX_VISION_IMAGES || bytes + size > MAX_VISION_BYTES) {
      return { ...image, block: null, why: 'too many images to show in one request' };
    }
    count += 1;
    bytes += size;
    return image;
  });
}

/** Text-only prompts stay a string; with images, each one is labelled and sent as vision input. */
function userContent(userPrompt, images) {
  const shown = images.filter((image) => image.block);
  if (!shown.length) return userPrompt;
  const blocks = [];
  images.forEach((image, i) => {
    if (image.block) blocks.push({ type: 'text', text: `Image ${i + 1}: ${image.ref}` }, image.block);
  });
  return [...blocks, { type: 'text', text: userPrompt }];
}

/**
 * Asks Claude for the new file. If the API rejects a URL image it couldn't
 * fetch, the request is retried once with URL images named but not shown.
 */
async function askClaude(buildPrompts, images) {
  // The prompts describe which images are shown, so they're rebuilt for the retry.
  const call = (list) => {
    const { systemPrompt, userPrompt } = buildPrompts(list);
    return requestClaude({ apiKey, model: CLAUDE_MODEL, systemPrompt, userContent: userContent(userPrompt, list), maxTokens: MAX_TOKENS });
  };
  try {
    return { ...(await call(images)), images };
  } catch (error) {
    const hasUrlImages = images.some((image) => image.block?.source.type === 'url');
    if (error.status !== 400 || !hasUrlImages) throw error;
    console.log(`  ! The API rejected the request (${error.message.slice(0, 160)}).`);
    console.log('  ! Retrying with image URLs named but not shown, in case one of them couldn\'t be fetched.');
    const fallback = images.map((image) =>
      image.block?.source.type === 'url' ? { ...image, block: null, why: "the URL couldn't be fetched to show you" } : image,
    );
    return { ...(await call(fallback)), images: fallback };
  }
}

/* ----------------------------------------------------------------- checks */

function balanceProblems(text) {
  const openers = (text.match(/\{\{#\s*(if|unless|each)/g) || []).length;
  const closers = (text.match(/\{\{\/\s*(if|unless|each)/g) || []).length;
  return openers === closers ? [] : [`unbalanced template blocks (${openers} opened, ${closers} closed)`];
}

function partialProblems(text) {
  const known = new Set(partialNames());
  const used = [...new Set([...text.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)].map((m) => m[1]))];
  return used.filter((name) => !known.has(name)).map((name) => `includes a partial that doesn't exist: {{> ${name} }}`);
}

/** Frontmatter lines the site's parser would misread. Lines already in the original are left alone. */
function frontmatterProblems(original, updated) {
  const match = FRONTMATTER_BLOCK.exec(updated);
  if (!match) return ['the frontmatter block ("---" … "---") is missing or unterminated'];
  const before = new Set((FRONTMATTER_BLOCK.exec(original)?.[1] || '').split(/\r?\n/).map((l) => l.trimEnd()));

  const problems = [];
  let listOpen = false;
  let mapItem = false;
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    let ok = true;

    if (indent === 0) {
      const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
      const value = kv?.[2].trim() ?? '';
      ok = Boolean(kv) && !/^[|>]/.test(value) && !/^\{/.test(value);
      listOpen = Boolean(kv) && value === '';
      mapItem = false;
    } else if (trimmed.startsWith('- ')) {
      ok = listOpen;
      mapItem = /^- [A-Za-z0-9_.-]+:(\s|$)/.test(trimmed);
    } else {
      ok = mapItem && /^[A-Za-z0-9_.-]+:(\s|$)/.test(trimmed);
    }

    if (!ok && !before.has(line)) problems.push(`frontmatter line the site can't read: "${trimmed.slice(0, 80)}"`);
  }
  return problems;
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function editChecks(original, updated, isContent) {
  const problems = [];

  if (updated.length < original.length * 0.4) {
    problems.push(`output is suspiciously short (${updated.length} chars vs ${original.length} originally)`);
  }

  if (isContent) {
    const before = parseFrontmatter(original);
    const after = parseFrontmatter(updated);
    if (before.data.title && !after.data.title) problems.push('frontmatter lost its title');
    if (before.data.layout && after.data.layout !== before.data.layout) {
      problems.push(`layout changed from "${before.data.layout}" to "${after.data.layout || '(none)'}" — was that intended?`);
    }
  }

  problems.push(...balanceProblems(updated));
  return { problems, warnings: [] };
}

const includesImage = (text, ref) => text.includes(ref) || text.includes(ref.replace(/&/g, '&amp;'));

/** No image may appear from nowhere: each one must be among `images` or exist in the repo. */
function unknownImageProblems(updated, images, source) {
  const known = new Set(images.map((image) => image.ref));
  const problems = [];
  for (const { value } of findDraftImages(updated)) {
    const ref = canonicalImage(value);
    const exists = /^https?:/i.test(ref) || fs.existsSync(path.join(ROOT, ref.slice(1)));
    if (!known.has(ref) && !exists) problems.push(`uses an image that isn't in the ${source} or the repo: ${ref}`);
  }
  return problems;
}

function generateChecks(original, updated, images, relFile) {
  const { problems, warnings } = pageChecks(original, updated, relFile);

  // Each image from the draft must survive, and no image may appear from nowhere.
  for (const image of images) {
    if (!includesImage(updated, image.ref)) problems.push(`an image from the draft is missing from the page: ${image.ref}`);
    if (image.missing) warnings.push(`${image.ref} doesn't exist in the repo, so the page will show a broken image until it's added`);
  }
  problems.push(...unknownImageProblems(updated, images, 'draft'));
  if (/<!--|^\s*TODO\b/im.test(parseFrontmatter(updated).body)) warnings.push('the page still contains a comment or TODO note');
  return { problems, warnings };
}

function convertChecks(original, updated, images, page, relFile) {
  const { problems, warnings } = pageChecks(original, updated, relFile);
  problems.push(...replacementProblems(updated, page.source));

  // Decorative images may rightly be left out, so a missing one only warns.
  for (const image of images) {
    if (!includesImage(updated, image.ref)) warnings.push(`an image from the HTML isn't in the page: ${image.ref}`);
  }
  problems.push(...unknownImageProblems(updated, images, 'HTML'));
  // One Claude used anyway is already a problem above.
  for (const src of page.unavailable.filter((s) => !updated.includes(s))) {
    warnings.push(`left out ${src}: it isn't in this site. Upload the image and add it to the page if it's needed`);
  }

  const bodyText = visibleText(parseFrontmatter(updated).body.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>|`-]+/g, ' '));
  if (bodyText.length < page.text.length * 0.5) {
    warnings.push(`the page has about ${Math.round((bodyText.length / page.text.length) * 100)}% of the HTML's text. Check that nothing was dropped, beyond the old site's header and footer`);
  }
  if (page.removed.length) warnings.push(`removed from the HTML before converting: ${page.removed.join(', ')}`);
  if (/<!--/.test(parseFrontmatter(updated).body)) warnings.push('the page still contains an HTML comment');
  return { problems, warnings };
}

/** Checks shared by generated and converted pages: frontmatter, locked fields, links, headings, template syntax. */
function pageChecks(original, updated, relFile) {
  const problems = [];
  const warnings = [];
  const before = parseFrontmatter(original);
  const after = parseFrontmatter(updated);

  problems.push(...frontmatterProblems(original, updated));
  if (!after.body.trim()) problems.push('the page has no body');
  if (before.data.title && !after.data.title) problems.push('frontmatter lost its title');
  for (const field of LOCKED_FIELDS) {
    if (!sameValue(before.data[field], after.data[field])) {
      problems.push(`"${field}" changed from ${JSON.stringify(before.data[field] ?? '(none)')} to ${JSON.stringify(after.data[field] ?? '(none)')}`);
    }
  }
  if (before.data.title && after.data.title && before.data.title !== after.data.title) {
    warnings.push(`title changed from "${before.data.title}" to "${after.data.title}"`);
  }

  // Links to pages that don't exist are the author's call (the page may be coming), so they only warn.
  const urls = new Set(internalUrls());
  const links = [...updated.matchAll(/\]\((\/[^)\s]*)\)|\bhref=["'](\/[^"']*)["']/g)].map((m) => m[1] || m[2]);
  for (const href of new Set(links)) {
    const bare = href.split(/[?#]/)[0];
    if (bare.startsWith('/assets/') || bare.includes('{{')) continue;
    const candidates = [bare, bare.endsWith('/') ? bare : `${bare}/`, bare.replace(/\/$/, '')];
    if (!candidates.some((c) => urls.has(c))) warnings.push(`links to a page that doesn't exist yet: ${href}`);
  }

  // Only a layout that draws the title makes a heading of the page's own a repeat.
  if (/^#\s/m.test(after.body) && (!relFile || layoutShowsTitle(layoutFor(relFile, after.data).source))) {
    warnings.push('the body has a "# " heading; the layout already shows the title');
  }
  warnings.push(...bannedPhraseWarnings(after.body));

  problems.push(...balanceProblems(updated), ...partialProblems(updated));
  return { problems, warnings };
}

/* ------------------------------------------------------------- one edit --- */

const styledLogInstruction = (instruction, styled) => instruction || `${defaultLogInstruction('convert', styled.file)}, keeping its styles`;

/**
 * The work-log summary of a conversion that kept the old page's styles. The
 * body is the old page's HTML copied as-is, so Claude gets the frontmatter
 * change and the conversion's facts rather than a diff of all that HTML.
 */
function styledSummary(relFile, instruction, original, raw, styled) {
  const frontmatter = (text) => FRONTMATTER_BLOCK.exec(text)?.[0] ?? '';
  const facts = [
    `the page's body was replaced by the HTML of ${path.posix.basename(styled.file)} copied as-is with its own styling (${styled.body.length} characters)`,
    styled.removed.length ? `removed from that HTML: ${styled.removed.join(', ')}` : '',
    `its CSS (${styled.rules} rules) was saved, scoped to this page, as ${styled.stylesheet.file}`,
    styled.fonts.length ? `its web fonts are loaded from ${styled.fonts.length} font stylesheet${styled.fonts.length === 1 ? '' : 's'}` : '',
    styled.reveal ? 'its scroll-in effect was kept' : '',
    styled.globals.length ? `the site tree's global stylesheets were applied to it (${styled.globals.map((g) => g.file).join(', ')})` : '',
    styled.globalUpdates.length ? `its upload replaced the global stylesheet ${styled.globalUpdates.map((g) => g.file).join(', ')}` : '',
    "the old page's body and content fields were replaced, keeping only the fields that identify the page",
  ].filter(Boolean).join('; ');
  return summaryFor({ mode: 'convert', relFile, instruction: styledLogInstruction(instruction, styled), before: frontmatter(original), after: frontmatter(raw), notes: facts });
}

/**
 * The content file in a reply. Asked to review its work, Claude sometimes
 * writes its checklist first ("Comparing line by line: … Returning the file
 * unchanged.") or wraps the file in a fence after a sentence. The file is
 * taken from the first "---" line that opens a valid frontmatter block.
 */
function fileFromReply(text) {
  const raw = stripFence(text.trim());
  if (FRONTMATTER_BLOCK.test(raw)) return raw;
  for (const m of raw.matchAll(/^---[ \t]*\r?$/gm)) {
    const rest = raw.slice(m.index);
    if (FRONTMATTER_BLOCK.test(rest)) return rest.replace(/\n```[ \t]*$/, '').trimEnd();
  }
  return raw;
}

// How many times a conversion asks Claude: the first reply plus up to two corrections.
const MAX_ATTEMPTS = 3;

const comparable = (text) =>
  text
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/&mdash;|—/g, '-').replace(/&ndash;|–/g, '-').replace(/&middot;|·/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Pieces of the page's own content (headings, paragraphs, list items, table
 * cells, quotes, captions) that a converted file doesn't contain, compared by
 * their first eight words after markdown and entities are stripped away. The
 * <h1> isn't counted: it becomes the page's title, which may already be set.
 */
function missingContent(page, converted) {
  const haystack = ` ${comparable(converted.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, ' '))} `;
  const missing = [];
  const seen = new Set();
  const readable = (s) => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
  for (const m of page.html.matchAll(/<(h[2-6]|p|li|td|th|blockquote|figcaption|dt|dd|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = readable(visibleText(m[2]));
    const key = comparable(text).split(' ').slice(0, 8).join(' ');
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    if (!haystack.includes(` ${key} `)) missing.push(text.length > 90 ? `${text.slice(0, 90)}…` : text);
  }
  return missing;
}

/**
 * Markdown conversion, tested and corrected: every reply is checked (the
 * convert checks plus missing content). Claude always reviews its first
 * conversion once against the HTML, with any issues listed, and gets a third
 * attempt if issues remain. The best attempt is kept: fewest problems, then
 * least missing content, later attempts winning ties.
 */
async function reviewConversion({ reply, buildPrompts, original, htmlPage, relFile }) {
  const { systemPrompt, userPrompt } = buildPrompts(reply.images);
  const messages = [{ role: 'user', content: userContent(userPrompt, reply.images) }];
  const checks = [];
  let best = null;
  let current = reply;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = fileFromReply(current.text);
    const checked = convertChecks(original, raw, reply.images, htmlPage, relFile);
    const problems = [...checked.problems];
    if (current.stopReason === 'max_tokens') problems.unshift(`Claude's reply was cut off at ${MAX_TOKENS} tokens, so the file is incomplete`);
    const missing = missingContent(htmlPage, raw);
    const result = { raw, problems, warnings: [...checked.warnings], missing, attempt };
    checks.push(`attempt ${attempt}: ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'no problems'}, ${missing.length ? `${missing.length} piece${missing.length === 1 ? '' : 's'} of content missing` : 'all content present'}`);
    console.log(`  Check ${checks.at(-1)}`);
    for (const problem of problems.slice(0, 5)) console.log(`    - ${problem}`);
    const score = (r) => r.problems.length * 1000 + r.missing.length;
    if (!best || score(result) <= score(best)) best = result;
    const clean = !problems.length && !missing.length;
    // Attempt 2 always runs as a review; attempt 3 only if something is still wrong.
    if (attempt === MAX_ATTEMPTS || (clean && attempt >= 2)) break;

    const issues = [
      ...problems.map((p) => `- ${p}`),
      ...missing.slice(0, 20).map((t) => `- missing from the page: "${t}"`),
      ...(missing.length > 20 ? [`- and ${missing.length - 20} more pieces of content`] : []),
    ];
    messages.push({ role: 'assistant', content: current.text }, {
      role: 'user',
      content: issues.length
        ? `Checking your conversion against the HTML found these issues:\n${issues.join('\n')}\nFix them: add missing content where it belongs in the page, with its original wording, unless it's part of the old site's header, footer or navigation. Then check the whole file against the HTML once more and return the complete corrected file, following the same rules. Reply with the file only, starting with its opening "---": no commentary before or after it.`
        : 'Review your conversion against the HTML once more, line by line: every heading, paragraph, list item, table cell, link and image of the page\'s own content must be there, in order, with the original wording, and nothing from the old site\'s header, footer or navigation. Return the complete file, corrected if anything was wrong or unchanged if not, following the same rules. Reply with the file only, starting with its opening "---": no checklist, commentary or notes before or after it.',
    });
    console.log(`  Asking Claude to ${issues.length ? 'fix what the check found' : 'review its conversion'} (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`);
    current = await requestClaude({ apiKey, model: CLAUDE_MODEL, systemPrompt, messages, maxTokens: MAX_TOKENS });
    if (current.stopReason === 'refusal') break;
  }
  const warnings = [...best.warnings];
  for (const t of best.missing.slice(0, 10)) warnings.unshift(`possibly missing from the page: "${t}"`);
  if (best.missing.length > 10) warnings.unshift(`${best.missing.length - 10} more pieces of the HTML's content may be missing`);
  checks.push(`kept attempt ${best.attempt} of ${checks.length}`);
  return { raw: best.raw, problems: best.problems, warnings, checks };
}

const MODE_LABELS = {
  edit: 'edit by instruction',
  generate: 'generate the page from its draft',
  convert: 'convert an HTML page into this page',
};

/** --from-html --keep-styles: the old page's HTML and CSS copied as-is, and Claude writes the frontmatter. */
async function applyStyledConvert(relFile, instruction, original, source, cssFiles, jsFiles = []) {
  let styled;
  let textPage;
  try {
    styled = buildStyledPage(source, cssFiles, relFile, jsFiles);
    textPage = cleanHtml(readHtmlSource(source).html);
  } catch (error) {
    console.error(`  Can't convert: ${error.message}.\n`);
    return false;
  }
  console.log(`  Styles: kept, ${styled.rules} CSS rule${styled.rules === 1 ? '' : 's'} into ${styled.stylesheet.file}${cssFiles.length ? ` (from the HTML and ${cssFiles.join(', ')})` : ' (from the HTML)'}`);
  if (styled.removed.length) console.log(`  Removed: ${styled.removed.join(', ')}`);
  if (styled.scripts.length) console.log(`  Scripts: kept ${styled.scripts.length} (${styled.scripts.filter((x) => x.head).length} in <head>), into ${importedScriptDir(relFile)}/ and from their URLs`);
  if (styled.reveal) console.log(`  Scroll reveal: kept (.${styled.reveal.target} shown with .${styled.reveal.state} as it scrolls into view)`);

  if (styled.globals.length) console.log(`  Global CSS: ${styled.globals.map((g) => g.file).join(', ')} (from the site tree)`);
  for (const update of styled.globalUpdates) console.log(`  Global CSS: ${update.file} replaced by the upload`);
  // The HTML replaces the page: only the fields that identify it are kept.
  const { base, dropped } = replacedPage(original, styled.html);
  console.log(`  Replacing: the old body${dropped.length ? ` and ${dropped.join(', ')}` : ''}`);

  const { systemPrompt, userPrompt } = buildStyledFrontmatterPrompts(relFile, instruction, base, styled, textPage);
  if (!apiKey) {
    console.log(`----- system prompt -----\n${systemPrompt}\n\n----- user prompt -----\n${userPrompt}\n`);
    console.log(`----- body that would be written -----\n${styled.body}\n----- ${styled.stylesheet.file} -----\n${styled.stylesheet.content}`);
    console.log('  No ANTHROPIC_API_KEY set, so nothing was sent.\n');
    return false;
  }

  console.log(`  Model: ${CLAUDE_MODEL}\n`);
  // The frontmatter is checked after every reply; Claude gets up to MAX_ATTEMPTS tries to fix what's wrong.
  const messages = [{ role: 'user', content: userPrompt }];
  const checks = [];
  let raw = '';
  let problems = [];
  let warnings = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await requestClaude({ apiKey, model: CLAUDE_MODEL, systemPrompt, messages, maxTokens: 8000 });
    if (reply.stopReason === 'refusal') {
      console.error('  Claude declined this request. Rephrase the direction and try again.\n');
      return false;
    }
    const text = fileFromReply(reply.text);
    raw = assembleStyledFile(text, styled);
    ({ problems, warnings } = pageChecks(base, raw, relFile));
    problems.push(...replacementProblems(raw, styled.html));
    if (!FRONTMATTER_BLOCK.test(text.trim())) problems.unshift("Claude's reply had no frontmatter block");
    if (reply.stopReason === 'max_tokens') problems.unshift("Claude's reply was cut off, so the frontmatter is incomplete");
    checks.push(`frontmatter, attempt ${attempt}: ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'passed'}`);
    console.log(`  ${checks.at(-1)}`);
    if (!problems.length || attempt === MAX_ATTEMPTS) break;
    messages.push({ role: 'assistant', content: reply.text }, {
      role: 'user',
      content: `That frontmatter has these problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn the corrected frontmatter block only, following the same rules, with no commentary before or after it.`,
    });
  }
  warnings.push(...styled.warnings);
  if (dropped.length) warnings.push(`replaced the old page's content: its body and ${dropped.join(', ')}`);

  // Then the page itself is tested: content first, then side by side with the original at three widths.
  console.log('  Testing the copy against the original…');
  const tested = await testStyledPage(styled, raw);
  checks.push(...tested.checks);
  problems.push(...tested.problems);
  warnings.push(...tested.warnings);
  for (const line of tested.checks) console.log(`  ${line}`);
  const files = [styled.stylesheet, ...styled.scriptFiles, ...styled.globalUpdates];

  if (dryRun) {
    console.log(`----- proposed ${relFile} (not written) -----\n`);
    console.log(raw);
    for (const extra of files) console.log(`----- proposed ${extra.file} (not written, ${extra.content.length} characters) -----`);
    if (problems.length) console.log(`\n  problem: ${problems.join('\n  problem: ')}`);
    if (warnings.length) console.log(`\n  warning: ${warnings.join('\n  warning: ')}`);
    if (proposalOut) writeProposal({ relFile, mode: 'convert', instruction, images: [], raw, problems, warnings, source: styled.file, files, checks, summary: await styledSummary(relFile, instruction, original, raw, styled) });
    return false;
  }

  if (problems.length) {
    console.error(`\n  Refused to write — looked wrong:\n${problems.map((p) => `    - ${p}`).join('\n')}\n\n  Re-run with --dry-run to inspect the output, or rephrase the direction.\n`);
    return false;
  }

  for (const extra of files) {
    fs.mkdirSync(path.dirname(path.join(ROOT, extra.file)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, extra.file), extra.content);
  }
  fs.writeFileSync(path.join(ROOT, relFile), raw);
  recordWork({
    command: 'page:convert',
    file: relFile,
    instruction: styledLogInstruction(instruction, styled),
    summary: await styledSummary(relFile, instruction, original, raw, styled),
  });
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  console.log(`\n  Wrote ${relFile}, ${files.map((extra) => extra.file).join(', ')}\n`);
  return true;
}

async function applyEdit(relFile, instruction, imageEntries = [], mode = 'edit', source = null, { keepStyles = false, css = [], js = [] } = {}) {
  const generate = mode === 'generate';
  const convert = mode === 'convert';
  console.log(`  File: ${relFile}`);
  console.log(`  Mode: ${MODE_LABELS[mode]}`);
  if (convert) console.log(`  HTML: ${source}`);
  if (instruction) console.log(`  ${mode === 'edit' ? 'Instruction' : 'Direction'}: ${instruction}`);

  if (!isEditable(relFile)) {
    console.error(`  Won't touch "${relFile}" — outside content/, templates/, styles/main.css and site.config.json (dist/ and assets/css/main.css are generated, never edit them directly).\n`);
    return false;
  }
  if ((generate || convert) && !(relFile.startsWith('content/') && relFile.endsWith('.md'))) {
    console.error(`  ${generate ? '--generate' : '--from-html'} works on a markdown page under content/, not "${relFile}".\n`);
    return false;
  }

  const targetPath = path.join(ROOT, relFile);
  if (!fs.existsSync(targetPath)) {
    console.error(`  ${relFile} does not exist.${convert ? ' Create the page first (npm run new), then convert the HTML into it.' : ''}\n`);
    return false;
  }

  const original = fs.readFileSync(targetPath, 'utf8');
  if (generate && !parseFrontmatter(original).body.trim() && !instruction) {
    console.error(`  ${relFile} has no draft to work from yet. Write the page's content in it first, or add a direction.\n`);
    return false;
  }

  if (convert && keepStyles) return applyStyledConvert(relFile, instruction, original, source, css, js);

  let htmlPage = null;
  if (convert) {
    try {
      htmlPage = loadHtmlPage(source);
    } catch (error) {
      console.error(`  Can't convert: ${error.message}.\n`);
      return false;
    }
  }
  // A conversion replaces the page: Claude starts from the fields that identify it, never its old content.
  const { base, dropped } = convert ? replacedPage(original, htmlPage.source) : { base: original, dropped: [] };
  if (convert) {
    console.log(`  Replacing: the old body${dropped.length ? ` and ${dropped.join(', ')}` : ''}`);
    console.log(`  Content: ${htmlPage.text.length} characters of text${htmlPage.removed.length ? `, removed ${htmlPage.removed.join(', ')}` : ''}`);
    for (const src of htmlPage.unavailable) console.log(`  ! image "${src}" — not in this site, Claude will leave it out`);
  }

  const entries = generate ? findDraftImages(original) : convert ? htmlPage.entries.map(({ value }) => ({ value, index: 0, inFrontmatter: null })) : [];
  for (const value of imageEntries) entries.push({ value, index: Infinity, inFrontmatter: null });
  const seen = new Set();
  const unique = entries.filter(({ value }) => !seen.has(canonicalImage(value)) && seen.add(canonicalImage(value)));
  // A draft may name an image that's still to be added; an edit's --image must exist.
  const images = collectImages(unique)
    .filter((image) => {
      if (generate || !image.missing) return true;
      console.log(`  ! image "${image.ref}" — file not found, skipped entirely`);
      return false;
    })
    // A converted page's images are named by where they were in the HTML, too.
    .map((image) => ({ ...image, src: htmlPage?.entries.find(({ value }) => canonicalImage(value) === image.ref)?.src }));
  for (const [i, image] of images.entries()) {
    console.log(`  Image ${i + 1}: ${image.ref}${image.block ? '' : ` (reference only: ${image.why || 'not readable'})`}`);
  }

  const layout = generate || convert ? layoutFor(relFile, parseFrontmatter(base).data) : null;
  // A page that shows shared data (the homepage's sections) is edited together with that data.
  const sources = mode === 'edit' && relFile.startsWith('content/') && relFile.endsWith('.md') ? pageSources(relFile, original) : null;
  const multi = Boolean(sources?.dataFiles.length);
  if (multi) console.log(`  With: ${sources.dataFiles.join(', ')} (what the page shows)${sources.showsBody ? '' : ", its body isn't shown"}`);
  const buildPrompts = (list) =>
    generate
      ? buildGeneratePrompts(relFile, instruction, original, list, layout)
      : convert
        ? buildConvertPrompts(relFile, instruction, base, list, layout, htmlPage)
        : multi
          ? buildPageEditPrompts(relFile, instruction, original, list, sources)
          : buildEditPrompts(relFile, instruction, original, list);
  const { systemPrompt, userPrompt, isContent } = buildPrompts(images);

  if (!apiKey) {
    console.log(`----- system prompt -----\n${systemPrompt}\n\n----- user prompt -----\n${userPrompt}\n`);
    console.log('  No ANTHROPIC_API_KEY set, so nothing was sent.\n');
    return false;
  }

  console.log(`  Model: ${CLAUDE_MODEL}\n`);
  const reply = await askClaude(buildPrompts, images);
  if (reply.stopReason === 'refusal') {
    console.error(`  Claude declined this request. Rephrase the ${{ edit: 'instruction', generate: 'draft', convert: 'direction' }[mode]} and try again.\n`);
    return false;
  }
  // Content files are taken from their frontmatter on; a template or other file is the whole reply.
  let raw = generate || convert ? fileFromReply(reply.text) : stripFence(reply.text);
  let checks = [];
  let problems;
  let warnings;
  // Data files a multi-file page edit changes, written with the page.
  let extraFiles = [];
  if (multi) {
    ({ raw, files: extraFiles, problems, warnings } = readPageEditReply(reply.text, relFile, original, sources));
    if (reply.stopReason === 'max_tokens') problems.unshift(`Claude's reply was cut off at ${MAX_TOKENS} tokens, so the files are incomplete`);
  } else if (convert) {
    ({ raw, problems, warnings, checks } = await reviewConversion({ reply, buildPrompts, original: base, htmlPage, relFile }));
    if (dropped.length) warnings.push(`replaced the old page's content: its body and ${dropped.join(', ')}`);
  } else {
    const checked = generate ? generateChecks(original, raw, reply.images, relFile) : editChecks(original, raw, isContent);
    problems = [...checked.problems];
    ({ warnings } = checked);
    if (reply.stopReason === 'max_tokens') problems.unshift(`Claude's reply was cut off at ${MAX_TOKENS} tokens, so the file is incomplete`);
  }

  if (dryRun) {
    console.log(`----- proposed ${relFile} (not written) -----\n`);
    console.log(raw);
    for (const extra of extraFiles) console.log(`----- proposed ${extra.file} (not written) -----\n\n${extra.content}`);
    if (problems.length) console.log(`\n  problem: ${problems.join('\n  problem: ')}`);
    if (warnings.length) console.log(`\n  warning: ${warnings.join('\n  warning: ')}`);
    if (proposalOut) {
      const summary = await summaryFor({ mode, relFile, instruction: instruction || defaultLogInstruction(mode, htmlPage?.file), before: withExtras(relFile, original, extraFiles, 'before'), after: withExtras(relFile, raw, extraFiles, 'after') });
      writeProposal({ relFile, mode, instruction, images: reply.images, raw, problems, warnings, source: htmlPage?.file, files: extraFiles, checks, summary });
    }
    return false;
  }

  if (problems.length) {
    console.error(`\n  Refused to write — looked wrong:\n${problems.map((p) => `    - ${p}`).join('\n')}\n\n  Re-run with --dry-run to inspect the output, or rephrase the ${{ edit: 'instruction', generate: 'draft', convert: 'direction' }[mode]}.\n`);
    return false;
  }

  const summaryBefore = withExtras(relFile, original, extraFiles, 'before');
  fs.writeFileSync(targetPath, raw.endsWith('\n') ? raw : `${raw}\n`);
  for (const extra of extraFiles) fs.writeFileSync(path.join(ROOT, extra.file), extra.content);
  const logInstruction = instruction || defaultLogInstruction(mode, htmlPage?.file);
  recordWork({
    command: LOG_COMMANDS[mode],
    file: relFile,
    instruction: logInstruction,
    summary: await summaryFor({ mode, relFile, instruction: logInstruction, before: summaryBefore, after: withExtras(relFile, raw, extraFiles, 'after') }),
  });
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  console.log(`\n  Wrote ${relFile}  (${original.split('\n').length} -> ${raw.split('\n').length} lines)${extraFiles.length ? `, ${extraFiles.map((f) => f.file).join(', ')}` : ''}\n`);
  return true;
}

/** A page and the data files an edit changed, as one text, so the work-log summary sees all of the change. */
function withExtras(relFile, page, extraFiles, side) {
  if (!extraFiles.length) return page;
  const text = (f) => (side === 'before' ? fs.readFileSync(path.join(ROOT, f.file), 'utf8') : f.content);
  return [`----- ${relFile} -----\n${page}`, ...extraFiles.map((f) => `----- ${f.file} -----\n${text(f)}`)].join('\n');
}

const LOG_COMMANDS = { edit: 'page:edit', generate: 'page:generate', convert: 'page:convert' };

/**
 * The work-log summary of a change: a few points Claude writes from what
 * changed. Also made for a preview with --proposal-out, because the web app
 * logs the change when it's applied, without calling Claude again.
 */
async function summaryFor({ mode, relFile, instruction, before, after, notes = '' }) {
  console.log('  Writing the work-log summary…');
  return summarizeChange({ apiKey, model: CLAUDE_MODEL, command: LOG_COMMANDS[mode], file: relFile, instruction, before, after, notes });
}

/** What the work log says a run without an instruction did. */
function defaultLogInstruction(mode, source) {
  if (mode === 'generate') return 'turned the draft into the finished page';
  if (mode === 'convert') return `converted ${path.posix.basename(source || 'an HTML page')} into the page`;
  return '';
}

/** Saves a dry-run's proposed file for tools that show it and then write exactly that version. */
function writeProposal({ relFile, mode, instruction, images, raw, problems, warnings, source, files, checks, summary }) {
  const target = path.resolve(ROOT, String(proposalOut));
  if (!target.startsWith(ROOT + path.sep)) {
    console.error(`  --proposal-out must be inside the repository, not ${proposalOut}.`);
    return;
  }
  const proposal = {
    file: relFile,
    mode,
    instruction,
    images: images.map((image) => image.ref),
    ...(source ? { source } : {}),
    // Other files the change writes alongside the page (a --keep-styles stylesheet).
    ...(files?.length ? { files } : {}),
    // What the conversion tested before showing this (attempts, content, render passes).
    ...(checks?.length ? { checks } : {}),
    // The work-log summary the web app records with the change when it's applied.
    ...(summary?.length ? { summary } : {}),
    content: raw.endsWith('\n') ? raw : `${raw}\n`,
    problems,
    warnings,
    model: CLAUDE_MODEL,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(proposal, null, 2)}\n`);
  console.log(`\n  Saved the proposal to ${path.relative(ROOT, target).replace(/\\/g, '/')}`);
}

/* -------------------------------------------------------------------- run */

async function runAdHoc(pageArg, instruction, mode, source) {
  const relFile = resolveFile(pageArg);
  if (!relFile) {
    console.error(`\n  Could not resolve "${pageArg}" to a file.\n`);
    process.exit(1);
  }

  const ok = await applyEdit(relFile, instruction, imageArgs, mode, source, { keepStyles: keepStylesFlag, css: cssArgs, js: jsArgs });
  if (!dryRun) {
    console.log(ok ? `  Review with: git diff -- ${relFile}\n  Validate with: npm run check\n` : '');
    process.exit(ok ? 0 : 3);
  }
}

async function runQueue() {
  const registry = loadQueue();
  // Blank placeholder entries (file "" and instruction "") are not real jobs.
  const queue = registry.queue.filter((job) => job.file || job.instruction);

  if (!queue.length) {
    console.log(`
  No queued edits. scripts/page-commands.json's "queue" is empty.
  Add { "file": "...", "instruction": "..." } entries to it, or run:
    npm run page:edit -- <page> "<instruction>"
`);
    return;
  }

  console.log(`\n  Running ${queue.length} queued edit${queue.length === 1 ? '' : 's'} from scripts/page-commands.json\n`);

  const remaining = [...queue];
  let stoppedEarly = false;

  for (const job of queue) {
    console.log('  ----------------------------------------');
    const mode = ['generate', 'convert'].includes(job.mode) ? job.mode : 'edit';
    let ok = false;
    if (mode === 'edit' && !job.instruction) {
      console.error(`  ${job.file}: a queued edit needs an instruction (or "mode": "generate").\n`);
    } else if (mode === 'convert' && !job.source) {
      console.error(`  ${job.file}: a queued convert job needs "source": the HTML file to convert.\n`);
    } else {
      const relFile = (job.file && resolveFile(job.file)) || String(job.file || '');
      ok = await applyEdit(relFile, job.instruction || '', Array.isArray(job.images) ? job.images : [], mode, job.source || null, {
        keepStyles: job.markdown !== true && job.keepStyles !== false,
        css: Array.isArray(job.css) ? job.css.map(String) : [],
        js: Array.isArray(job.js) ? job.js.map(String) : [],
      });
    }

    if (dryRun) {
      remaining.shift();
      continue;
    }

    if (!ok) {
      stoppedEarly = true;
      break; // leave this job and everything after it queued
    }

    remaining.shift();
    writeQueue({ _comment: registry._comment, queue: remaining });
  }

  if (!dryRun) {
    if (stoppedEarly) {
      console.log('  Stopped after a failed edit — it and any after it are still queued.\n');
    } else {
      writeQueue({ _comment: DEFAULT_QUEUE_COMMENT, queue: [{ file: '', instruction: '' }] });
      console.log('  Queue cleared and reset to a blank placeholder job. Validate with: npm run check\n');
    }
  }
}

if (positional.length) {
  const [pageArg, instructionArg] = positional;
  const instruction = instructionArg || (typeof flag('instruction') === 'string' ? flag('instruction') : '');
  const mode = generateFlag ? 'generate' : fromHtml !== undefined ? 'convert' : 'edit';
  const usable =
    (mode === 'edit' ? Boolean(instruction) : mode === 'generate' ? fromHtml === undefined : typeof fromHtml === 'string') &&
    ((!markdownFlag && !flag('keep-styles') && !cssArgs.length) || mode === 'convert') &&
    !(markdownFlag && (cssArgs.length || jsArgs.length)) &&
    (mode === 'convert' || !jsArgs.length);
  if (!usable) {
    console.error(`
  Usage:
    node scripts/edit-page.js <page> "<instruction>"          edit by instruction
    node scripts/edit-page.js <page> --generate ["<direction>"]  turn the page's draft into the finished page
    node scripts/edit-page.js <page> --from-html=<file.html> [--css=<file.css>...] ["<direction>"]
                                                              copy an existing HTML page in, as it is, with its own CSS
    node scripts/edit-page.js <page> --from-html=<file.html> --markdown ["<direction>"]
                                                              rewrite it as markdown in the site's design instead
    node scripts/edit-page.js                                 run every queued edit
    node scripts/edit-page.js --list                          show the queue
`);
    process.exit(1);
  }
  if (!apiKey && !dryRun) {
    console.error('\n  ANTHROPIC_API_KEY is not set. Add it to your environment or repository secrets.\n');
    process.exit(1);
  }
  runAdHoc(pageArg, instruction, mode, typeof fromHtml === 'string' ? fromHtml : null).catch((error) => {
    console.error(`\n  Edit failed: ${error.message}\n`);
    process.exit(1);
  });
} else {
  if (!apiKey && !dryRun) {
    console.error('\n  ANTHROPIC_API_KEY is not set. Add it to your environment or repository secrets.\n');
    process.exit(1);
  }
  runQueue().catch((error) => {
    console.error(`\n  Queue run failed: ${error.message}\n`);
    process.exit(1);
  });
}
