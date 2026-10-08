/**
 * The header and footer, designed by Claude (edit-page.js --chrome). They are
 * the two partials base.html puts around every page, so one design shows on
 * every page of the site. Claude designs them as a pair, in the look of the
 * site's pages (styleReference), but everything in them comes from the site's
 * data: the menu, button, footer columns and legal links from
 * content/data/navigation.json, the logo and name from site.config.json →
 * brand, and the copyright line from navigation.json → appearance. So the
 * Twinstack web app's Design screen still edits what they show, while their
 * look is Claude's. Both carry data-designed="claude", which tells the web app
 * to hide the header and footer style switches (theme, layout, sticky).
 *
 * The partials are also rendered with only `site` and `nav` in scope
 * (scaffold-schedule.js puts them on standalone pages), so they can't use
 * `page` or anything else.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSite } from './content.js';
import { TemplateEngine } from './template.js';

export const HEADER_FILE = 'templates/partials/header.html';
export const FOOTER_FILE = 'templates/partials/footer.html';
export const DESIGNED_MARK = 'data-designed="claude"';
// On a header or footer copied from a converted page as it was (edit-page.js --with-header /
// --with-footer): fixed HTML, so neither the menu data nor the style switches change it.
export const COPIED_MARK = 'data-designed="copied"';

/** The data the partials render, and the parts they must keep, for the system prompt. */
export const CHROME_RULES = `WHAT THE HEADER AND FOOTER SHOW
Only \`site\` and \`nav\` are in scope (no \`page\`). Never hard-code a menu link, page name, contact detail or the company name: everything comes from this data.
- nav.header.items: the menu. Each item has label, url (empty for a menu heading that only opens its children), ariaCurrent (an attribute to output raw with {{{ ariaCurrent }}} on the current page's link), hasChildren, and children (each with label, url and an optional description).
- nav.header.cta: the header's button ({ label, url }), or empty when there is none.
- nav.footer: the footer's columns, each with title and links (label, url, external).
- nav.legal: the legal links (label, url).
- nav.appearance.header.logoOnLight / logoOnDark and nav.appearance.footer.logoOnLight / logoOnDark: the uploaded logo for a light or a dark background, empty when there is none. Use the one for the background you design.
- nav.appearance.footer.showTagline, showContact (whether the owner wants those shown) and copyright (their own copyright text, may be empty).
- site.brand.logoText (the name shown beside the icon), site.brand.logoMark (the square icon), site.name, site.footerTagline, site.foundedYear, site.contact.email / phone / whatsapp / whatsappUrl, site.year.

THE HEADER MUST
- Be one <header data-designed="claude" …> element (put the attribute on it exactly like that). It shows on every page, so keep it compact; sticky is your choice.
- Link the logo to "/": {{# if nav.appearance.header.logoOnLight }}<img src="{{ nav.appearance.header.logoOnLight }}" alt="{{ site.brand.logoText }}" class="…">{{ else }}<img src="{{ site.brand.logoMark }}" alt="" width="28" height="28" class="…"> {{ site.brand.logoText }}{{/ if }} (logoOnDark instead, in both places, if the header is dark).
- Show the menu from the data: {{# each nav.header.items }} … {{# if url }}<a href="{{ url }}"{{{ ariaCurrent }}} class="…">{{ label }}</a>{{ else }}<button type="button" aria-haspopup="true" class="…">{{ label }}</button>{{/ if }} … {{# if hasChildren }}<ul class="…">{{# each children }}<li><a href="{{ url }}" class="…">{{ label }}{{# if description }}<span class="…">{{ description }}</span>{{/ if }}</a></li>{{/ each }}</ul>{{/ if }} … {{/ each }}. Put each item in an <li class="group relative …"> and open its dropdown on hover and keyboard focus with CSS (lg:group-hover:…, lg:group-focus-within:…). Style the current page with aria-[current=page]: variants.
- Show the button: {{# if nav.header.cta }}<a href="{{ nav.header.cta.url }}" class="…">{{ nav.header.cta.label }}</a>{{/ if }}.
- Work on phones with the site's menu script (assets/js/site.js): a <button type="button" data-nav-toggle aria-expanded="false" aria-controls="primary-nav" aria-label="Open menu" class="… lg:hidden"> and the menu inside <nav id="primary-nav" data-open="false" aria-label="Primary" class="… max-lg:data-[open=false]:hidden">. The script flips data-open and aria-expanded and closes it on Escape. On small screens the open menu drops below the header as a full-width panel with large tap targets.

THE FOOTER MUST
- Be one <footer data-designed="claude" …> element.
- Show the logo the same way, with nav.appearance.footer.logoOnLight or logoOnDark.
- Show the tagline and contact details only when the owner wants them: {{# if nav.appearance.footer.showTagline }}{{# if site.footerTagline }}…{{ site.footerTagline }}…{{/ if }}{{/ if }} and {{# if nav.appearance.footer.showContact }}…{{# if site.contact.email }}<a href="mailto:{{ site.contact.email }}">{{ site.contact.email }}</a>{{/ if }}…{{/ if }}.
- Show every column: {{# each nav.footer }}…{{ title }}…{{# each links }}<a href="{{ url }}"{{# if external }} target="_blank" rel="noopener"{{/ if }}>{{ label }}</a>{{/ each }}…{{/ each }}.
- Show the legal links: {{# each nav.legal }}<a href="{{ url }}">{{ label }}</a>{{/ each }}.
- End with the copyright line: © {{ site.year }} {{# if nav.appearance.footer.copyright }}{{ nav.appearance.footer.copyright }}{{ else }}{{ site.name }}. All rights reserved.{{/ if }}

BOTH
- Tailwind utilities only: no <style> or <script> (they're on every page, and the menu script already exists).
- Match the look of the site's pages, and design the two as a pair that frames every page.
- Every page shows them, so pages never draw a header, menu or footer of their own.`;

