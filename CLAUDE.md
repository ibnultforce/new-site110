# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Working on this repository

Instructions for Claude (or any agent) asked to change this site.

## What this is

A static site generator for twinstack.net. Content is markdown with
frontmatter, templates are logic-light HTML styled with Tailwind, everything
else is derived. Node 18+ and one `npm install` (Tailwind only) are the
requirements — no framework, no bundler.

**Read `TAILWIND-GUIDELINES.md` before writing any CSS or class name.**

```
site.config.json     brand, contact, collections, deploy, automation settings
content/data/*.json  navigation, shared facts, FAQ, redirects, blog queue
content/<type>/*.md  the pages themselves
templates/layouts/   one file per page type
templates/partials/  shared fragments (header, footer, cards, CTA)
styles/main.css      Tailwind source: theme tokens, utilities, component layer
assets/              compiled CSS, JS, images — copied to dist/assets
scripts/             build, dev server, checker, scaffolder, blog writer, page editor
knowledge/           what Claude knows from previous work: owner's notes + automatic work log
dist/                generated output; never edit, never commit
```

## Commands

```bash
npm install                    # once — Tailwind is the only dependency
npm run build                  # build to dist/ (compiles CSS too)
npm run dev                    # preview at http://localhost:4321; rebuilds on change, drafts visible
npm run check                  # build, then fail on broken internal links or duplicate URLs
npm run css / npm run css:watch   # compile styles/main.css -> assets/css/main.css directly
npm run new <type> "Title"     # scaffold a product, service, page, post or case study
npm run nav:add -- "Label" "/url/" [--collection=name --limit=n]
npm run nav:remove -- "Label"
npm run scaffold                       # create every page listed in scripts/site-tree.md that's missing
npm run scaffold:preview                # same, print the plan, write nothing
npm run scaffold:schedule               # run every due job in scripts/scaffold-schedule.md, Claude writes real copy
npm run scaffold:schedule:preview       # same, print what's due, write and mark nothing
npm run changelog                       # regenerate CHANGELOG.md from git log
npm run page:edit -- <page> "<instruction>"        # edit one existing content/template file with Claude, now
npm run page:edit:preview -- <page> "<instruction>" # same, print only, write nothing
npm run page:edit                                  # run every queued edit in scripts/page-commands.json
npm run page:edit:preview                          # same, print only, write nothing
npm run page:edit:list                             # list the pending queue, run nothing
npm run page:generate -- <page> ["<direction>"]    # Claude turns the page's own draft (.md) into the finished page
npm run page:generate:preview -- <page>            # same, print only, write nothing
npm run page:edit -- <page> --from-html=<file.html> ["<direction>"]  # Claude converts an existing HTML page into the page
npm run page:edit:preview -- <page> --from-html=<file.html>         # same, print only, write nothing
npm run page:edit -- <page> --from-html=<file.html> --keep-styles [--css=<file.css>]  # copy it as-is with its own CSS
npm run md:edit -- <file.md> "<instruction>"       # edit a markdown file outside content/ with Claude
npm run md:edit:preview -- <file.md> "<instruction>" # same, print only, write nothing
npm run md:edit:list                               # list the markdown files md:edit can change
```

There is no separate lint or test suite — `npm run check` (build + link/URL/SEO
validation) is the correctness gate. There is no way to build or check a single
page; both always run over the whole site.

## Architecture

`scripts/build.js` drives everything, using `scripts/lib/`:

1. `lib/content.js` loads `site.config.json`, every file under `content/data/`,
   and every markdown file in each collection directory named in
   `site.config.json` → `collections` (frontmatter + body), producing one
   `model` with `site`, `data`, `collections`, `nav`, `all` (every page) and
   `byUrl`.
2. `lib/template.js` is a tiny dependency-free logic-light engine (`{{ value }}`,
   `{{{ raw }}}`, `{{#if}}`/`{{#unless}}`, `{{#each}}`, `{{> partial}}`,
   `{{> [value] }}` to include a partial named by a looked-up value instead of a
   literal — how `content/data/home.json` picks which partial renders each
   homepage section). Name lookup walks the whole context stack, so a partial or `{{#each}}` block
   reaches `site`/`nav`/`page` without prop drilling. Every
   `templates/partials/*.html` is registered by filename; every
   `templates/layouts/*.html` is registered as `layout:<name>`.
3. Per page: the markdown body is rendered as a template first — this is what
   makes `{{ site.contact.email }}` and `{{> stats }}` work inside content
   files — then through `lib/markdown.js`, then through the layout named in
   frontmatter, then wrapped in `templates/partials/base.html` together with
   JSON-LD from `lib/schema.js`.
