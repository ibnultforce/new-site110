# Agent instructions

This is a dependency-light static site generator, the template for a new site: Markdown
content and JSON data are rendered through logic-light HTML templates into
`dist/`. There is no framework or bundler. Use Node 18+.

## Start here

- Read [CLAUDE.md](CLAUDE.md) for the repository rules and frontmatter reference.
- Read [README.md](README.md) for the project map and build pipeline.
- Read [TAILWIND-GUIDELINES.md](TAILWIND-GUIDELINES.md) before changing CSS or
  adding Tailwind classes.
- Read [knowledge/notes.md](knowledge/notes.md) and `knowledge/work-log.md`
  (if present) before changing content: the owner's standing notes and what
  earlier Claude runs changed.

## Working rules

- Keep repeated facts in `site.config.json` or `content/data/`; collections
  drive navigation, listings, feeds and search automatically.
- Add or change site content in `content/`, page structure in
  `templates/`, source styling in `styles/main.css`, and behaviour in
  `assets/js/`.
- Never edit generated `dist/` or `assets/css/main.css`.
- Preserve the existing British spelling, sentence-case headings, plain tone
  and evidence-based claims. Do not invent facts or statistics.
- Prefer the existing template, partial and Tailwind token patterns over new
  abstractions or stock Tailwind colours.

## Validation

```bash
npm install       # first setup only
npm run check     # build, compile CSS and check links/URLs
npm run dev       # local preview at http://localhost:4321
```

Run `npm run check` before finishing changes. Use `npm run new <type> "Title"`
to scaffold content instead of hand-listing collection entries.