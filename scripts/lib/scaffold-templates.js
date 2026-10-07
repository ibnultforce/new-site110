/**
 * Frontmatter + body skeletons for each collection type. Shared by
 * scripts/new.js (one page at a time) and scripts/scaffold-tree.js (a whole
 * tree at once) so both produce identical, correctly-shaped starting files.
 *
 * Every layout shows only the page's body (templates/layouts/page.html), so
 * each body is a small responsive starting page in the site's design that
 * Claude (or the author) replaces. The heading reads {{ page.title }}, so a
 * title with "&" or "<" stays valid HTML. Keep the HTML blocks free of blank
 * lines inside them, as the markdown renderer's raw blocks expect.
 */

const intro = (lines) => `<section class="section-y">
  <div class="wrap">
${lines.map((line) => `    ${line}`).join('\n')}
  </div>
</section>
`;

/** type is one of: pages, products, services, blog, caseStudies, listing (a collection's listing page; pass `collection`) */
export function scaffoldBody(type, { title, today, draft = false, defaultAuthor = '', collection = '' }) {
  const draftLine = draft ? 'draft: true\n' : '';
  const page = (fields) => `---
title: ${title}
${fields}description: Under 160 characters, written for search results.
${draftLine}---

`;
  const heading = [
    '<h1 class="text-hero">{{ page.title }}</h1>',
    '<p class="mt-5 max-w-[54ch] text-lede text-ink-2">One sentence on what this page is for.</p>',
  ];

  const TEMPLATES = {
    pages: () => page('order: 50\n') + intro(heading),

    products: () => page('order: 50\n') + intro(heading),

    services: () => page('order: 50\n') + intro(heading),

    caseStudies: () => page('order: 50\n') + intro(heading),

    blog: () => `---
title: ${title}
date: ${today}
category:
author: ${defaultAuthor}
tags: []
relatedProduct:
description: Under 160 characters, written for search results.
excerpt: One or two sentences that make someone open the post.
${draftLine}---

<article class="section-y">
  <div class="wrap-narrow">
    <p class="text-sm text-muted">{{ page.dateFormatted }}{{# if page.author }} · {{ page.author }}{{/ if }}</p>
    <h1 class="mt-2 text-hero">{{ page.title }}</h1>
    <div class="prose-site mt-8">
      <p>Opening paragraph: the specific situation the reader is in.</p>
    </div>
  </div>
</article>
`,

    listing: () =>
      page('order: 50\n') +
      intro([
        ...heading,
        '<div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">',
        `  {{# each ${collection} }}`,
        '  <a href="{{ url }}" class="card block no-underline">',
        '    {{# if dateFormatted }}<p class="text-sm text-muted">{{ dateFormatted }}</p>{{/ if }}',
        '    <h2 class="text-h3 text-ink">{{ title }}</h2>',
        '    {{# if description }}<p class="mt-2 text-muted">{{ description }}</p>{{/ if }}',
        '  </a>',
        '  {{/ each }}',
        '</div>',
      ]),
  };

  return TEMPLATES[type]?.();
}
