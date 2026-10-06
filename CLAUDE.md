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
npm run page:edit -- <page> --from-html=<file.html> [--css=<file.css>]  # bring an HTML page in as it is, with its own CSS
npm run page:edit:preview -- <page> --from-html=<file.html>         # same, print only, write nothing
npm run page:edit -- <page> --from-html=<file.html> --markdown ["<direction>"]  # Claude rewrites it as markdown in the site's design
npm run md:edit -- <file.md> "<instruction>"       # edit a markdown file outside content/ with Claude
npm run md:edit:preview -- <file.md> "<instruction>" # same, print only, write nothing
npm run md:edit:list                               # list the markdown files md:edit can change
npm run seo                                        # SEO audit of every page: score, issues (add --preview for search results)
npm run seo -- <page>                              # one page, shown as a Google result
npm run seo -- <page> --title="…" --description="…" --keyword="…"  # set a page's SEO fields by hand
npm run seo:claude -- <page> ["<direction>"]       # Claude writes the title, description and keyphrase
npm run seo:claude:preview -- <page>               # same, print only, write nothing
npm run seo:claude -- --all ["<direction>"]        # every page without its own SEO title or description (--force: all)
npm run seo:report                                 # seo-report.html (gitignored): every page as a search result
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
   JSON-LD from `lib/schema.js` and `page.seo` (the title, description,
   canonical, robots and social tags, from `lib/seo.js`).
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
   files that don't exist; it warns on SEO problems (the errors and warnings
   of `lib/seo.js`'s audit), missing `alt` text and thin body content.

