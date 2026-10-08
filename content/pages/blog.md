---
title: Blog
slug: blog
url: /blog.html
layout: page
order: 50
description: Under 160 characters, written for search results.
---

<section class="relative overflow-hidden">
  <div class="mx-auto max-w-7xl px-5 py-20 sm:px-8 md:py-28">
    <h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl md:text-6xl">{{ page.title }}</h1>
    <p class="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-600">One sentence on what this page is for.</p>
    <div class="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {{# each blog }}
      <a href="{{ url }}" class="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg">
        {{# if dateFormatted }}<p class="text-sm text-zinc-500">{{ dateFormatted }}</p>{{/ if }}
        <h2 class="mt-1 text-lg font-semibold text-zinc-950">{{ title }}</h2>
        {{# if description }}<p class="mt-2 text-zinc-600">{{ description }}</p>{{/ if }}
        <span class="mt-auto pt-5 text-sm font-medium text-brand">Read more <span aria-hidden="true" class="inline-block transition group-hover:translate-x-0.5">→</span></span>
      </a>
      {{/ each }}
    </div>
  </div>
</section>
