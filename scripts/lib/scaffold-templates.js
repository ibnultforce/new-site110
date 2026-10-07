/**
 * Frontmatter + body skeletons for each collection type. Shared by
 * scripts/new.js (one page at a time) and scripts/scaffold-tree.js (a whole
 * tree at once) so both produce identical, correctly-shaped starting files.
 *
 * Every layout shows only the page's body (templates/layouts/page.html), so
 * each body is a small responsive starting page that Claude (or the author)
 * replaces with the page's own design. There is no design system: these use
 * stock Tailwind utilities, and the Twinstack web app's pageSkeleton
 * (server/src/site-files.js) copies the same HTML. The heading reads {{ page.title }}, so a
 * title with "&" or "<" stays valid HTML. Keep the HTML blocks free of blank
 * lines inside them, as the markdown renderer's raw blocks expect.
 */

const intro = (lines) => `<section class="relative overflow-hidden">
  <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8 md:py-28">
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
    '<h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl md:text-6xl">{{ page.title }}</h1>',
    '<p class="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600">One sentence on what this page is for.</p>',
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

<article class="px-5 py-16 sm:px-8 md:py-24">
  <div class="mx-auto max-w-3xl">
    <p class="text-sm text-zinc-500">{{ page.dateFormatted }}{{# if page.author }} · {{ page.author }}{{/ if }}</p>
    <h1 class="mt-3 text-4xl font-semibold tracking-tight text-balance text-zinc-950 md:text-5xl">{{ page.title }}</h1>
    <div class="prose prose-lg prose-zinc mt-10 max-w-none prose-headings:tracking-tight prose-a:text-brand">
      <p>Opening paragraph: the specific situation the reader is in.</p>
    </div>
  </div>
</article>
`,

    listing: () =>
      page('order: 50\n') +
      intro([
        ...heading,
        '<div class="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">',
        `  {{# each ${collection} }}`,
        '  <a href="{{ url }}" class="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg">',
        '    {{# if dateFormatted }}<p class="text-sm text-zinc-500">{{ dateFormatted }}</p>{{/ if }}',
        '    <h2 class="mt-1 text-lg font-semibold text-zinc-950">{{ title }}</h2>',
        '    {{# if description }}<p class="mt-2 text-zinc-600">{{ description }}</p>{{/ if }}',
        '    <span class="mt-auto pt-5 text-sm font-medium text-brand">Read more <span aria-hidden="true" class="inline-block transition group-hover:translate-x-0.5">→</span></span>',
        '  </a>',
        '  {{/ each }}',
        '</div>',
      ]),
  };

  return TEMPLATES[type]?.();
}
