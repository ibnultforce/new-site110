# Everything you need — TwinStack site

One file covering what exists, what you have to supply, how to run it, and how
it scales to 100+ pages. Read sections 1–3 before touching anything else.

---

## 1. What has been built

A static site generator with one dependency: Tailwind CSS v4, used only at
build time. Node 18+ and a single `npm install` are the requirements — no
framework, no bundler, no runtime JavaScript beyond 40 lines for the mobile
menu. Content is markdown, layout is HTML, styling is Tailwind utilities, and
everything else is derived at build time.

Styling rules live in **`TAILWIND-GUIDELINES.md`** and should be read before
anyone writes a class name.

**24 pages ship today**, all generated from 24 markdown files:

| Section | Pages |
| --- | --- |
| Home | 1 |
| Products | index + Who Sees What, Smart Lookup Data Loader, Google Form Auto Sync |
| Services | index + AppExchange product development, Security Review, Data migration, Integrations, Implementation & support |
| Blog | index + 3 posts |
| Case studies | index + RARO, AgVantage |
| Company | About, Contact, FAQ, Privacy, Terms, 404 |

Also generated on every build: `sitemap.xml`, `rss.xml`, `robots.txt`,
`search-index.json`, `_redirects`, `CNAME`, and JSON-LD structured data
(Organization, WebPage, BlogPosting, SoftwareApplication, Service, FAQPage,
BreadcrumbList) tuned per page type.

**What is centralised.** Change once, applies everywhere:

| Thing | Single source |
| --- | --- |
| Company name, URL, tagline, theme colour | `site.config.json` |
| Email, WhatsApp, booking link, reply time | `site.config.json` → `contact` |
| Navbar, dropdowns, footer columns, legal links, header/footer colours and layout | `content/data/navigation.json` (`appearance` for the look) |
| Headline stats, clouds, integrations, process | `content/data/company.json` |
| FAQ (filtered per page by topic) | `content/data/faq.json` |
| Testimonials | `content/data/testimonials.json` |
| Old-URL redirects | `content/data/redirects.json` |
| Colours, fonts, type scale | `styles/main.css` → `@theme` |
| Buttons, cards, badges, markdown styling | `styles/main.css` → `@layer components` |
| Meta tags, Open Graph, favicon, fonts | `templates/partials/base.html` |

Product and service menus in the navbar and footer are **generated from the
content itself**. Add `content/products/new-app.md` and it appears in the navbar
dropdown, the footer, the products index, the homepage grid, the "our other
apps" block on every other product page, the sitemap and the search index — with
no other file edited.

---

## 2. What you need to supply

Work through this list. Items marked **required** block go-live.

### Accounts and credentials

| # | Item | Where it goes | Notes |
| --- | --- | --- | --- |
| 1 | **Anthropic API key** (required for scheduled/AI-assisted content) | GitHub repo secret named `ANTHROPIC_API_KEY`, and `.env` locally | Create at console.anthropic.com. Used by `npm run scaffold:schedule`, `npm run page:edit` and `npm run page:generate`. |
| 2 | **GitHub repository** (required) | Push this folder to it | Private or public both work. |
| 3 | **Hosting** (required) | GitHub Pages workflow is included; Cloudflare Pages and Netlify instructions in §6 | |
| 4 | **DNS control for twinstack.net** (required) | See §6 | You are moving an existing live site, so plan the cutover. |
| 5 | Analytics account | Add the snippet to `templates/partials/base.html` | Plausible or Fathom keep the site cookie-free, which matches the privacy page as written. |
| 6 | Form endpoint | `templates/layouts/contact.html` | Currently email/WhatsApp/booking links only — no form. Add Formspree, Basin or a Salesforce Web-to-Lead endpoint if you want a form. |

### Content and assets you should replace

