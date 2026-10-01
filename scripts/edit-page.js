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
 * Convert (--from-html=<file>): turn an existing HTML page (from an old site,
 * say) into the page's markdown. The site's header, footer, navigation,
 * sidebars, scripts and styles are cut out before Claude sees the HTML
 * (scripts/lib/html-source.js), and Claude leaves out any it still finds.
 * The wording is kept, the page's frontmatter is kept, and the page's current
 * body is replaced. The instruction is optional extra direction.
 *
 *   node scripts/edit-page.js <page> --from-html=old/about.html ["<extra direction>"]
 *   node scripts/edit-page.js <page> --from-html=old/about.html --dry-run
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
import { parseFrontmatter } from './lib/markdown.js';
import { bannedPhraseWarnings, requestClaude, resolveImages, stripFence } from './lib/claude-writer.js';
import { knowledgePrompt, recordWork } from './lib/knowledge.js';
import { MAX_CLEAN_CHARS, cleanHtml, htmlImages, readHtmlSource, visibleText } from './lib/html-source.js';

const COMMANDS_PATH = path.join(ROOT, 'scripts/page-commands.json');
const DEFAULT_QUEUE_COMMENT = 'Queue of pending edits for `npm run page:edit` (no arguments). Each entry is one job: { file, instruction }, optionally with "images": [...] and "mode": "generate" (turn the file\'s own draft into the finished page; the instruction may then be empty). Running with no arguments processes every entry in order, writes each one, then removes it from this queue. Add entries by hand any time; running `npm run page:edit -- <page> "<instruction>"` with arguments applies that edit immediately instead and never touches this file.';
const EDITABLE_ROOTS = ['content', 'templates', 'styles/main.css', 'site.config.json'];
const MAX_TOKENS = 16000;
// Keeps the request well inside the API's 32 MB limit (base64 adds a third).
const MAX_VISION_IMAGES = 20;
const MAX_VISION_BYTES = 18 * 1024 * 1024;
// Fields that decide where a page lives and whether it's published.
const LOCKED_FIELDS = ['slug', 'url', 'layout', 'date', 'draft', 'order'];

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

