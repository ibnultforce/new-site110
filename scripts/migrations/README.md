# Migrations

A site update replaces the template's own files (see `twinstack-update.json`) but never the site's
content. When a template change needs the site's files in a new shape (a new field in
`content/data/navigation.json`, a renamed frontmatter key, a moved file), add a migration here so
existing sites get that change too.

- One file per change: `NNNN-short-name.js` (`0001-nav-cta.js`). They run in name order.
- `export const description = '...'` says what it does, in a few words.
- `export default async function migrate(root)` changes files under `root` (the site's folder) and
  returns `false` when there was nothing to change.
- Write it to be safe to run on any site: check the old shape is there before changing it, keep
  every value the owner set, and leave anything it doesn't recognise alone.
- Run `npm run migrate` here too, so the template (and every site copied from it from now on)
  records the migration as done in `site.config.json` → `updates.migrations`.

The web app runs `node scripts/migrate.js` after merging an update, then builds and checks the site.
If a migration throws, the update stops and the site stays as it was.
