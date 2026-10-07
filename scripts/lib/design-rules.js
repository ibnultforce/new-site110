/**
 * The design brief every Claude request that writes a page or template gets
 * (edit-page.js in every mode, scaffold-schedule.js). One place, so they never
 * drift apart. There is no design system: Claude designs each page, and
 * styleReference() shows it a page the site already has so the site stays one
 * design. The Twinstack web app's "Ask Claude" assistant states the same
 * responsive rule in its own prompt (server/src/assistant/prompt.js).
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './content.js';
import { parseFrontmatter } from './markdown.js';

/** Always sent: what Claude may use, what good looks like, and how it must behave on every screen. */
export const DESIGN_RULES = `DESIGN — you are the designer
There is no design system to follow. Design this page the way an excellent web designer would: modern, polished and clearly made for this business, never a generic template.

What you can use
- Tailwind CSS v4 utilities, any of them: the stock palette (zinc, stone, neutral, slate, emerald…), arbitrary values (bg-[#0c2b25], text-[clamp(2.5rem,6vw,4.75rem)], grid-cols-[1.2fr_0.8fr]), gradients (bg-linear-to-br, bg-radial, from-*/via-*/to-*), shadows and coloured shadows, rings, blur and backdrop filters, transforms, transitions and animations. Tailwind only sees class names written out in full in the HTML, so never assemble one from pieces.
- The site defines two things you may use: its font (font-sans, already the default) and its accent colour "brand" (bg-brand, text-brand, from-brand, border-brand/20…). The header and footer use them, so using them keeps the page in step.
- CSS that utilities can't express (keyframes, masks, a custom scroll effect): one <style> block at the start of the body, every selector scoped under a class unique to this page (e.g. .p-pricing …).
- Interaction (tabs, an accordion, a carousel, counters, entrance on scroll): one small <script> at the end of the body, plain JavaScript, no libraries. The page must read completely without it: never hide content in CSS unless the script itself has added the class that hides it.
- A display font for headings, if the design needs one: a Google Fonts <link rel="stylesheet"> at the start of the body, used with font-[…]. One extra family at most.

What good looks like
- Clear hierarchy and generous whitespace. One idea per section, with a confident heading size scale.
- Varied section layouts: split, asymmetric grids, bento grids, full-bleed bands, a stats strip, steps on a timeline, a quote. Don't repeat one layout down the page.
- Depth: layered surfaces, soft shadows, fine borders and rings, subtle gradients or glows behind key areas, a dark band where it gives contrast.
- Visual interest without photos: inline SVG icons (one consistent stroke style), CSS shapes and patterns, decorative gradients, small interface-like cards built from HTML. Use only images you're given or the site already has (with alt text); never link to stock photos.
- Subtle motion: every link, button and card has a hover and focus state (colour, shadow, a 1–2px lift); entrance animations are short and use motion-safe: so people who ask for less motion get none.
- Avoid the generic AI look: a centred hero with two buttons and nothing else; three identical icon cards repeated section after section; numbered "01 / 02 / 03" labels; a pill badge above every heading; gradient text on every heading; purple-to-blue gradients; emoji as icons; cream or beige page backgrounds; italic serif accent words in headlines; invented logos, ratings, testimonials or statistics.

Every screen size
- Mobile first: the page must read and work at 360px wide with no horizontal scrolling, then adapt from sm:, md: and lg: up.
- Each section has an inner container with a side gutter, e.g. "mx-auto max-w-7xl px-5 sm:px-8" (narrower, such as max-w-3xl, for reading text).
- Columns stack on small screens and only split from md: or lg: up, e.g. "grid gap-6 md:grid-cols-2 lg:grid-cols-3". Never a fixed multi-column grid without a breakpoint.
- No fixed pixel widths or heights for boxes: use w-full, max-w-*, aspect-* and let text wrap. Images get "h-auto max-w-full" (or w-full object-cover inside an aspect box), with width and height attributes where known.
- A table goes inside <div class="overflow-x-auto">; long words and URLs get "wrap-break-word".
- Things people tap are comfortably large on phones (at least 44px high); body text stays at least 16px.
- Accessible: text meets WCAG AA contrast on its background, headings go in order, every image has alt text, and focus stays visible.`;

/** True when a layout draws the page's title itself, so the body must not repeat it. */
export function layoutShowsTitle(layoutSource) {
  return /\bpage\.(title|heroHeading)\b/.test(layoutSource || '');
}

/** For a layout that shows only page.content: the body is the whole page, written as HTML. */
export const BLANK_LAYOUT_RULES = `THE BODY IS THE WHOLE PAGE
- This page's layout shows only its body, between the site's header and footer: no title, hero, call to action or FAQ is added around it. Design the page in the body.
- The header and footer are the same on every page and are added around the body automatically: never draw a header, logo bar, menu or footer in the body.
- Start with the page's one <h1> (normally the title), then its sections. Write the body as HTML: one <section> per band of the page, each with its own inner container.
- Markdown isn't converted inside HTML, so inside a section use HTML elements (h2, p, ul, a, img, table), not markdown. Long reading text (an article, a policy) goes inside <div class="prose prose-zinc max-w-none">…</div>, which styles plain HTML elements for reading; adjust it with prose-* modifiers (prose-lg, prose-a:text-brand, prose-headings:tracking-tight).
- Lists that the site keeps (blog posts, products, services, case studies) come from looping the collection with {{# each … }}, never from typing entries by hand. A post shows its own date with {{ page.dateFormatted }}.`;

const REFERENCE_CHARS = 14000;
// Placeholder lines of the starting bodies (scaffold-templates.js, nav-scaffold.js, site-tree-content/):
// a page that still has one hasn't been designed yet, so it's no reference.
const STARTER_TEXT = /One sentence on (what|how)|Replace this with|Opening paragraph: the specific situation/;

/**
 * A page the site already has, for Claude to match its look: the homepage, or
 * when that's the file being written (or missing), the most recently changed
 * other page with designed HTML in its body. '' when there's none yet.
 */
export function styleReference(relFile = '') {
  const pages = contentFiles().filter((file) => file !== relFile);
  const designed = pages
    .map((file) => ({ file, body: bodyOf(file) }))
    .filter(({ body }) => /<section\b[^>]*class=/.test(body) && !STARTER_TEXT.test(body));
  if (!designed.length) return '';
  const home = designed.find(({ file }) => file === 'content/pages/home.md');
  const { file, body } = home || designed.sort((a, b) => mtime(b.file) - mtime(a.file))[0];
  const shown = body.length > REFERENCE_CHARS ? `${body.slice(0, REFERENCE_CHARS)}\n[… the rest of the page is left out …]` : body;
  return `THE SITE'S LOOK
This is the body of ${file}, a page the site already has. Match its look on this page so the site reads as one design: the same fonts, colours and accent, corner radius, button and card style, spacing and section rhythm. Don't copy its content or its exact layout. If the request asks for a new look or a redesign, follow the request instead.
----- ${file} -----
${shown}
----- end ${file} -----`;
}

function contentFiles(dir = 'content') {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (rel !== 'content/data') out.push(...contentFiles(rel));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

function bodyOf(file) {
  try {
    return parseFrontmatter(fs.readFileSync(path.join(ROOT, file), 'utf8')).body.trim();
  } catch {
    return '';
  }
}

function mtime(file) {
  try {
    return fs.statSync(path.join(ROOT, file)).mtimeMs;
  } catch {
    return 0;
  }
}
