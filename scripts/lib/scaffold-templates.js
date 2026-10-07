/**
 * Frontmatter + body skeletons for each collection type. Shared by
 * scripts/new.js (one page at a time) and scripts/scaffold-tree.js (a whole
 * tree at once) so both produce identical, correctly-shaped starting files.
 */

/** type is one of: pages, products, services, blog, caseStudies */
export function scaffoldBody(type, { title, today, draft = false, defaultAuthor = '' }) {
  const draftLine = draft ? 'draft: true\n' : '';

  const TEMPLATES = {
    pages: `---
title: ${title}
order: 50
kicker:
heroHeading: ${title}
heroText: One sentence on what this page is for.
description: Under 160 characters, written for search results.
${draftLine}---

## First section

Replace this with the real content.
`,

    products: `---
title: ${title}
tagline: One line on what it does, in the user's words.
order: 50
badge:
price:
logo:
installUrl:
heroHeading: ${title}
description: Under 160 characters, written for search results.
highlights:
  - First thing it does
  - Second thing it does
  - Third thing it does
facts:
  - label: Time to an answer
    value:
    note:
  - label: Price
    value:
capabilities:
  - title: Capability one
    body: What it does and why that matters.
faqTopics: [products]
${draftLine}---

## The problem it removes

## How it works

## Who it is for
`,

    services: `---
title: ${title}
tagline: One line on the outcome, not the activity.
order: 50
description: Under 160 characters, written for search results.
highlights:
  - Headline deliverable
  - Second deliverable
  - Third deliverable
deliverables:
  - What the client actually receives
idealFor:
  - The situation this fits
steps:
  - title: First stage
    body: What happens and what it produces.
faqTopics: [services]
${draftLine}---

## What this involves

## How we price it
`,

    blog: `---
title: ${title}
date: ${today}
category:
author: ${defaultAuthor}
tags: []
relatedProduct:
description: Under 160 characters, written for search results.
excerpt: One or two sentences that make someone open the post.
${draftLine}---

Opening paragraph: the specific situation the reader is in.

## First section
`,

    caseStudies: `---
title: ${title}
tagline: One line on what changed for the client.
category:
order: 50
client:
industry:
duration:
stack: []
externalUrl:
description: Under 160 characters, written for search results.
results:
  - value:
    label:
${draftLine}---

## The situation

## What we did

## The result
`,
  };

  return TEMPLATES[type];
}
