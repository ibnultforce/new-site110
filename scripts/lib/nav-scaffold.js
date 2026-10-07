/**
 * Pure template builders for the collection scaffold that `nav:add` creates
 * for a brand-new nav item (sample entry, listing page). Every page uses the
 * shared blank layout (templates/layouts/page.html), so no layout is created. Shared with `nav:remove`, which reconstructs the same strings to
 * check whether a generated file has been hand-edited before deleting it.
 */

export function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function singularize(name) {
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y');
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.replace(/s$/i, '');
  return name;
}

export function sampleEntryTemplate(name, label) {
  return `---
title: Sample ${singularize(label)}
order: 50
description: Under 160 characters, written for search results.
---

<section class="relative overflow-hidden">
  <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8 md:py-28">
    <h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl md:text-6xl">{{ page.title }}</h1>
    <p class="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600">Replace this with the real content. Add more files to this folder to add more ${slugify(name)}.</p>
  </div>
</section>
`;
}

export function indexPageTemplate(label, slug, name) {
  return `---
title: ${label}
slug: ${slug}
order: 50
description: Under 160 characters, written for search results.
---

<section class="relative overflow-hidden">
  <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8 md:py-28">
    <h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl md:text-6xl">{{ page.title }}</h1>
    <p class="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600">One sentence on what this section is for.</p>
    <div class="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {{# each ${name} }}
      <a href="{{ url }}" class="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg">
        <h2 class="text-lg font-semibold text-zinc-950">{{ title }}</h2>
        {{# if description }}<p class="mt-2 text-zinc-600">{{ description }}</p>{{/ if }}
        <span class="mt-auto pt-5 text-sm font-medium text-brand">Read more <span aria-hidden="true" class="inline-block transition group-hover:translate-x-0.5">→</span></span>
      </a>
      {{/ each }}
    </div>
  </div>
</section>
`;
}
