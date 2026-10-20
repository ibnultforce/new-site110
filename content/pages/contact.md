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

  <section id="message" class="scroll-mt-8" aria-labelledby="contact-form-heading">
    <div class="mx-auto max-w-7xl px-5 pb-16 sm:px-8 md:pb-24">
      <div class="mx-auto max-w-3xl">
        <div class="max-w-2xl">
          <h2 id="contact-form-heading" class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl">Send us a message</h2>
          <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">Tell us a little about what you have in mind and we will get back to you soon.</p>
        </div>

        <div class="mt-10 rounded-3xl bg-white/75 p-6 shadow-sm ring-1 ring-[#e6d5b8] sm:p-8 md:p-10">
          <form action="http://localhost:4000/api/forms/emHITfEppWPWTmuwtLeIbQ" method="post" accept-charset="UTF-8" class="space-y-6">
            <div>
              <label for="contact-name" class="block text-base font-semibold text-[#3b2a20]">Name</label>
              <input id="contact-name" name="name" type="text" autocomplete="name" maxlength="200" required class="mt-2 block min-h-12 w-full rounded-2xl border border-[#e6d5b8] bg-white px-4 py-3 text-base text-[#3b2a20] shadow-sm transition placeholder:text-[#8a7566] hover:border-[#d9a441] focus:border-[#a8482a] focus:outline-none focus:ring-2 focus:ring-[#a8482a]">
            </div>
            <div>
              <label for="contact-email" class="block text-base font-semibold text-[#3b2a20]">Email</label>
              <input id="contact-email" name="email" type="email" autocomplete="email" maxlength="320" required class="mt-2 block min-h-12 w-full rounded-2xl border border-[#e6d5b8] bg-white px-4 py-3 text-base text-[#3b2a20] shadow-sm transition placeholder:text-[#8a7566] hover:border-[#d9a441] focus:border-[#a8482a] focus:outline-none focus:ring-2 focus:ring-[#a8482a]">
            </div>
            <div>
              <label for="contact-message" class="block text-base font-semibold text-[#3b2a20]">Message</label>
              <textarea id="contact-message" name="message" rows="6" maxlength="5000" required class="mt-2 block min-h-40 w-full rounded-2xl border border-[#e6d5b8] bg-white px-4 py-3 text-base text-[#3b2a20] shadow-sm transition placeholder:text-[#8a7566] hover:border-[#d9a441] focus:border-[#a8482a] focus:outline-none focus:ring-2 focus:ring-[#a8482a]"></textarea>
            </div>
            <button type="submit" class="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#a8482a] px-7 py-3 text-base font-semibold text-[#fbf4e6] shadow-lg shadow-[#a8482a]/25 transition hover:-translate-y-0.5 hover:bg-[#8f3b21] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a]">
              Send message
            </button>
          </form>
        </div>
      </div>
    </div>
  </section>

  <section aria-labelledby="cake-orders" class="bg-[#f3e6cc]">
    <div class="mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
      <div class="grid gap-8 rounded-[2rem] bg-white/65 p-7 shadow-sm ring-1 ring-[#e6d5b8] sm:p-10 md:grid-cols-[1.15fr_0.85fr] md:items-center">
        <div>
          <h2 id="cake-orders" class="font-['Fraunces',Georgia,serif] text-3xl font-semibold tracking-tight text-[#2b1c14] sm:text-4xl">Cake orders are welcome</h2>
          <p class="mt-4 text-lg leading-relaxed text-[#5a4638]">If you are planning a celebration, tell us what you have in mind. Please include the date and the number of guests in your message so we can talk through the order with you.</p>
        </div>
        <div class="md:text-right">
          <a href="#message" class="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#a8482a] px-7 py-3 text-base font-semibold text-[#fbf4e6] shadow-lg shadow-[#a8482a]/25 transition hover:-translate-y-0.5 hover:bg-[#8f3b21] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8482a] sm:w-auto">Start a cake message</a>
        </div>
      </div>
    </div>
  </section>

</div>