4. After all pages are written, `build.js` generates `sitemap.xml`, `rss.xml`,
   `robots.txt`, `search-index.json` and `_redirects` (from
   `content/data/redirects.json`), then copies `assets/` and any `static/` into
   `dist/`. `lib/css.js` compiles `styles/main.css` with the Tailwind CLI after
   pages render (so Tailwind sees the generated HTML) and before assets are
   copied.
5. `scripts/dev.js` reruns this whole build (with `--drafts`) on any change
   under `content/`, `templates/`, `styles/`, `assets/js`, `assets/img`,
   `site.config.json` or `scripts/`, and serves `dist/` with clean URLs. Every
   root-relative `href`/`src` is written with `basePath()` from
   `lib/content.js` as a prefix: `/dist` in dev (`NODE_ENV=development`),
   `BASE_PATH` otherwise (the deploy workflow passes `/<repo>` for a GitHub
   Pages project site, nothing on a custom domain). Absolute URLs (canonical,
   `og:*`, JSON-LD, sitemap, RSS) come from `site.url`, which `SITE_URL`
   overrides (the workflow passes the Pages address). `scripts/check.js` strips
   the same prefix back off before checking that links resolve to real output
   files. `CNAME` is only written when `site.url`'s host is `deploy.cname`, so a
   copy published on github.io never claims the domain.
6. `scripts/check.js` reloads the same content model, walks the built `dist/`
   tree, and errors on duplicate URLs or internal links/images pointing at
   files that don't exist; it warns on missing or overlong SEO fields, missing
   `alt` text and thin body content.

Nothing in the pipeline is page-specific: a page exists because a markdown file
exists in a collection directory, and navigation highlighting, listing pages,
the sitemap, RSS, the search index and JSON-LD are all derived from `model` at
build time.

## Rules

1. **Never edit `dist/` or `assets/css/main.css`.** Both are generated. CSS is
   compiled from `styles/main.css` on every build.
2. **Never hardcode anything that appears on more than one page.** Contact
   details, nav links, stats and FAQ entries live in `site.config.json` or
   `content/data/`. If you find yourself typing the same string twice, it
   belongs in one of those files.
3. **Never hand-list content.** Product grids, service menus, blog listings and
   the footer are generated from collections. Adding a markdown file is the
   whole job.
4. **Run `npm run check` before saying you are done.** It builds and then fails
   on broken internal links and duplicate URLs.5. **Markdown bodies are templated first, then rendered.** `{{ site.contact.email }}`
   and `{{> stats }}` work inside content files. Escape literal braces if a post
   needs to show template syntax.
6. **Do not invent facts.** Statistics, client names, release numbers and
   Salesforce behaviour need a source. If unsure, describe the shape of the
   thing rather than quantifying it.
7. **Read `knowledge/notes.md` and `knowledge/work-log.md` before changing
   content.** They hold the owner's standing instructions and what earlier
   Claude runs changed. Follow the notes; treat the log as history, not fact.

## Common tasks

**Add a product, service, page, post or case study**

```bash
npm run new product "Field Audit Trail Viewer"
```

Fill in the frontmatter. Navigation, listing pages, the footer, sitemap, RSS and
the search index all update on the next build. Nothing else needs touching.

**Change something site-wide**

| Change | File |
| --- | --- |
| Phone, email, booking link | `site.config.json` → `contact` |
| Nav or footer structure | `content/data/navigation.json` |
| Headline stats | `content/data/company.json` |
| FAQ entries | `content/data/faq.json` |
| Homepage sections — which appear, in what order, their copy | `content/data/home.json` (each entry names a `partial` from `templates/partials/`; add a new partial and reference it here to add a new kind of section, no layout edit needed) |
| Colours, type scale, fonts | `styles/main.css` → `@theme` |
| A repeated visual pattern | `styles/main.css` → `@layer components` (read the guidelines first) |
| Page shell, meta tags, schema | `templates/partials/base.html`, `scripts/lib/schema.js` |
| A page type's structure | `templates/layouts/<layout>.html` |

**Add a new content type** (for example, `events`)

1. Add an entry to `site.config.json` → `collections`.
2. Create `templates/layouts/event.html` and, if it needs one, a list layout.
3. Create `content/events/` and add markdown.
4. Optionally add a `type: "collection"` entry to `navigation.json`.

No build code changes.

**Edit an existing page with Claude**

```bash
npm run page:edit:preview -- products "Add a short section listing the 5 most recent blog posts"
npm run page:edit -- products "Add a short section listing the 5 most recent blog posts"
```

