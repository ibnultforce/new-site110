# Site tree

Defines the full page tree for `scripts/scaffold-tree.js`. Indentation shows hierarchy for readability only — the path on each line is what's authoritative. Anything after " — " is the instruction passed to Claude when filling in body content; a line with no instruction is scaffolded from its filename and position in the tree instead.

If `scripts/site-tree-content/<path>.md` exists for a path (same path, `.html` swapped for `.md` — e.g. `scripts/site-tree-content/about.md` for the `about.html` line below; none ship with the template), that file is written verbatim instead of the generic skeleton, and any " — " instruction on that line is ignored. Everything else scaffolds as before.

A line whose path ends in `.css` (e.g. `- css/style.css`) declares a global stylesheet: the CSS the design's pages share. Scaffolding creates it as `styles/global/<path>` (from `scripts/site-tree-content/<path>` verbatim if that exists). Every page converted with `--keep-styles` that links a global stylesheet (by file name) gets it, in the place its `<link href="…style.css">` had, so you don't upload it with each page. A page that doesn't link it, such as one from another design, doesn't get it. Uploading a file with the same name during a conversion replaces the stored one.

A path without an extension (`- thank-you`) is the page `thank-you.html`, a path listed twice is scaffolded once, and a folder heading (`- css/`) is ignored. Header and footer links to pages that aren't in the site are left out when the site is built; change them in `content/data/navigation.json`.

- index.html
- about.html
- contact.html
- privacy.html
- terms.html
- 404.html
- blog/index.html