Navigation never links to a page the site doesn't have. `loadSite` drops header,
footer and legal links (and the header button) whose internal URL isn't a page,
a generated file or a file in `assets/`/`static/` (`pageExists`); a dropdown
whose own page is missing keeps its children as an unlinked button. The build
prints what it left out (`nav.missing`), so a site tree that replaces the
template's pages (no `/contact.html`, `/products.html`…) still passes
`npm run check`. Templates link to such pages only through `pageUrls` (the
contact page and each collection's listing page, null when missing), and a
breadcrumb parent whose listing page is missing is left out.

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
| Logo, icon, favicon, name | `site.config.json` → `brand`: `logo` (the full logo, in place of the icon and name in the header), `logoDark` (the dark footer's; empty uses `logo`), `logoMark` (the square icon beside `logoText` when there's no logo), `favicon` (empty uses `logoMark`). Empty means not set. The web app uploads them to `assets/img/brand/` |
| Nav or footer structure | `content/data/navigation.json` |
| Header and footer look | `content/data/navigation.json` → `appearance`: `header` `theme` (`light`/`dark`/`brand`), `layout` (`right`/`center`/`left`: where the menu sits), `sticky`; `footer` `theme` (`dark`/`light`/`brand`), `showTagline`, `showContact`, `copyright` (after `© <year>`; empty = site name, "All rights reserved."). `navAppearance` in `lib/content.js` checks and defaults them into `nav.appearance` (on `nav`, not `data`, because `scaffold-schedule.js` renders the partials with only `site` and `nav`), adding `tone` and the `logo` for that background. `header.html`/`footer.html` put `theme`/`tone`/`layout` in data attributes and style them with `group-data-[…]/header` variants, since templates can't compare values. The Twinstack web app detects support by `nav.appearance` in both partials and `navAppearance` in `content.js` |
| Headline stats | `content/data/company.json` |
| FAQ entries | `content/data/faq.json` |
| Homepage sections — which appear, in what order, their copy | `content/data/home.json` (each entry names a `partial` from `templates/partials/`; add a new partial and reference it here to add a new kind of section, no layout edit needed) |
| Colours, type scale, fonts | `styles/main.css` → `@theme` |
| A repeated visual pattern | `styles/main.css` → `@layer components` (read the guidelines first) |
| Page shell, meta tags, schema | `templates/partials/base.html` (renders `page.seo`), `scripts/lib/seo.js`, `scripts/lib/schema.js` |
| Title format, X handle, search console verification | `site.config.json` → `seo` (see "Search engine optimisation" below) |
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

A content page whose layout reads shared data (`pageSources`: `data.<name>` in
its layout and the partials it includes, by name or through a data file's
`"partial"` fields) is edited together with that data. The homepage is the
main case: its layout shows the hero from `home.md`'s frontmatter and the
sections listed in `content/data/home.json`, never `home.md`'s body. Claude
then gets the page, those `content/data/*.json` files and the templates for
reference, and returns each file it changes in a `===== FILE: <path> =====`
block (`buildPageEditPrompts`, `readPageEditReply`). A data file must stay
valid JSON and a section may only name a partial that exists; the changed data
files go in the proposal's `"files"` and are written with the page. The
`section-content` partial shows the page's body as a section, which is how
free-form content gets onto the homepage: list
`{ "partial": "section-content", "heading": … }` in `home.json` where it
should appear.

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
replaces the page with it. By default the page keeps its own HTML and CSS (the
`--keep-styles` behaviour described below, which is still accepted as a
flag); queue entries do the same unless they say `"markdown": true`. With
`--markdown` its content is converted to markdown instead, as this section
describes first. The target must
already exist under `content/`, because it decides where the page lives. The
replacement is complete: before Claude sees the page, `replacedPage` cuts its
frontmatter down to `REPLACE_KEEPS` (the locked fields plus `title`,
`description`, `noindex`, `navHidden`, `author`, `category`, `tags`,
`focusKeyword`, `canonical`) and drops
its body, so the old hero, highlights, FAQ topics, call to action and copy
can't carry over. The old description always goes, and the old title goes
when the HTML has a `<title>` or `<h1>`. A meta description of at most 160
characters is put in as the description by code; `replacementProblems`
refuses a reply that changes it or has no title, and Claude retries. In
markdown the title comes from the `<h1>`; with `--keep-styles` from the
`<title>` without the old site's name, because the page shows its own heading.
Claude fills other layout fields only from the HTML. The dropped fields are
listed as a warning. Replies are read with `fileFromReply`, which takes the
file from its frontmatter on, because a review reply sometimes starts with a
checklist.
`scripts/lib/html-source.js` cleans the HTML before Claude sees it. It
removes scripts, styles, comments and embedded `data:` images. When `<main>`
holds most of the text, it removes everything outside `<main>`. It also
removes the old site's header, footer, navigation, sidebars and cookie banners,
which it finds by tag (`header`, `footer`, `nav`, `aside`), by role (`banner`,
`contentinfo`, `navigation`, `complementary`) and by class or id
(`site-header`, `footer`, `navbar`…). A `<header>` or `<footer>` inside `<main>`
or `<article>` is the content's own (an article's title or date) and stays. A
`<nav>` counts as the old site's only above the page's `<h1>` or below its last
heading. Between the headings (a section bar, a table of contents) it's the
page's own and stays. Breadcrumbs always go. Claude is told to leave out any chrome that is
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

A conversion is checked and corrected, never trusted on Claude's first reply
(`reviewConversion`, up to `MAX_ATTEMPTS` = 3 requests). After each reply the
script runs the checks above plus `missingContent`. That check lists every
heading, paragraph, list item, table cell, quote and caption of the HTML (not
the `<h1>`, which becomes the title) whose first eight words aren't in the
file. The second request always happens: Claude gets its conversion back with
the issues found, or with a request to review it against the HTML line by
line. A third request happens only if issues remain. The attempt with the
fewest problems, then the least missing content, is kept, with later attempts
winning ties. Missing content in the kept version becomes warnings, and the
proposal's `"checks"` lists each attempt's result.
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
styles, SVG, `data-*`, event handlers, `javascript:` links, `<template>`,
`<canvas>` and `<noscript>` (only `srcset`/`sizes` and integrity attributes go).
Each class is prefixed `imp-`, so the site's components and
Tailwind utilities (Tailwind scans `content/`) never match imported markup.
The body is written as one raw HTML block inside `<div class="imported-page">`,
with no blank lines (the markdown renderer ends a raw block at one) and with
`{{`/`}}` escaped as entities.