| # | Item | Current state |
| --- | --- | --- |
| 7 | Logo | Placeholder SVG at `assets/img/twinstack-mark.svg`. Drop in your real mark, same filename. |
| 8 | Open Graph image | Placeholder SVG at `assets/img/og-default.svg`. Replace with a 1200×630 PNG and update `site.config.json` → `brand.defaultOgImage`. |
| 9 | Product screenshots | None included. Add to `assets/img/products/` and reference in product frontmatter. |
| 10 | Stats in `company.json` | **I estimated these.** "150+ projects", "8 years", "100% Security Review pass rate" — correct them before launch. |
| 11 | Case study numbers | The `results` blocks are placeholders. Replace with real figures or delete the block. |
| 12 | Team detail on About | Written from your public site. Expand or correct. |
| 13 | Privacy and Terms | Drafted as sensible defaults. **Have someone check them against your actual data handling.** |
| 14 | Email address | I used `info@twinstack.net`, read from your site's obfuscated link. Confirm it. |

### Decisions I made that you may want to change

- **British spelling** throughout, matching the tone of your product pages.
- **Free 30-minute call** as the primary call to action on every page, with email
  and WhatsApp secondary.
- **Five services**, inferred from your homepage sections. Rename or merge freely.
- Case study PDFs still point at the Salesforce partner file downloads you use today.

---

## 3. First run — about 30 minutes

```bash
# 1. Install the build dependency (Tailwind) and preview locally.
cd twinstack-site
npm install
node scripts/build.js
npm run dev                 # http://localhost:4321

# 2. Fix the facts flagged in §2 (stats, email, logo, legal pages).

# 3. Validate.
npm run check               # fails on broken links or duplicate URLs

# 4. Push.
git init && git add . && git commit -m "TwinStack site"
git remote add origin git@github.com:YOUR-ORG/twinstack-site.git
git push -u origin main

# 5. In GitHub: Settings → Pages → Source: GitHub Actions.
#    Settings → Secrets and variables → Actions → New secret:
#       ANTHROPIC_API_KEY = sk-ant-... (only needed for scaffold:schedule / page:edit / page:generate)
```

Then point DNS (§6) once you are happy with the preview deployment.

---

## 4. Running the site day to day

### Add content

```bash
npm run new product "Field Audit Trail Viewer"
npm run new service "Agentforce enablement"
npm run new page    "Partners"
npm run new post    "Why sandbox refreshes break integrations"
npm run new case    "Northwind — nonprofit CRM rebuild"
```

Each command creates a file with the right frontmatter and prints the URL it
will live at. Fill in the fields, run `npm run dev`, commit. Navigation,
listings, related-content blocks, sitemap, RSS and search index update
themselves.

Add `--draft` to keep it out of production builds while you work on it. Drafts
and future-dated posts are visible in `npm run dev` and excluded from
`npm run build`.

### Change something site-wide

| You want to | Edit |
| --- | --- |
| Change the phone number or email | `site.config.json` → `contact` |
| Add a navbar item | `content/data/navigation.json` → `header.items` |
| Reorder the footer | `content/data/navigation.json` → `footer` |
| Update the stats strip | `content/data/company.json` → `stats` |
| Add an FAQ everywhere it is relevant | `content/data/faq.json`, give it a `topic` |
| Change brand colours or fonts | `styles/main.css` → `@theme` |
| Change how all product pages look | `templates/layouts/product.html` |
| Change the CTA band on every page | `templates/partials/cta.html` |
| Add a tracking script | `templates/partials/base.html` |

### Redirect an old URL

Add to `content/data/redirects.json`:

```json
{ "from": "/old-page.html", "to": "/new-page.html", "status": 301 }
```

Written to `dist/_redirects` on build (Netlify and Cloudflare Pages read this
natively; see §6 for GitHub Pages).

### Content that repeats across pages

Markdown bodies are run through the template engine before being converted, so
inside any content file you can write:

```markdown
Email us at {{ site.contact.email }} or read the [migration process](/services/data-migration.html).

{{> stats }}
{{> testimonials }}
```

That is how you avoid the same paragraph drifting out of sync across ten pages.

---

## 5. Architecture

### Build pipeline

```
site.config.json ─┐
content/data/*.json ─┤
content/**/*.md ─────┼──► load ──► for each entry:
templates/ ──────────┘                 render body as template
                                        └► markdown to HTML
                                           └► into its layout
                                              └► into base shell
                                                 └► dist/<url>/index.html
                                       then: Tailwind compiles styles/main.css
                                             against the rendered templates,
                                             sitemap, RSS, robots, search
                                             index, redirects, asset copy
```

