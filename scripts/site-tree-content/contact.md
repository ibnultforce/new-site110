---
title: Contact
description: How to get in touch, and what happens after you do.
slug: contact
order: 30
---

<section class="section-y">
  <div class="wrap grid items-start gap-12 lg:grid-cols-[1.15fr_0.85fr]">
    <div>
      <h1 class="text-hero">{{ page.title }}</h1>
      <p class="mt-5 max-w-[54ch] text-lede text-ink-2">One sentence on how you respond and what happens next.</p>
      <div class="prose-site mt-8">
        <h2>What to include</h2>
        <p>Replace this with what a message should include so you can help quickly.</p>
        <h2>What happens next</h2>
        <p>Replace this with the real answer: who reads the message, how fast they reply, and what the next step is.</p>
      </div>
    </div>
    <div class="rounded-card border border-line bg-mist p-6 sm:p-8">
      <h2 class="text-h3">Reach us directly</h2>
      {{# if site.contact.email }}<p class="mt-4 break-words"><a href="mailto:{{ site.contact.email }}" class="text-brand hover:text-brand-dark">{{ site.contact.email }}</a></p>{{/ if }}
      {{# if site.contact.whatsappUrl }}<p class="mt-2"><a href="{{ site.contact.whatsappUrl }}" class="text-brand hover:text-brand-dark">WhatsApp {{ site.contact.whatsapp }}</a></p>{{/ if }}
      {{# if site.contact.bookingUrl }}<p class="mt-5"><a class="btn btn-primary" href="{{ site.contact.bookingUrl }}" target="_blank" rel="noopener">{{ site.contact.bookingLabel }}</a></p>{{/ if }}
      {{# if site.contact.responseTime }}<p class="mt-5 text-muted">{{ site.contact.responseTime }}</p>{{/ if }}
    </div>
  </div>
</section>