`scripts/lib/css-scope.js` builds the page's stylesheet. Its inputs are the
`<style>` blocks and the uploaded files, in the page's own cascade order: an
upload whose file name matches a `<link href>` takes that link's place, and
the rest come first. A `media` attribute wraps its sheet in `@media`, so a
print stylesheet stays print-only. Linked stylesheets from web-font services
(Google Fonts, Bunny, Typekit, Fontshare) go into the page's `fonts`
frontmatter list, which `base.html` loads in `<head>` the way the original did,
so text never shows in fallback fonts first. Every selector is put under
`.imported-page`, and class names get the same prefix. Rules for classes or
ids that no longer exist in the body are dropped, which removes the old header
and footer CSS and unused framework rules. Classes inside `:not()`, `:is()`,
`:where()` and `:has()` don't count for that.

Other pages' CSS is handled too:
- `html`/`body`/`:root` rules become the wrapper's, keeping pseudo-elements
  (`body::before` is the wrapper's `::before`).
- The old `<html>` and `<body>` classes and ids go onto the wrapper, so
  `body.home .x`, `.home .x` and `#page .x` still apply.
- `*` and `*::before` also match the wrapper, through `:where()` so they keep
  zero specificity, as they matched `<body>`.
- `[class^="col-"]`-style attribute selectors get the prefix.
- `@keyframes` names get the prefix (and `animation` values follow), so they
  can't clash with the site's `pulse` or `spin`.
- `@layer` names get the prefix, with an order statement at the top.
- CSS nesting has its class names prefixed.
- When the page set its root font size (`html { font-size: 62.5% }`), its rem
  values in CSS and inline styles are rescaled. Sizes relative to the parent on
  root rules become px, because the wrapper's parent is the site's page.
- `inherit` in a `body` rule takes what the page's `html` rules set
  (`htmlDeclarations`), or the initial value: both are the wrapper, so it
  would otherwise inherit the site's page (Tailwind's preflight sets
  `html { line-height: 1.5 }` then `body { line-height: inherit }`).
- `overflow: hidden` on the root becomes `clip`. On a real page it belongs to
  the viewport, but on the wrapper it would make a scroll container and break
  `position: sticky`.

Two zero-specificity rules isolate the page from the site:
`:where(.imported-page) { all: initial; display: block; margin: 8px }` makes
the wrapper start like a fresh `<body>`, with the browser's default margin
rather than the site body's size, and
`:where(.imported-page *:not(svg, svg *)) { all: revert }` rolls the site's
preflight and base layer (heading colours, `text-wrap: balance`, img display)
back to browser defaults. SVG is left out because its geometry (`r`, `cx`,
`d`, `width`) comes from attributes that count as styling, which `revert`
would wipe; `<svg>` itself only reverts `display`, `vertical-align` and
`box-sizing`. SVG definitions the kept content uses but that lived outside it
(an icon sprite of `<symbol>`s for `<use href="#i-arrow">`, a gradient for
`fill="url(#g)"`) are copied into a hidden `<svg>` at the end of the body
(`svgDefinitions` in `html-source.js`). Matching rules do the same for `::before`/`::after` (the reset
would make them border-box and resize them), `::marker`, `::placeholder` and
`::selection`.

`revert` also removes the styling browsers give old HTML attributes (and the 1px padding a `<table>` gives its cells even without `cellpadding`). So
`presentationalHints` in `html-source.js` turns those attributes into
zero-specificity rules placed after the isolation: `<font color face size>`,
`bgcolor`, `background`, `align`, `valign`, `width`/`height` (with the image's
aspect ratio), `nowrap`, table `border`, `cellpadding` and `cellspacing`, and
the old `<body>`'s `bgcolor`/`text`. They rank like browsers rank attribute
styling: above defaults, below every real rule. When the imported CSS uses
layers, the isolation and these rules go in `imp-reset` and `imp-attributes`
layers ordered before the page's own. Every imported rule still wins over all
of these.

