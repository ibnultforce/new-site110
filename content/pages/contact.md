---
title: Contact
description: How to get in touch, and what happens after you do.
metaTitle: Contact Harbour Street Bakery | My Website
metaDescription: "Contact Harbour Street Bakery: how to get in touch, what to include in your message and what happens next once you send it."
focusKeyword: contact Harbour Street Bakery
slug: contact
order: 30
---

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap">

<div class="bg-[#fbf4e6] text-[#3b2a20]">

  <section class="relative overflow-hidden">
    <div class="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-[#f0c987]/40 blur-3xl" aria-hidden="true"></div>
    <div class="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full bg-[#c8643b]/15 blur-3xl" aria-hidden="true"></div>

    <div class="relative mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
      <div class="max-w-3xl">
        <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[#a8482a]">Harbour Street Bakery</p>
        <h1 class="mt-4 font-['Fraunces',Georgia,serif] text-[clamp(2.75rem,8vw,5rem)] font-semibold leading-[1.05] tracking-tight text-[#2b1c14]">{{ page.title }}</h1>
        <p class="mt-6 max-w-2xl text-lg leading-relaxed text-[#5a4638]">Have a question, want to plan a celebration cake or simply want to say hello? We would be glad to hear from you.</p>
      </div>
    </div>
  </section>

  <section aria-labelledby="contact-options">
    <div class="mx-auto max-w-7xl px-5 pb-16 sm:px-8 md:pb-24">
      <div class="max-w-2xl">
        <h2 id="contact-options" class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl">Get in touch</h2>
        <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">Choose the easiest way to reach us.</p>
      </div>

      <div class="mt-10 grid gap-5 md:grid-cols-2">
        <a href="tel:{{ site.contact.phone }}" class="group flex min-h-48 flex-col justify-between rounded-3xl bg-white/75 p-7 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a8482a] sm:p-8">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>
            </svg>
          </div>
          <div class="mt-8">
            <p class="font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14] transition group-hover:text-[#a8482a]">Phone</p>
            <p class="mt-2 text-lg text-[#5a4638] underline decoration-[#d9a441]/70 decoration-2 underline-offset-4">{{ site.contact.phone }}</p>
          </div>
        </a>

        <a href="mailto:{{ site.contact.email }}" class="group flex min-h-48 flex-col justify-between rounded-3xl bg-white/75 p-7 shadow-sm ring-1 ring-[#e6d5b8] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#a8482a]/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a8482a] sm:p-8">
          <div class="flex size-14 items-center justify-center rounded-2xl bg-[#f6dfb0] text-[#8f3b21]">
            <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="5.5" width="18" height="13" rx="2"/>
              <path d="m3.8 7 8.2 5.6L20.2 7"/>
            </svg>
          </div>
          <div class="mt-8">
            <p class="font-['Fraunces',Georgia,serif] text-2xl font-semibold text-[#2b1c14] transition group-hover:text-[#a8482a]">Email</p>
            <p class="mt-2 wrap-break-word text-lg text-[#5a4638] underline decoration-[#d9a441]/70 decoration-2 underline-offset-4">{{ site.contact.email }}</p>
          </div>
        </a>
      </div>
    </div>
  </section>

  <section class="bg-[#f3e6cc]" aria-labelledby="cake-orders">
    <div class="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 md:grid-cols-[0.75fr_1.25fr] md:items-center md:gap-16 md:py-24">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.18em] text-[#a8482a]">For special occasions</p>
        <h2 id="cake-orders" class="mt-3 font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl">Cake orders are welcome</h2>
      </div>
      <div class="max-w-2xl text-lg leading-relaxed text-[#4a382c]">
        <p>Tell us what you are celebrating and we will talk it through with you. Share as much or as little detail as you have, and we can discuss the cake that would suit your occasion.</p>
      </div>
    </div>
  </section>

</div>
