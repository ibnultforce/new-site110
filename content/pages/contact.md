---
title: Contact
description: How to get in touch, and what happens after you do.
slug: contact
order: 30
---

<section class="relative overflow-hidden">
  <div class="mx-auto grid max-w-7xl items-start gap-12 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[1.15fr_0.85fr]">
    <div>
      <h1 class="max-w-2xl text-4xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-5xl md:text-6xl">{{ page.title }}</h1>
      <p class="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600">One sentence on how you respond and what happens next.</p>
      <div class="prose prose-zinc mt-10 max-w-none prose-headings:tracking-tight prose-a:text-brand">
        <h2>What to include</h2>
        <p>Replace this with what a message should include so you can help quickly.</p>
        <h2>What happens next</h2>
        <p>Replace this with the real answer: who reads the message, how fast they reply, and what the next step is.</p>
      </div>
    </div>
    <div class="rounded-3xl border border-zinc-200 bg-zinc-50 p-6 shadow-sm sm:p-8 lg:sticky lg:top-24">
      <h2 class="text-xl font-semibold tracking-tight text-zinc-950">Reach us directly</h2>
      {{# if site.contact.email }}<p class="mt-5 wrap-break-word"><a href="mailto:{{ site.contact.email }}" class="font-medium text-brand underline-offset-4 hover:underline">{{ site.contact.email }}</a></p>{{/ if }}
      {{# if site.contact.whatsappUrl }}<p class="mt-2"><a href="{{ site.contact.whatsappUrl }}" class="font-medium text-brand underline-offset-4 hover:underline">WhatsApp {{ site.contact.whatsapp }}</a></p>{{/ if }}
      {{# if site.contact.bookingUrl }}<p class="mt-6"><a class="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-3 text-sm font-semibold text-white no-underline shadow-sm transition hover:-translate-y-px hover:bg-zinc-800" href="{{ site.contact.bookingUrl }}" target="_blank" rel="noopener">{{ site.contact.bookingLabel }}</a></p>{{/ if }}
      {{# if site.contact.responseTime }}<p class="mt-6 text-sm text-zinc-500">{{ site.contact.responseTime }}</p>{{/ if }}
    </div>
  </div>
</section>