const site = readJson(path.join(ROOT, 'site.config.json'));
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
                               literal — e.g. content/data/home.json's homepage section
                               list has entries like { "partial": "section-products", ... }
                               and templates/layouts/home.html does
                               {{# each data.home.sections }}{{> [partial] }}{{/ each }}

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
- Do not invent facts: statistics, client names, release numbers, or claims about Salesforce behaviour need to already be true of the codebase you can see. If unsure, describe the shape of the thing rather than quantifying it.
- British spelling, sentence case headings, plain verbs. No exclamation marks, no "unlock", "seamless", "game-changing", "dive in".
- Markdown content files: do not add a leading "# Title" heading — the layout renders the title separately.
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
    ? `This file is a markdown content file. Its body is rendered as a template BEFORE markdown conversion, so template syntax works directly in the body. ${contextVariables()}`
    : relFile.startsWith('templates/')
      ? `This file is an HTML template rendered with the same template engine as content files. It has no server-side logic beyond the engine's own syntax. ${contextVariables()}`
      : `This is a site-wide config or stylesheet file, not rendered through the template engine.`;

  const systemPrompt = `You edit one existing file in the source of ${site.name}'s static site (${site.description}). You will be given the file's full current contents and an instruction. Return the complete new file, and nothing else.

${TEMPLATE_SYNTAX}

${contextNote}

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

THE PAGE'S LAYOUT
This page renders through templates/layouts/${layoutInfo.name}.html. The layout already shows the title and hero above the body and any FAQ, call to action and related items after it, so the body must not repeat them. Fields this layout reads from the frontmatter: ${layoutInfo.fields.length ? layoutInfo.fields.join(', ') : 'none beyond title'}.
----- templates/layouts/${layoutInfo.name}.html -----
${layoutInfo.source || '(layout file not found)'}
----- end layout -----

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
- Keep every existing field and its value. A value that is a note to the writer rather than content — what "npm run new" leaves, such as "Under 160 characters, written for search results." or "One sentence on what this page is for." — counts as empty: replace it from the HTML, or leave the field empty if the HTML has nothing for it.
- Keep the title unless it's empty or a placeholder, in which case use the page's main heading (or else the HTML <title> without the site name).
- Never add, change or remove ${LOCKED_FIELDS.join(', ')}: the site derives them when they're missing, and changing them moves or unpublishes the page.
- If description is missing, empty or a placeholder, use the HTML's meta description if there is one (at most 160 characters), or else write one plain sentence summarising the page.
- Fill in other fields this layout reads (listed below) that are missing or empty, but only from material that is in the HTML — for example an intro paragraph under the main heading as heroText, or a list that matches deliverables. Material moved into such a field shouldn't also be repeated in the body.
- The page's current body is replaced by the converted content.

${FRONTMATTER_SYNTAX}

THE PAGE'S LAYOUT
This page renders through templates/layouts/${layoutInfo.name}.html. The layout already shows the title and hero above the body and any FAQ, call to action and related items after it, so the body must not repeat them. Fields this layout reads from the frontmatter: ${layoutInfo.fields.length ? layoutInfo.fields.join(', ') : 'none beyond title'}.
----- templates/layouts/${layoutInfo.name}.html -----
${layoutInfo.source || '(layout file not found)'}
----- end layout -----

IMAGES
${imageList}${unavailable}
- Reference each image by exactly the path or URL listed (not the HTML's src when they differ). Never invent or alter an image path.
- The images you can see are attached above, in the same order. Keep the HTML's alt text when it describes the image; otherwise write alt text that says what is visibly in the image. Use ![Alt text](path), or the HTML <figure> form for an image that had a caption:
<figure>
  <img src="path" alt="Alt text" loading="lazy">
  <figcaption>Caption</figcaption>
</figure>
- Leave out purely decorative images (spacers, dividers, icons next to a heading).

${HOUSE_RULES.replace(/^- (British spelling|Do not invent facts).*\n/gm, '')}
- Keep the original wording even where it doesn't follow this site's style: the author asked for a conversion. Only follow the style rules for text you have to write yourself (a description, alt text).

${knowledgeSection()}OUTPUT
Return only the raw contents of the finished file, starting with the opening "---" of the frontmatter. No commentary, no explanation, no surrounding code fence.`;

  const userPrompt = `File: ${relFile}

----- current file (keep its frontmatter, replace its body) -----
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
  return { file, ...cleaned, entries, unavailable };
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
    return requestClaude({ apiKey, model: site.automation.model, systemPrompt, userContent: userContent(userPrompt, list), maxTokens: MAX_TOKENS });
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

function generateChecks(original, updated, images) {
  const { problems, warnings } = pageChecks(original, updated);

  // Each image from the draft must survive, and no image may appear from nowhere.
  for (const image of images) {
    if (!includesImage(updated, image.ref)) problems.push(`an image from the draft is missing from the page: ${image.ref}`);
    if (image.missing) warnings.push(`${image.ref} doesn't exist in the repo, so the page will show a broken image until it's added`);
  }
  problems.push(...unknownImageProblems(updated, images, 'draft'));
  if (/<!--|^\s*TODO\b/im.test(parseFrontmatter(updated).body)) warnings.push('the page still contains a comment or TODO note');
  return { problems, warnings };
}

function convertChecks(original, updated, images, page) {
  const { problems, warnings } = pageChecks(original, updated);

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
function pageChecks(original, updated) {
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

  if (/^#\s/m.test(after.body)) warnings.push('the body has a "# " heading; the layout already shows the title');
  warnings.push(...bannedPhraseWarnings(after.body));

  problems.push(...balanceProblems(updated), ...partialProblems(updated));
  return { problems, warnings };
}

/* ------------------------------------------------------------- one edit --- */

const MODE_LABELS = {
  edit: 'edit by instruction',
  generate: 'generate the page from its draft',
  convert: 'convert an HTML page into this page',
};

async function applyEdit(relFile, instruction, imageEntries = [], mode = 'edit', source = null) {
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

  let htmlPage = null;
  if (convert) {
    try {
      htmlPage = loadHtmlPage(source);
    } catch (error) {
      console.error(`  Can't convert: ${error.message}.\n`);
      return false;
    }
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

  const layout = generate || convert ? layoutFor(relFile, parseFrontmatter(original).data) : null;
  const buildPrompts = (list) =>
    generate
      ? buildGeneratePrompts(relFile, instruction, original, list, layout)
      : convert
        ? buildConvertPrompts(relFile, instruction, original, list, layout, htmlPage)
        : buildEditPrompts(relFile, instruction, original, list);
  const { systemPrompt, userPrompt, isContent } = buildPrompts(images);

  if (!apiKey) {
    console.log(`----- system prompt -----\n${systemPrompt}\n\n----- user prompt -----\n${userPrompt}\n`);
    console.log('  No ANTHROPIC_API_KEY set, so nothing was sent.\n');
    return false;
  }

  console.log(`  Model: ${site.automation.model}\n`);
  const reply = await askClaude(buildPrompts, images);
  if (reply.stopReason === 'refusal') {
    console.error(`  Claude declined this request. Rephrase the ${{ edit: 'instruction', generate: 'draft', convert: 'direction' }[mode]} and try again.\n`);
    return false;
  }
  const raw = stripFence(reply.text);
  const checked = generate
    ? generateChecks(original, raw, reply.images)
    : convert
      ? convertChecks(original, raw, reply.images, htmlPage)
      : editChecks(original, raw, isContent);
  const problems = [...checked.problems];
  const { warnings } = checked;
  if (reply.stopReason === 'max_tokens') problems.unshift(`Claude's reply was cut off at ${MAX_TOKENS} tokens, so the file is incomplete`);

  if (dryRun) {
    console.log(`----- proposed ${relFile} (not written) -----\n`);
    console.log(raw);
    if (problems.length) console.log(`\n  problem: ${problems.join('\n  problem: ')}`);
    if (warnings.length) console.log(`\n  warning: ${warnings.join('\n  warning: ')}`);
    if (proposalOut) writeProposal({ relFile, mode, instruction, images: reply.images, raw, problems, warnings, source: htmlPage?.file });
    return false;
  }

  if (problems.length) {
    console.error(`\n  Refused to write — looked wrong:\n${problems.map((p) => `    - ${p}`).join('\n')}\n\n  Re-run with --dry-run to inspect the output, or rephrase the ${{ edit: 'instruction', generate: 'draft', convert: 'direction' }[mode]}.\n`);
    return false;
  }

  fs.writeFileSync(targetPath, raw.endsWith('\n') ? raw : `${raw}\n`);
  recordWork({
    command: { edit: 'page:edit', generate: 'page:generate', convert: 'page:convert' }[mode],
    file: relFile,
    instruction: instruction || defaultLogInstruction(mode, htmlPage?.file),
  });
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  console.log(`\n  Wrote ${relFile}  (${original.split('\n').length} -> ${raw.split('\n').length} lines)\n`);
  return true;
}