Scroll-reveal effects are kept when the CSS shows the common pattern
(`detectReveal` in `css-scope.js`). In that pattern, `.R .T { opacity: 0 }`
hides elements until a script puts `R` (usually `js`) on `<html>`, and
`.R .T.S` shows them once the script adds `S`. Those rules are kept with `R`
moved onto the wrapper (`.imported-page.imp-js .imp-rv`), and the wrapper gets
`data-reveal`, `data-reveal-root` and `data-reveal-state`. When the page's own
script uses the usual forms, the wrapper also gets `data-reveal-margin` and
`data-reveal-threshold` (from an IntersectionObserver) and
`data-reveal-stagger` (from a `(i % n) * ms` transition delay).
`assets/js/site.js` plays the effect back, and only it adds the root class, so
without JavaScript nothing is ever hidden; when the page's own script is kept
it does the same, harmlessly. The result goes to
`assets/css/imported/<page>.css` (refused over 600 KB).

**The page's scripts are kept** (`keptScripts` in `edit-page.js`, from
`scriptsIn` in `html-source.js`), in document order and place: ones in
`<head>` stay in `<head>`, the rest go at the end of the body, before
`DOMContentLoaded` as they ran. Inline scripts are saved as
`assets/js/imported/<page>/inline-<n>.js`; ones from a URL load from it; ones
from the old site's own files come from `--js=<file.js>` uploads (matched by
file name like `--css`, saved to the same folder) or the repo, and a missing one
is a warning. JSON-LD and non-JavaScript script types are left out. The page's
frontmatter lists them as `scripts:` (`src`, `head`, `module`, `nomodule`,
`defer`, `async`, all always written, because template lookup walks the
context stack), and `base.html` loads `assets/js/imported-page.js` before them
with `scriptHtmlClass`, `scriptBodyClass` and `scriptRemoved`. That runtime
makes the copy look like the original to its scripts:
- each element gets its original class names back next to the `imp-` ones, and
  a class a script adds or removes later (or an element it inserts, or a
  `<template>` it clones) is mirrored to its `imp-` twin by a MutationObserver;
- the old `<html>`/`<body>` classes go on the site's `<html>`/`<body>`, and what
  scripts change there is mirrored onto the wrapper (where the CSS has them);
- `getElementById`/`querySelector` for an id or class that left with the old
  header, footer or navigation return a detached stand-in rather than null, so
  a script that set up the old menu first doesn't stop with an error.

