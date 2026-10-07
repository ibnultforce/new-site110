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

<section class="section-y">
  <div class="wrap">
    <h1 class="text-hero">{{ page.title }}</h1>
    <p class="mt-5 max-w-[54ch] text-lede text-ink-2">Replace this with the real content. Add more files to this folder to add more ${slugify(name)}.</p>
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

<section class="section-y">
  <div class="wrap">
    <h1 class="text-hero">{{ page.title }}</h1>
    <p class="mt-5 max-w-[54ch] text-lede text-ink-2">One sentence on what this section is for.</p>
    <div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {{# each ${name} }}
      <a href="{{ url }}" class="card block no-underline">
        <h2 class="text-h3 text-ink">{{ title }}</h2>
        {{# if description }}<p class="mt-2 text-muted">{{ description }}</p>{{/ if }}
      </a>
      {{/ each }}
    </div>
  </div>
</section>
`;
}
