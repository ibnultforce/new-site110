---
title: My Website
slug: home
url: /
order: 50
description: Under 160 characters, written for search results.
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">

<div class="bg-[#fbf4e6] text-[#3b2a20]">

  <!-- Hero -->
  <section class="relative overflow-hidden">
    <div class="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-[#f0c987]/40 blur-3xl" aria-hidden="true"></div>
    <div class="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-[#c8643b]/15 blur-3xl" aria-hidden="true"></div>
    <div class="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[#a8482a]">Harbour Street Bakery</p>
        <h1 class="mt-4 max-w-2xl font-['Fraunces',Georgia,serif] text-[clamp(2.5rem,7vw,4.75rem)] font-semibold leading-[1.05] tracking-tight text-balance text-[#2b1c14]">Honest sourdough, baked by the sea</h1>
        <p class="mt-6 max-w-xl text-lg leading-relaxed text-[#5a4638]">Slow-fermented loaves, flaky pastries and cakes made with care, served from our independent bakery and café in a small coastal town.</p>
        <div class="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
          <a href="/contact.html" class="inline-flex min-h-12 items-center justify-center rounded-full bg-[#a8482a] px-7 py-3 text-base font-semibold text-white shadow-lg shadow-[#a8482a]/25 transition hover:-translate-y-0.5 hover:bg-[#8f3b21] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a]">Visit the bakery</a>
          <a href="#bakes" class="inline-flex min-h-12 items-center justify-center gap-2 px-2 py-3 text-base font-semibold text-[#2b1c14] underline decoration-[#d9a441] decoration-2 underline-offset-8 transition hover:text-[#a8482a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a]">See what we bake
            <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
          </a>
        </div>
      </div>

      <div class="mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
        <div class="relative aspect-square">
          <div class="absolute inset-0 rounded-full bg-[#f0c987]/50"></div>
          <div class="absolute inset-[9%] rounded-full border border-dashed border-[#a8482a]/40"></div>
          <svg class="absolute inset-[14%] drop-shadow-xl" viewBox="0 0 200 200" fill="none">
            <defs>
              <radialGradient id="hs-loaf" cx="40%" cy="30%" r="80%">
                <stop offset="0" stop-color="#e9b45f"/>
                <stop offset="0.6" stop-color="#c47a35"/>
                <stop offset="1" stop-color="#8f4a22"/>
              </radialGradient>
            </defs>
            <ellipse cx="100" cy="112" rx="92" ry="68" fill="url(#hs-loaf)"/>
            <path d="M52 92c14-12 28-18 40-20M82 82c14-12 28-18 40-20M112 92c14-12 28-18 40-20" stroke="#f8e3b4" stroke-width="7" stroke-linecap="round"/>
            <path d="M40 130c30 18 90 18 120 0" stroke="#8f4a22" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </div>
  </section>

  <!-- What we bake -->
  <section id="bakes" class="scroll-mt-8">
    <div class="mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
      <div class="max-w-2xl">
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl md:text-5xl">What we bake</h2>
        <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">Made by hand, in small batches, with time given to every stage.</p>
      </div>

      <div class="mt-12 grid gap-6 md:grid-cols-3">
        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13c0-4 4-7 9-7s9 3 9 7v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M5 16v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/><path d="M8 10l2 2M12 9l2 2M15 10l1.5 1.5"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Bread</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Sourdough loaves baked daily, with a crisp crust, an open crumb and the tang that only a long, slow rise can give.</p>
        </article>

        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16c0-5 3-9 8-9s8 4 8 9"/><path d="M4 16c2 2 5 3 8 3s6-1 8-3"/><path d="M9 8.5c-.5 3-.5 6 0 10M15 8.5c.5 3 .5 6 0 10"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Pastries</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Buttery, golden and best eaten warm. Something sweet for the morning, alongside a good cup of coffee in the café.</p>
        </article>

        <article class="group flex flex-col rounded-3xl bg-white/70 p-8 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><rect x="5" y="13" width="14" height="7" rx="1.5"/><rect x="7.5" y="8" width="9" height="5" rx="1.5"/><path d="M12 3v2.5"/></svg>
          </div>
          <h3 class="mt-6 font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14]">Cakes to order</h3>
          <p class="mt-3 leading-relaxed text-[#5a4638]">Celebration cakes made for your day. Tell us what you are marking and we will talk it through with you.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- Story -->
  <section id="story" class="bg-[#f3e6cc]">
    <div class="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
      <div>
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl md:text-5xl">Small team</h2>
        <p class="mt-5 inline-block rounded-xl border border-dashed border-[#a8482a]/60 bg-white/60 px-4 py-2 text-sm font-medium text-[#8f3b21]">[Add year founded]</p>
      </div>
      <div class="space-y-5 text-lg leading-relaxed text-[#4a382c]">
        <p>We are a small, independent team who care about doing things properly. Our dough is fermented slowly, because time is what gives bread its flavour, its crust and its character.</p>
        <p>We bake for the people who live here and for those who find their way to the coast. The bakery is part of the community, and we are glad to be the place where neighbours stop for a loaf, a coffee and a chat.</p>
        <p class="text-base text-[#6b5444]">[Add a line about the bakers, for example who they are and how they began]</p>
      </div>
    </div>
  </section>

  <!-- Hours and finding us -->
  <section id="visit" class="scroll-mt-8">
    <div class="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 md:py-24 lg:grid-cols-2 lg:gap-16">
      <div>
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl md:text-5xl">Opening hours and finding us</h2>
        <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">Come in for a loaf, stay for a coffee.</p>

        <dl class="mt-8 space-y-6">
          <div class="flex gap-4">
            <svg class="mt-1 size-6 shrink-0 text-[#a8482a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>
            <div>
              <dt class="font-semibold text-[#2b1c14]">Address</dt>
              <dd class="mt-1 text-[#5a4638] wrap-break-word">[Add street address, town]</dd>
            </div>
          </div>
          <div class="flex gap-4">
            <svg class="mt-1 size-6 shrink-0 text-[#a8482a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>
            <div>
              <dt class="font-semibold text-[#2b1c14]">Phone</dt>
              <dd class="mt-1 text-[#5a4638] wrap-break-word">[Add phone number]</dd>
            </div>
          </div>
        </dl>

        <a href="/contact.html" class="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-full border-2 border-[#a8482a] px-7 py-3 text-base font-semibold text-[#8f3b21] transition hover:-translate-y-0.5 hover:bg-[#a8482a] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a]">Get in touch
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </a>
      </div>

      <div class="rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-[#e6d5b8] sm:p-8">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[18rem] text-left">
            <caption class="pb-4 text-left font-['Fraunces',Georgia,serif] text-xl font-semibold text-[#2b1c14]">Opening hours</caption>
            <thead class="sr-only">
              <tr><th scope="col">Day</th><th scope="col">Hours</th></tr>
            </thead>
            <tbody class="divide-y divide-[#eadcc3]">
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Monday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Tuesday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Wednesday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Thursday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Friday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Saturday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
              <tr><th scope="row" class="py-3 pr-4 font-semibold text-[#2b1c14]">Sunday</th><td class="py-3 text-[#6b5444]">[Add opening hours]</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>

  <!-- Closing call to action -->
  <section class="px-5 pb-16 sm:px-8 md:pb-24">
    <div class="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#3b2418] px-6 py-14 text-center sm:px-12 md:py-20">
      <div class="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-[#c8643b]/40 blur-3xl" aria-hidden="true"></div>
      <div class="pointer-events-none absolute -bottom-20 -left-12 size-72 rounded-full bg-[#d9a441]/25 blur-3xl" aria-hidden="true"></div>
      <div class="relative mx-auto max-w-2xl">
        <h2 class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-balance text-[#fbf4e6] sm:text-4xl md:text-5xl">Order a celebration cake</h2>
        <p class="mt-5 text-lg leading-relaxed text-[#ecdcc2]">Birthdays, weddings or just because. Get in touch and tell us what you have in mind.</p>
        <a href="/contact.html" class="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-[#f0c987] px-8 py-3 text-base font-semibold text-[#2b1c14] shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-[#f7d899] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0c987]">Order a cake</a>
      </div>
    </div>
  </section>

</div>