Roughly 1,500 lines of JavaScript across eight files. 24 pages plus CSS build in
about 700 ms; 200 pages will still build in a few seconds. CSS is compiled after
templates render because Tailwind reads class names out of them.

### The scripts

| File | Role |
| --- | --- |
| `scripts/build.js` | The build. Renders everything, writes feeds and the search index. |
| `scripts/dev.js` | Preview server on :4321, rebuilds on change, serves clean URLs. |
| `scripts/check.js` | Broken internal links, duplicate URLs, missing alt text, SEO problems (from `lib/seo.js`). Exits non-zero on errors. |
| `scripts/seo.js` | SEO for every page: audit with search-result previews, set fields by hand, or have Claude write them (`npm run seo`). |
| `scripts/new.js` | Scaffolds content with the correct frontmatter. |
| `scripts/lib/template.js` | The template engine: `{{ }}`, `{{{ }}}`, `{{#if}}`, `{{#each}}`, `{{> partial}}`. |
| `scripts/lib/markdown.js` | Markdown and frontmatter parsing. |
| `scripts/lib/content.js` | Collection loading, URL rules, navigation expansion. |
| `scripts/lib/schema.js` | JSON-LD per page type. |
| `scripts/lib/seo.js` | Each page's title, description, canonical, robots and social tags, and the SEO audit. |
| `scripts/lib/css.js` | Runs the Tailwind CLI as part of the build. |

### Template syntax

```
{{ value }}                     escaped
{{{ value }}}                   raw HTML
{{# if x }} … {{ else }} … {{/ if }}
{{# unless x }} … {{/ unless }}
{{# each list }} {{ this }} {{ @padded }} {{ @index }} {{ @first }} {{/ each }}
{{> partial-name }}             templates/partials/partial-name.html
{{> [value] }}                  include the partial NAMED by the looked-up value
```

Names resolve up the whole context stack, so a partial always reaches `site`,
`nav`, `page` and every collection. The dynamic form is how the homepage
picks its sections: `content/data/home.json` lists `{ "partial": "...", ... }`
entries and `templates/layouts/home.html` does
`{{# each data.home.sections }}{{> [partial] }}{{/ each }}` — reorder, remove
or add a homepage section by editing that JSON file, no template edit needed.

### Adding a new content type

Say you want `events`:

1. `site.config.json` → `collections`:
   ```json
   "events": {
     "dir": "content/events",
     "urlPattern": "/events/:slug.html",
     "layout": "event",
     "sort": "date:desc",
     "index": { "label": "Events", "url": "/events.html" }
   }
   ```
2. Create `templates/layouts/event.html` and a list layout if you want an index.
   Build it from existing utilities and the components listed in
   `TAILWIND-GUIDELINES.md` §5.
3. Create `content/events/` and add markdown files.
4. Optionally add to `navigation.json`:
   ```json
   { "label": "Events", "url": "/events.html", "type": "collection", "collection": "events", "limit": 5 }
   ```

No changes to build code. That is the extension point the whole design is built
around.

---

## 6. Deployment

### GitHub Pages (workflow included)

`.github/workflows/deploy.yml` builds, validates and deploys on every push to
the repository's default branch (`master` here). In repo settings, set Pages →
Source → GitHub Actions (the Twinstack web app does this for copies it
duplicates). Without a custom domain the site is published at
`https://<owner>.github.io/<repo>/`, and the workflow builds every link under
that path. Once a custom domain is set in Pages settings, the same workflow
builds for the domain instead, and writes the `CNAME` file from
`site.config.json` → `deploy.cname` when the two match.

DNS for the apex domain:

```
A     twinstack.net    185.199.108.153
A     twinstack.net    185.199.109.153
A     twinstack.net    185.199.110.153
A     twinstack.net    185.199.111.153
CNAME www              YOUR-ORG.github.io
```

Verify current GitHub Pages IPs in their docs before changing DNS. GitHub Pages
does not read `_redirects`, so old-URL redirects need either the Cloudflare
option below or small HTML redirect stubs.