/** What the work log says a run without an instruction did. */
function defaultLogInstruction(mode, source) {
  if (mode === 'generate') return 'turned the draft into the finished page';
  if (mode === 'convert') return `converted ${path.posix.basename(source || 'an HTML page')} into the page`;
  return '';
}

/** Saves a dry-run's proposed file for tools that show it and then write exactly that version. */
function writeProposal({ relFile, mode, instruction, images, raw, problems, warnings, source }) {
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
    content: raw.endsWith('\n') ? raw : `${raw}\n`,
    problems,
    warnings,
    model: site.automation.model,
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

  const ok = await applyEdit(relFile, instruction, imageArgs, mode, source);
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
      ok = await applyEdit(relFile, job.instruction || '', Array.isArray(job.images) ? job.images : [], mode, job.source || null);
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
  const usable = mode === 'edit' ? Boolean(instruction) : mode === 'generate' ? fromHtml === undefined : typeof fromHtml === 'string';
  if (!usable) {
    console.error(`
  Usage:
    node scripts/edit-page.js <page> "<instruction>"          edit by instruction
    node scripts/edit-page.js <page> --generate ["<direction>"]  turn the page's draft into the finished page
    node scripts/edit-page.js <page> --from-html=<file.html> ["<direction>"]
                                                              convert an existing HTML page into this page
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