With scripts kept, `scopeCss` gets `scripted`: rules for classes and ids that
aren't in the markup stay (a script may add `is-open` or a library
`aos-animate` later), bar the removed parts' (`dropClasses`/`dropIds`). A
leading class that's on no element (`.js .reveal`) is matched both on the
wrapper and on an element inside. **Pass 5** (`scriptCheck` in
`render-check.js`) loads the original and the copy with their scripts running,
scrolls through each, and warns about errors (uncaught exceptions,
`console.error`) the copy raises that the original doesn't. Known limit: a
script that finds the old header by tag (`header`, `nav`) rather than id or
class gets nothing, or the site's own header. `site.js` skips imported pages'
elements (an imported `group` class isn't the site menu).

Claude writes only the frontmatter, from a text version of the page. It's
checked after each reply, and Claude gets up to `MAX_ATTEMPTS` (3) tries to
fix problems such as a changed locked field. The script adds
`stylesheet: /assets/css/imported/<page>.css`, `fonts` and `hideCta: true`,
because the page brings its own call to action.

Then the copy is tested before it's shown or written (`testStyledPage`):
- **Pass 1** pushes the body through the site's own template engine and
  markdown renderer. It must come out unchanged, and with all of the
  original's text. A failure is a problem, which blocks the write.
- **Passes 2–4** are `scripts/lib/render-check.js`, which renders the original
  and the copy side by side in headless Chrome at 1280, 768 and 390px.
  - The original side is the old page minus what's removed on purpose, with
    no scripts, the uploads standing in for its links, and a viewport tag.
  - The copy side is the site's compiled `assets/css/main.css` with the page's
    fonts and stylesheet, and the rendered body inside `<main>`.
  - It compares every element's box and computed style, every
    `::before`/`::after`, and the forced `:hover` state of each class the CSS
    gives one.
  - Differences become warnings: the first five per width, and a count.

The browser comes from `CHROME_PATH`, the usual install locations or PATH. It
needs Node 22+ for the built-in WebSocket. Without either, those passes are
skipped and say why. `--no-render-check` skips them on purpose. The results
are printed and saved as the proposal's `"checks"`.
`templates/partials/base.html` loads `page.stylesheet` after `main.css`. A
page whose `stylesheet` is under `/assets/css/imported/` renders through
`templates/layouts/imported.html` whatever its `layout` (`scripts/build.js`):
its HTML edge to edge between the site's header and footer, with no hero,
`.prose-site`, FAQ, call to action or related items, and no FAQ schema. Claude
only writes `title` and `description`; the frontmatter is limited to
`REPLACE_KEEPS` after every reply, so no old content field survives.

**Global stylesheets.** A `.css` line in `scripts/site-tree.md`
(`- css/style.css`) declares CSS the design's pages share. Scaffolding creates
it as `styles/global/<path>` (from `scripts/site-tree-content/<path>` if that
exists, otherwise a starter comment); `globalStylesheets()` in
`lib/scaffold-tree-runner.js` lists them. Every `--keep-styles` conversion
applies the declared globals the page links, without an upload
(`globalSheets`/`standIns` in `edit-page.js`): each one a `<link>` points at
(same file name, path suffix preferred) takes that link's place in the
cascade. A global the page doesn't link isn't applied (with a warning): the
page may come from another design, and its reset or root font size would
change it. Uploads still win: a `--css` upload with a global's file
name is used for the page and saved over `styles/global/<path>` (it's in the
proposal's `"files"`), with a warning that pages converted earlier keep the
old version until they're converted again. Global CSS is scoped and pruned
into each page's own stylesheet like the rest, so it never reaches the site's
own pages, header or footer. Tailwind doesn't scan `styles/global/`.

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

**Search engine optimisation**

Every page's SEO is optional flat frontmatter (the parser has no nested maps):
`metaTitle` (the whole `<title>`, used as-is), `metaDescription`,
`focusKeyword` (the search phrase it's for; only the audit reads it),
`ogImage`, `ogImageAlt`, `canonical` (absolute, or root-relative) and
`noindex`. Without them a page gets the site's defaults:
`site.config.json` → `seo` → `titleTemplate` (`{title} | {site}`; also
`{name}` and `{tagline}`) or `homeTitle` for `/`, its `description` (or
the start of its body, `descriptionAuto` from `lib/content.js`), and its
`image` or `brand.defaultOgImage`. `seo` also holds `twitterHandle`,
`googleVerification` and `bingVerification`, and every key is optional.

`scripts/lib/seo.js` is the one place these rules live. `pageSeo()` gives
`build.js` the `page.seo` that `base.html` renders (title, description,
canonical, robots, Open Graph, Twitter, `article:published_time`), and a page
whose canonical points elsewhere is left out of the sitemap. `auditPages()`
scores every page out of 100 from its issues (`error` −25, `warning` −10,
`tip` −3, `note` 0): a missing or placeholder description, a title over
600px or description over 920px (measured with an Arial width table at 20px
and 13px, as search result previews do), duplicates, a keyphrase missing from
the title, description, heading or introduction, a social image that doesn't
exist or is an SVG, a bad canonical, images without alt text, thin pages.
`check.js` prints its errors and warnings. `setFrontmatterFields()` writes
fields in place, adding new ones after `description` and keeping line
endings; an empty value removes the field.

`scripts/seo.js` is the command line for all of it (usage in its header).
`--claude` sends Claude the page, the other pages' titles and descriptions,
and the knowledge files, asks for JSON (`metaTitle`, `metaDescription`,
`focusKeyword`), measures the reply like the audit does and asks for
corrections up to 3 times, keeping the best attempt. A page's own keyphrase is
kept unless a direction is given. Claude never sets the image, canonical or
noindex. A written change is logged as `seo:claude` with the new values as its
summary points (no extra request). `--all` reloads the site after each page,
so later pages don't repeat earlier ones. `--report=<file>` saves the audit as
JSON after any change and `--dry-run --proposal-out=<file>` saves a one-page
proposal (`"mode": "seo"`, the whole file in `content`, the fields in
`seo`): the Twinstack web app's SEO tab reads both, so keep their shapes in
step with its `server/src/seo.js`, and its `client/src/lib/seo.ts` copies the
width table and limits.

**Scaffold the whole page tree, or schedule pages for later**

`scripts/site-tree.md` is an indented bullet list of every page path the site
should have, each optionally followed by `— instruction` text for Claude to
write the body from. `npm run scaffold` walks it and creates whatever markdown
files are missing (`--force` to also overwrite existing ones, `--file=` to use
a different tree file); `npm run scaffold:preview` prints the plan without
writing. A line whose path ends in `.css` declares a global stylesheet and is
scaffolded to `styles/global/<path>` (see "Global stylesheets" above). A page
path may contain spaces (`about 2.html` becomes `about-2`), a path without an
extension is a page (`thank-you` is `thank-you.html`), a duplicate is
skipped, and a folder heading (`css/`) is ignored. Stylesheet paths may only
use letters, digits, `_`, `-`, `.` and `/`. The scaffold prints a note for each
line it skipped or read differently.

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
- `knowledge/work-log.md`: one entry per change Claude wrote, appended
  automatically after the write. The entry is a line,
  `- <date> · <command> · <file> · <instruction>`, followed by up to 5
  indented `  - ` points (each at most 200 characters) saying what the change
  actually did. Entries from before summaries are just the line.
  - **The points:** `summarizeChange` in `knowledge.js` makes them with one
    small extra Claude request (400 tokens at most). It sends the request that
    was made and the part of the file that changed: lines shared at the start
    and end are left out, and each side is capped at 9,000 characters.
  - **Conversions that kept the old page's styles** send the frontmatter
    change and the conversion's facts instead of the copied HTML.
  - **Failure:** with no key, or if the request fails, the entry is just the
    line, and the change never fails because of it.
  - **Previews:** a preview with `--proposal-out` (the web app's preview) also
    makes the summary and saves it as the proposal's `"summary"`, because the
    web app logs the change on apply without calling Claude.
  - **Rotation:** once the log passes 60 entries, all but the newest 30 move,
    whole, to `knowledge/archive/work-log-<date>.md`, which is never sent.
  - **Nothing logged:** other previews (`--dry-run`) and edits to
    `knowledge/` itself.

Claude is told the notes are instructions and the log is history: the current
files win over the log, and the log is never a source of facts.

The committed log only holds the checked-out branch's lines, so the Twinstack
web app also keeps each site's log in its database, where a change counts as
soon as it's made, not when its pull request merges. Before every Claude run it
writes the latest log to a file in `.git/` and sets `TWINSTACK_WORK_LOG` to
that path. `knowledge.js` then reads the prompt's log from that file and adds
new entries to it as well as to `knowledge/work-log.md`. The web app also logs
changes it applies from a preview (`server/src/site-files.js`), so the entry
format (the line, the indented summary points and their limits) and the two
rotation limits live in both places. `edit-md.js` imports `knowledge.js`
optionally, because the web app installs `edit-md.js` into older copies on its
own.

## Frontmatter reference

Shared by every type: `title`, `description`, `slug`, `url`, `layout`, `order`,
`draft`, `noindex`, `navHidden`, `image`, `kicker`, `heroHeading`, `heroText`,
`faqTopics`, `showFaq`, `ctaHeading`, `ctaText`, `hideCta`, and the SEO fields
`metaTitle`, `metaDescription`, `focusKeyword`, `ogImage`, `ogImageAlt`, `canonical`.

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