`<page>` is a content slug, a URL, or a path under `content/` or `templates/`.
`scripts/edit-page.js` reads the whole file, sends it to Claude with the
template engine syntax and the context variables available to that file
(collections, `content/data/` files and partials are read from the site as it
is, so new ones reach the prompt automatically), and writes back the complete
file. It refuses to write if Claude's reply was cut off at the token limit,
looks truncated, drops a required frontmatter field, or has unbalanced
`{{#if}}`/`{{#each}}` blocks.

**Write a page yourself, then let Claude finish it**

```bash
npm run page:generate:preview -- permission-audit
npm run page:generate -- permission-audit "Keep it to three sections"
```

Write the page's `.md` the way you'd brief a writer: rough copy, pasted text,
lists, `![](…)` images, `<img src>`, bare image URLs or `assets/img/…` paths,
and notes to the writer (`<!-- … -->`, `TODO`, `[note: …]`). `--generate`
sends that draft to Claude together with the page's layout template, so
Claude fills the frontmatter fields the layout renders (a service's
`tagline`, `deliverables`, `steps`…) from the draft, writes the body in house
style and places every image with alt text. Every image in the draft is found
automatically and sent as vision input (up to 20, 18 MB). If the API can't
download an image URL, the request is retried with that URL named but not
shown. The draft is the only source of facts: Claude is told to add none.
Its reply is checked before anything is written. These **problems** block the
write: a changed or added `slug`, `url`, `layout`, `date`, `draft` or `order`;
an image from the draft that's missing, or one that appears from nowhere; a
partial that doesn't exist; frontmatter the site's parser can't read; a reply
cut off at the token limit. **Warnings** are printed but don't block: links to
pages that don't exist, leftover notes, a `# ` heading, banned phrases, a
draft image that isn't in the repo yet. Queue entries take
`"mode": "generate"`, and then the instruction may be empty.

**Convert an existing HTML page into a page**

```bash
npm run new page "About us"
npm run page:edit:preview -- about-us --from-html=old-site/about.html
npm run page:edit -- about-us --from-html=old-site/about.html "Put the history table last"
```

`--from-html=<file>` takes an HTML file inside the repo (up to 2 MB) and
replaces the page's body with its content, converted to markdown. The target
must already exist under `content/`, because its frontmatter is kept.
`scripts/lib/html-source.js` cleans the HTML before Claude sees it. It
removes scripts, styles, comments and embedded `data:` images. When `<main>`
holds most of the text, it removes everything outside `<main>`. It also
removes the old site's header, footer, navigation, sidebars and cookie banners,
which it finds by tag (`header`, `footer`, `nav`, `aside`), by role (`banner`,
`contentinfo`, `navigation`, `complementary`) and by class or id
(`site-header`, `footer`, `navbar`…). A `<header>` or `<footer>` inside `<main>`
or `<article>` is the content's own (an article's title or date) and stays, but
navigation goes wherever it is. Claude is told to leave out any chrome that is
still there, and to keep the page's wording rather than rewrite it. Placeholder
frontmatter from `npm run new` is filled from the HTML (the meta description,
the `<h1>`, the intro paragraph). The content is refused if it's over 150,000
characters once cleaned. Images with http(s) URLs and images whose paths exist
in the repo are sent as vision input. Relative paths to the old site's files
are left out, and each one is listed as a warning. These **problems** block the
write: the same frontmatter, locked-field, partial and cut-off checks as
`--generate`, and an image that isn't in the HTML or the repo. **Warnings**: a
page with less than half the HTML's text, an image from the HTML that was
dropped, links to pages that don't exist, and the list of what was removed.
The work log records `page:convert`, the proposal has `"mode": "convert"` and
`"source"`, and queue entries take `"mode": "convert", "source": "<file.html>"`.
The Twinstack web app detects the feature by searching `edit-page.js` for the
literal `--from-html`.

Add `--keep-styles` (plus `--css=<file.css>` for each stylesheet the page
links) to keep the old page's look instead of converting it to markdown:

```bash
npm run page:edit -- about-us --from-html=old-site/about.html --keep-styles --css=old-site/css/style.css
```

The body is then copied by code, not by Claude. Header, footer and navigation
are removed as above, and the rest keeps its elements, classes, ids, inline
styles and SVG. Scripts, event handlers, `data-*` and `javascript:` links are
dropped, and with them any script-driven effects such as scroll-reveal
animations. Each class is prefixed `imp-`, so the site's components and
Tailwind utilities (Tailwind scans `content/`) never match imported markup.
The body is written as one raw HTML block inside `<div class="imported-page">`,
with no blank lines (the markdown renderer ends a raw block at one) and with
`{{`/`}}` escaped as entities.

