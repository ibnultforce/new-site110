/**
 * The design rules every Claude request that writes a page or template gets
 * (edit-page.js in every mode, scaffold-schedule.js). One place, so they never
 * drift apart. The Twinstack web app's "Ask Claude" assistant states the same
 * responsive rule in its own prompt (server/src/assistant/prompt.js).
 */

/** Always sent: how anything Claude designs must behave on every screen size. */
export const DESIGN_RULES = `DESIGN — everything you write must be responsive
- Mobile first: the page must read and work at 360px wide with no horizontal scrolling, then adapt from Tailwind's sm:, md: and lg: breakpoints up.
- Use the site's page gutter and spacing: "wrap" (or "wrap-narrow" for reading text) on every section's inner container, "section-y" for a section's vertical padding.
- Columns stack on small screens and only split from md: or lg: up, e.g. "grid gap-6 md:grid-cols-2 lg:grid-cols-3" or "flex flex-col gap-4 md:flex-row". Never a fixed multi-column grid without a breakpoint.
- No fixed pixel widths or heights for boxes: use w-full, max-w-*, aspect-* and let text wrap. Images get "h-auto max-w-full" (or w-full object-cover inside an aspect box), with width and height attributes where known.
- A table goes inside <div class="overflow-x-auto">; long words and URLs get "break-words".
- Buttons and links people tap are comfortably large on phones (the "btn" classes are); body text stays at least 16px.
- Use the site's tokens and components from styles/main.css (text-hero, text-h2, text-h3, text-lede; text-ink, text-ink-2, text-body, text-muted, bg-mist, text-brand, border-line; btn btn-primary, btn-ghost; card; badge; prose-site) rather than stock Tailwind colours or arbitrary sizes.`;

/** True when a layout draws the page's title itself, so the body must not repeat it. */
export function layoutShowsTitle(layoutSource) {
  return /\bpage\.(title|heroHeading)\b/.test(layoutSource || '');
}

/** For a layout that shows only page.content: the body is the whole page, written as HTML in the site's design. */
export const BLANK_LAYOUT_RULES = `THE BODY IS THE WHOLE PAGE
- This page's layout shows only its body, between the site's header and footer: no title, hero, call to action or FAQ is added around it. Design the page in the body.
- Start with the page's one <h1> (normally the title), then its sections. Write the body as HTML: one <section> per band of the page, each with an inner <div class="wrap"> (or "wrap-narrow"), styled with the site's classes.
- Markdown isn't converted inside HTML, so inside a section use HTML elements (h2, p, ul, a, img, table), not markdown. Long reading text (an article, a policy) goes inside <div class="prose-site">…</div>, which styles plain HTML elements for reading.
- Lists that the site keeps (blog posts, products, services, case studies) come from looping the collection with {{# each … }}, never from typing entries by hand. A post shows its own date with {{ page.dateFormatted }}.`;