/** Strings each partial must contain for the site and the web app to keep working. */
const REQUIRED = {
  [HEADER_FILE]: [
    [DESIGNED_MARK, 'the data-designed="claude" mark'],
    ['nav.header.items', 'the menu (nav.header.items)'],
    ['{{{ ariaCurrent }}}', "the current page's mark ({{{ ariaCurrent }}})"],
    ['children', 'the dropdown items (children)'],
    ['nav.header.cta', 'the button (nav.header.cta)'],
    ['data-nav-toggle', 'the phone menu button (data-nav-toggle)'],
    ['id="primary-nav"', 'the phone menu (id="primary-nav")'],
    ['data-open="false"', 'the phone menu\'s closed state (data-open="false")'],
    ['nav.appearance.header.logoOn', 'the logo (nav.appearance.header.logoOnLight or logoOnDark)'],
    ['site.brand.logoText', 'the site name (site.brand.logoText)'],
  ],
  [FOOTER_FILE]: [
    [DESIGNED_MARK, 'the data-designed="claude" mark'],
    ['nav.footer', 'the footer columns (nav.footer)'],
    ['nav.legal', 'the legal links (nav.legal)'],
    ['site.year', 'the year (site.year)'],
    ['nav.appearance.footer.copyright', 'the copyright text (nav.appearance.footer.copyright)'],
    ['nav.appearance.footer.logoOn', 'the logo (nav.appearance.footer.logoOnLight or logoOnDark)'],
  ],
};

/** What the menu and footer hold now, so the design fits them (how many items, how long the labels are). */
export function chromeData() {
  try {
    const { nav, site } = loadSite({ includeDrafts: true, includeFuture: true });
    const summary = {
      siteName: site.name,
      logoText: site.brand?.logoText,
      hasUploadedLogo: Boolean(site.brand?.logo),
      menu: nav.header.items.map((item) => ({ label: item.label, url: item.url || null, children: (item.children || []).map((c) => c.label) })),
      button: nav.header.cta || null,
      footerColumns: nav.footer.map((column) => ({ title: column.title, links: column.links.length })),
      legal: nav.legal.map((link) => link.label),
      footerTagline: site.footerTagline || null,
      contact: Object.fromEntries(Object.entries(site.contact || {}).filter(([, v]) => v)),
    };
    return JSON.stringify(summary, null, 2);
  } catch (error) {
    return `(the site couldn't be loaded: ${error.message})`;
  }
}

/** The two files from a reply of "===== FILE: <path> =====" blocks; missing ones are null. */
export function readChromeReply(text) {
  const files = { [HEADER_FILE]: null, [FOOTER_FILE]: null };
  const parts = String(text || '').split(/^=====\s*FILE:\s*(.+?)\s*=====\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const file = parts[i].trim();
    if (file in files) files[file] = stripFence(parts[i + 1].trim());
  }
  return files;
}

function stripFence(text) {
  const fenced = text.match(/^```[a-z]*\n([\s\S]*)\n```$/);
  return fenced ? fenced[1] : text;
}

/**
 * Problems that block writing the pair (a missing file, a lost piece of data,
 * template blocks that don't balance or don't render) and warnings that don't.
 */
export function chromeChecks(files, { partialNames }) {
  const problems = [];
  const warnings = [];
  for (const [file, required] of Object.entries(REQUIRED)) {
    const text = files[file];
    if (!text) {
      problems.push(`the reply has no ${file}`);
      continue;
    }
    for (const [needle, what] of required) if (!text.includes(needle)) problems.push(`${file} lost ${what}`);
    const openers = (text.match(/\{\{#\s*(if|unless|each)/g) || []).length;
    const closers = (text.match(/\{\{\/\s*(if|unless|each)/g) || []).length;
    if (openers !== closers) problems.push(`${file}: unbalanced template blocks (${openers} opened, ${closers} closed)`);
    const known = new Set(partialNames);
    for (const m of text.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)) {
      if (!known.has(m[1]) || m[1] === 'header' || m[1] === 'footer') problems.push(`${file} includes a partial it can't: {{> ${m[1]} }}`);
    }
    if (/<script\b/i.test(text)) problems.push(`${file} has a <script>: the menu script already exists (assets/js/site.js)`);
    if (/<style\b/i.test(text)) warnings.push(`${file} has a <style> block; utilities were asked for`);
    if (/\{\{\s*page\./.test(text)) problems.push(`${file} uses page.*, which isn't in scope on every page`);
  }
  if (!problems.length) {
    // Render both as the build will, with the site's real data, so a template error shows now.
    try {
      const { site, nav } = loadSite({ includeDrafts: true, includeFuture: true });
      const engine = new TemplateEngine();
      const dir = path.join(ROOT, 'templates/partials');
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
        const rel = `templates/partials/${name}`;
        engine.add(name.replace(/\.html$/, ''), files[rel] ?? fs.readFileSync(path.join(dir, name), 'utf8'));
      }
      const header = engine.render('header', { site, nav });
      engine.render('footer', { site, nav });
      if (!/<header\b/i.test(header)) problems.push(`${HEADER_FILE} doesn't render a <header> element`);
    } catch (error) {
      problems.push(`the header and footer don't render: ${error.message}`);
    }
  }
  return { problems, warnings };
}