`scripts/lib/css-scope.js` builds the page's stylesheet. Its inputs are the
`<style>` blocks and the uploaded files, in the page's own cascade order: an
upload whose file name matches a `<link href>` takes that link's place, and
the rest come first. Linked stylesheets from web-font services (Google Fonts,
Bunny, Typekit, Fontshare) become an `@import`. Every selector is put under
`.imported-page`, with `html`/`body`/`:root` rules becoming the wrapper's, and
class names get the same prefix. Rules for classes or ids that no longer exist
in the body are dropped, which removes the old header and footer CSS and
unused framework rules.

Two zero-specificity rules isolate the page from the site:
`:where(.imported-page) { all: initial; display: block }` makes the wrapper
start like a fresh `<body>` (16px, not the site body's size), and
`:where(.imported-page *) { all: revert }` rolls the site's preflight and base
layer (heading colours, `text-wrap: balance`, img/svg display) back to browser
defaults. Every imported rule still wins over both. The result goes to
`assets/css/imported/<page>.css` (refused over 600 KB).

Claude writes only the frontmatter, from a text version of the page. The
script adds `stylesheet: /assets/css/imported/<page>.css` and `hideCta: true`,
because the page brings its own call to action.
`templates/partials/base.html` loads `page.stylesheet` after `main.css`, and
`templates/layouts/page.html` renders a page that has one edge to edge, without
the hero or `.prose-site`. Other layouts load the stylesheet but keep their
own structure. A page converted this way was checked element by element
against its original at 390–1400px and rendered identically.

Warnings list linked stylesheets that weren't uploaded (other external ones
are never fetched), `url()` references to files the site doesn't have, and
images that were left out. The dry-run proposal carries the stylesheet in
`"files": [{ "file", "content" }]`, and queue entries take
`"keepStyles": true, "css": [...]`. The web app detects this by searching for
the literal `--keep-styles`. Imported stylesheets are the one exception to
TAILWIND-GUIDELINES.md: they're the old site's CSS, regenerated by converting
again, so don't hand-edit them into the design system.

Pass `--image=<path|url>` (repeatable) to give Claude images to look at and
place in the page. A path is a file in the repo, such as
`assets/img/uploads/team.jpg`, which the page references as
`/assets/img/uploads/team.jpg`. A URL is used as-is. Both are sent as vision
input through `resolveImages()` in `scripts/lib/claude-writer.js`, and queue
entries accept an `images` list. With `--dry-run`,
`--proposal-out=<file>` also saves the complete proposed file as JSON
(`file`, `mode`, `content`, `problems`, `warnings`…). The Twinstack web app
uses it to show the preview and then write exactly that version, and it
detects what a copy supports by searching `edit-page.js` for the literal
strings `--proposal-out`, `--generate`, `--from-html` and `--keep-styles`, so
keep all four in the file.
`ANTHROPIC_BASE_URL` overrides the API host for a proxy or a mock.

Run with no `<page>` argument and it works through the queue in
`scripts/page-commands.json` instead — a list of `{ file, instruction }` jobs,
applied in order, each one removed from the queue once it's written. Add jobs
to that file by hand any time; `npm run page:edit:list` prints what's pending
without running anything. A `<page>` argument on the command line always runs
that one edit immediately and never touches the queue file. Always
`npm run check` afterwards.

**Edit other markdown files with Claude**

```bash
npm run md:edit:preview -- scripts/site-tree.md "Add a careers page after faq.html"
npm run md:edit -- scripts/scaffold-schedule.md "Add a blog job for 2 November about field history limits"
```