### Cloudflare Pages (recommended given you already use Cloudflare)

Build command `npm ci && node scripts/build.js`, output directory `dist`. `_redirects` works natively, and you keep the email obfuscation and
caching you have today. Delete `deploy.yml` if you go this route, or leave it
for preview builds.

### Netlify

Same settings — build command `npm ci && node scripts/build.js`, publish
directory `dist`. `_redirects` works natively.

### Cutover from the current site

`content/data/redirects.json` already maps `/tsblog.html` → `/blog/`,
`/tscs.html` → `/case-studies/` and the old data-loader URL. Before switching
DNS:

1. Crawl the current site and list every indexed URL.
2. Add a redirect for any not covered.
3. Deploy to a preview URL and run `npm run check`.
4. Switch DNS, then resubmit `sitemap.xml` in Search Console.

The pages currently at `/saiful-islam.html` and the product pages under
`/products/` are the ones most likely to have inbound links. `/products/who-sees-what/`
and `/products/google-form-auto-sync/` keep their existing paths;
`/products/smart-lookup-dataloader` is redirected to the corrected spelling.

---

## 7. Scaling to 100+ pages

Nothing structural changes. What follows is what you will want to add as volume
grows, in the order you will want it.

**Already handled at any size**

- Navigation stays correct automatically, because it is generated from content.
- Internal links are validated on every build, so a rename cannot silently break
  200 pages.
- `search-index.json` is written on every build and already contains every page.
- Build time scales linearly and stays in seconds.

**Add at roughly 30 pages**

- **Blog pagination.** `list-blog.html` currently renders every post. Add a
  page-size to the collection config and emit `/blog/page/2/`.
- **Tag and category pages.** Tags are parsed already. Generate a page per tag
  from the existing data, at `/blog/tag/:tag/`.

**Add at roughly 60 pages**

- **Search UI.** The index already exists. A small client-side fuzzy search over
  `search-index.json` is about 60 lines.
- **Per-collection nav limits.** `navigation.json` accepts `limit` per
  collection; use a "View all" child once dropdowns get long.

**Add at roughly 100 pages**

- **Content ownership metadata.** Add `owner` and `reviewBy` to frontmatter and
  have `check.js` warn on pages past their review date. Stale content is the
  real cost of a large site, not build time.
- **Incremental builds.** Only if build time becomes annoying, which it will not
  before several hundred pages.

**Keep doing**

- One fact, one home. The moment a number appears in two markdown files, move it
  to `content/data/` and reference it.
- Every new page type gets a layout, not a copy of an existing page.
- `npm run check` in CI, always. It is the thing that keeps a large site honest.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `layout "x" not found` | Frontmatter names a layout with no file in `templates/layouts/`. |
| A page does not appear | `draft: true`, or a future `date`. Both are hidden in production builds; use `npm run dev` to see them. |
| Page missing from the navbar | Only `navigation.json` and collection menus feed the navbar. Add it there, or set `navHidden: false` if you set it true. |
| `{{ something }}` visible on the page | Typo in a variable name, or literal braces in content. Names resolve up the context stack; check spelling against the frontmatter. |
| Broken link reported by `check.js` | Internal links need a trailing slash: `/services/data-migration/`, not `/services/data-migration`. |
| `Tailwind CLI not found` | `npm install` has not been run in this checkout. CI runs `npm ci`. |
| A new class does nothing | The CSS was built before the template change, or the file is outside the scanned sources in `styles/main.css`. Rebuild. |
| A style disappears after deploy | It was added by hand to `assets/css/main.css`, which is generated. Put it in `styles/main.css`. |
| `scaffold:schedule`, `page:edit` or `page:generate` fails with 401 | `ANTHROPIC_API_KEY` is missing or expired. |

---

## 9. Open questions for you

1. Are the stats in `content/data/company.json` accurate?
2. Do you want a contact form, or are email, WhatsApp and the booking link enough?
3. Should Saiful's profile page (`/saiful-islam.html` today) become a content
   type, a page, or a section of About?
4. GitHub Pages or Cloudflare Pages? It affects how redirects are handled.
