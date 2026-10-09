---
title: Revenue
order: 50
description: A demo overview of revenue areas at Harbour Street Bakery, with placeholder figures to be replaced.
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">

<div class="bg-[#fbf4e6] text-[#3b2a20]">

  <!-- Hero -->
  <section class="relative overflow-hidden">
    <div class="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-[#f0c987]/40 blur-3xl" aria-hidden="true"></div>
    <div class="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-[#c8643b]/15 blur-3xl" aria-hidden="true"></div>
    <div class="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
      <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[#a8482a]">Harbour Street Bakery</p>
      <h1 class="mt-4 max-w-3xl font-['Fraunces',Georgia,serif] text-[clamp(2.5rem,7vw,4.5rem)] font-semibold leading-[1.05] tracking-tight text-balance text-[#2b1c14]">{{ page.title }}</h1>
      <p class="mt-6 max-w-2xl text-lg leading-relaxed text-[#5a4638]">This is a demo page. It shows how an overview of our revenue areas could look, with placeholders where the real figures will go.</p>
      <a href="#overview" class="mt-8 inline-flex min-h-12 items-center justify-center gap-2 px-2 py-3 text-base font-semibold text-[#2b1c14] underline decoration-[#d9a441] decoration-2 underline-offset-8 transition hover:text-[#a8482a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a]">See the overview
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
      </a>
    </div>
  </section>

  <!-- Overview cards -->
  <section id="overview" class="scroll-mt-8">
    <div class="mx-auto max-w-7xl px-5 pb-16 sm:px-8 md:pb-24">
      <div class="max-w-2xl">
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl md:text-5xl">Revenue areas</h2>
        <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">The three parts of the bakery that bring in income.</p>
      </div>

      <div class="mt-12 grid gap-6 md:grid-cols-3">
        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13c0-4 4-7 9-7s9 3 9 7v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M5 16v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/><path d="M8 10l2 2M12 9l2 2M15 10l1.5 1.5"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Bread</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Sourdough loaves baked daily.</p>
          <dl class="mt-6 space-y-3 border-t border-[#eadcc3] pt-5">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Revenue</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add amount]</dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Share of total</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add share]</dd>
            </div>
          </dl>
        </article>

        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16c0-5 3-9 8-9s8 4 8 9"/><path d="M4 16c2 2 5 3 8 3s6-1 8-3"/><path d="M9 8.5c-.5 3-.5 6 0 10M15 8.5c.5 3 .5 6 0 10"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Pastries</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Sweet bakes and coffee in the café.</p>
          <dl class="mt-6 space-y-3 border-t border-[#eadcc3] pt-5">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Revenue</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add amount]</dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Share of total</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add share]</dd>
            </div>
          </dl>
        </article>

        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><rect x="5" y="13" width="14" height="7" rx="1.5"/><rect x="7.5" y="8" width="9" height="5" rx="1.5"/><path d="M12 3v2.5"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Cakes to order</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Celebration cakes made for your day.</p>
          <dl class="mt-6 space-y-3 border-t border-[#eadcc3] pt-5">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Revenue</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add amount]</dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-sm font-semibold text-[#2b1c14]">Share of total</dt>
              <dd class="text-right text-[#6b5444] wrap-break-word">[Add share]</dd>
            </div>
          </dl>
        </article>
      </div>
    </div>
  </section>

  <!-- Placeholder note -->
  <section class="bg-[#f3e6cc]">
    <div class="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-8 md:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
      <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl">A note on the figures</h2>
      <div class="space-y-5 text-lg leading-relaxed text-[#4a382c]">
        <p>Every figure on this page is a placeholder. Nothing here is real, and nothing should be read as a statement of how the bakery is doing.</p>
        <p class="inline-block rounded-xl border border-dashed border-[#a8482a]/60 bg-white/60 px-4 py-2 text-base font-medium text-[#8f3b21]">[Add reporting period]</p>
      </div>
    </div>
  </section>

  <!-- Closing call to action -->
  <section class="px-5 py-16 sm:px-8 md:py-24">
    <div class="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#3b2418] px-6 py-14 text-center sm:px-12 md:py-20">
      <div class="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-[#c8643b]/40 blur-3xl" aria-hidden="true"></div>
      <div class="pointer-events-none absolute -bottom-20 -left-12 size-72 rounded-full bg-[#d9a441]/25 blur-3xl" aria-hidden="true"></div>
      <div class="relative mx-auto max-w-2xl">
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-balance text-[#fbf4e6] sm:text-4xl">Questions about this page?</h2>
        <p class="mt-5 text-lg leading-relaxed text-[#ecdcc2]">Get in touch and we will help you replace the placeholders with real figures.</p>
        <a href="/contact.html" class="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-[#f0c987] px-8 py-3 text-base font-semibold text-[#2b1c14] shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-[#f7d899] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c987]">Get in touch</a>
      </div>
    </div>
  </section>

</div>