`scripts/edit-md.js` is `page:edit` for markdown outside `content/`:
`scripts/site-tree.md`, `scripts/scaffold-schedule.md`,
`scripts/site-tree-content/*.md` and the docs. It refuses `content/` (use
`page:edit`), `dist/`, `node_modules/`, `static/`, dot-directories,
`CHANGELOG.md` and files over 40 KB. Claude returns the whole file, and the
file's line endings are kept. These **problems** block the write: a reply cut
off at the token limit, an empty reply, an unclosed ``` fence, frontmatter
that lost its closing `---`, a schedule job list that no longer parses
(`scripts/lib/schedule-jobs.js`, shared with `scaffold-schedule.js`), and a
site tree with no page lines left. **Warnings**: pages added to or removed
from the tree, a changed job count, a done job that changed, a file that
shrank by half. `--dry-run --proposal-out=<file>` saves the proposal with
`"mode": "markdown"`, which is how the Twinstack web app previews it. The web
app only offers the command when `scripts/edit-md.js` exists, and otherwise
installs `scripts/edit-md.js` and `scripts/lib/schedule-jobs.js` from this
repo's default branch into older copies. So `edit-md.js` imports only `ROOT`
and `readJson` from `lib/content.js` plus `lib/schedule-jobs.js`, and keeps its
own API call and site-tree parser: don't make it import anything newer.

**Scaffold the whole page tree, or schedule pages for later**

`scripts/site-tree.md` is an indented bullet list of every page path the site
should have, each optionally followed by `— instruction` text for Claude to
write the body from. `npm run scaffold` walks it and creates whatever markdown
files are missing (`--force` to also overwrite existing ones, `--file=` to use
a different tree file); `npm run scaffold:preview` prints the plan without
writing.

`scripts/scaffold-schedule.md` holds a fenced JSON array of dated one-off
jobs (`location`, `title`, `date`, `description`, plus optional `content`,
`images`, `research`) — each one runs once its date arrives, Claude writes the
real body copy (not a placeholder), and the job is marked `"done": true` so it
never runs twice. `npm run scaffold:schedule` runs whatever is due;
`npm run scaffold:schedule:preview` prints it without writing or marking
anything. Both scaffold commands need `ANTHROPIC_API_KEY`.

Both scaffold commands append to `CHANGELOG.md` afterwards (via
`scripts/lib/changelog.js`); `npm run changelog` regenerates it from `git log`
directly. Treat `CHANGELOG.md` as generated — like `dist/`, don't hand-edit it.

**What Claude knows from previous work (`knowledge/`)**

Every Claude request (`page:edit`, `page:generate`, `md:edit`,
`scaffold:schedule`) sends two files along in its system prompt, through
`scripts/lib/knowledge.js`:

- `knowledge/notes.md`: the owner's standing notes (voice, audience,
  decisions, things to avoid). Hand-edit it, or use
  `npm run md:edit -- knowledge/notes.md "<instruction>"`. HTML comments and
  empty sections aren't sent, so the starter file sends nothing. Only the
  first 12,000 characters are sent.
- `knowledge/work-log.md`: one line per change Claude wrote, appended
  automatically after the write (`- <date> · <command> · <file> · <instruction>`).
  Once it passes 60 entries, all but the newest 30 move to
  `knowledge/archive/work-log-<date>.md`, which is never sent. Previews
  (`--dry-run`) log nothing, and neither do edits to `knowledge/` itself.

Claude is told the notes are instructions and the log is history: the current
files win over the log, and the log is never a source of facts.

The committed log only holds the checked-out branch's lines, so the Twinstack
web app also keeps each site's log in its database, where a change counts as
soon as it's made, not when its pull request merges. Before every Claude run it
writes the latest log to a file in `.git/` and sets `TWINSTACK_WORK_LOG` to
that path. `knowledge.js` then reads the prompt's log from that file and adds
new entries to it as well as to `knowledge/work-log.md`. The web app also logs
changes it applies from a preview (`server/src/site-files.js`), so the entry
format and the two limits live in both places. `edit-md.js` imports `knowledge.js`
optionally, because the web app installs `edit-md.js` into older copies on its
own.

## Frontmatter reference

Shared by every type: `title`, `description`, `slug`, `url`, `layout`, `order`,
`draft`, `noindex`, `navHidden`, `image`, `kicker`, `heroHeading`, `heroText`,
`faqTopics`, `showFaq`, `ctaHeading`, `ctaText`, `hideCta`.

- **products** — `tagline`, `badge`, `price`, `logo`, `installUrl`,
  `highlights[]`, `facts[{label,value,note}]`, `capabilities[{title,body}]`
- **services** — `tagline`, `highlights[]`, `deliverables[]`, `idealFor[]`,
  `steps[{title,body}]`
- **blog** — `date`, `category`, `author`, `tags[]`, `relatedProduct`, `excerpt`,
  `generated`
- **case-studies** — `tagline`, `category`, `client`, `industry`, `duration`,
  `stack[]`, `externalUrl`, `results[{value,label}]`

## CSS

Utilities in templates; `styles/main.css` only for tokens, patterns repeated in
three or more templates, and markdown output. Brand tokens only — no stock
Tailwind colours. Full rules in `TAILWIND-GUIDELINES.md`.

## Style

British spelling. Sentence case headings. Plain verbs. No exclamation marks, no
"unlock", "seamless", "game-changing" or "dive in". Claims about Salesforce
behaviour should be ones an admin could verify in an org.
