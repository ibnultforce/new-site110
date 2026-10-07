/**
 * Pure template builders for the collection scaffold that `nav:add` creates
 * for a brand-new nav item (item layout, list layout, sample entry, index
 * page). Shared with `nav:remove`, which reconstructs the same strings to
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

export function itemLayoutTemplate(label) {
  return `{{> breadcrumbs }}

<section class="section-y border-b border-line">
  <div class="wrap">
    <span class="mb-2 block font-display text-sm font-semibold text-brand">{{# if page.kicker }}{{ page.kicker }}{{ else }}${label}{{/ if }}</span>
    <h1 class="text-hero">{{# if page.heroHeading }}{{ page.heroHeading }}{{ else }}{{ page.title }}{{/ if }}</h1>
    {{# if page.tagline }}<p class="mt-5 max-w-[54ch] text-lede text-ink-2">{{ page.tagline }}</p>{{/ if }}
  </div>
</section>

{{# if page.highlights }}
<section class="section-y bg-mist">
  <div class="wrap">
    <ul class="grid gap-2.5 sm:grid-cols-2">
      {{# each page.highlights }}
      <li class="grid grid-cols-[1.15rem_1fr] items-start gap-2.5">
        <span aria-hidden="true" class="font-bold text-signal">✓</span>
        <span>{{ this }}</span>
      </li>
      {{/ each }}
    </ul>
  </div>
</section>
{{/ if }}

<section class="section-y border-t border-line">
  <div class="wrap">
    <div class="prose-site prose-wide">{{{ page.content }}}</div>
  </div>
</section>

{{# if faqItems }}{{> faq }}{{/ if }}
{{> cta }}
`;
}

export function listLayoutTemplate(name, label) {
  return `<section class="section-y border-b border-line">
  <div class="wrap">
    <span class="mb-2 block font-display text-sm font-semibold text-brand">{{# if page.kicker }}{{ page.kicker }}{{ else }}${label}{{/ if }}</span>
    <h1 class="text-hero">{{# if page.heroHeading }}{{ page.heroHeading }}{{ else }}{{ page.title }}{{/ if }}</h1>
    {{# if page.heroText }}<p class="mt-5 max-w-[54ch] text-lede text-ink-2">{{ page.heroText }}</p>{{/ if }}
  </div>
</section>

<section class="section-y">
  <div class="wrap">
    <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {{# each ${name} }}
      <article class="card">
        <h2 class="text-h3"><a href="{{ url }}" class="text-ink no-underline hover:text-brand">{{ title }}</a></h2>
        {{# if description }}<p class="mt-3 text-muted">{{ description }}</p>{{/ if }}
      </article>
      {{/ each }}
    </div>
    {{# if page.content }}<div class="prose-site mt-18">{{{ page.content }}}</div>{{/ if }}
  </div>
</section>

{{# if faqItems }}{{> faq }}{{/ if }}
{{> cta }}
`;
}

export function sampleEntryTemplate(name, label) {
  return `---
title: Sample ${singularize(label)}
tagline: One line on what it does, in the user's words.
order: 50
description: Under 160 characters, written for search results.
highlights:
  - First thing it does
  - Second thing it does
---

## First section

Replace this with the real content. Add more markdown files to this folder
to add more ${slugify(name)}.
`;
}

export function indexPageTemplate(label, slug, listLayoutName) {
  return `---
title: ${label}
slug: ${slug}
layout: ${listLayoutName}
order: 50
kicker: ${label}
heroHeading: ${label}
heroText: One sentence on what this section is for.
description: Under 160 characters, written for search results.
---
`;
}
