# Work log

Written automatically: one line per change Claude made to this site that was kept, oldest first. Claude reads this before every request so new work stays consistent with earlier work. Older lines move to knowledge/archive/. Standing decisions belong in knowledge/notes.md, not here.
- 2026-10-02 · page:convert · content/pages/not-found-test.md · converted 404.html into the page, keeping its styles
  - Replaced body content with HTML copied from 404.html, including its inline styling.
  - Saved the page's 14 CSS rules to `assets/css/imported/not-found-test.css` and linked it via the `stylesheet` field.
  - Updated `title` to "Page Not Found" and rewrote `description` to match the 404 page's message.
  - Removed `kicker`, `heroHeading`, and `heroText` fields; added `hideCta: true`.
