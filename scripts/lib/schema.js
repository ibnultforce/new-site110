/** Builds the JSON-LD block for a page. Search engines get structured data for free. */

export function buildJsonLd({ site, page, faqItems = [] }) {
  const org = {
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    url: site.url,
    email: site.contact.email,
    foundingDate: String(site.foundedYear),
    description: site.description,
    sameAs: Object.values(site.social).filter(Boolean),
    // The full logo when the site has one uploaded, else the mark.
    logo: `${site.url}${site.brand?.logo || site.brand?.logoMark || ''}`,
  };

  const graph = [org, {
    '@type': 'WebPage',
    '@id': `${page.absoluteUrl}#webpage`,
    url: page.absoluteUrl,
    name: page.seo?.title || page.title,
    description: page.seo?.description || page.description,
    isPartOf: { '@id': `${site.url}/#organization` },
  }];

  if (page.collection === 'blog') {
    graph.push({
      '@type': 'BlogPosting',
      headline: page.title,
      description: page.description,
      datePublished: page.date,
      dateModified: page.updated || page.date,
      author: { '@type': 'Organization', name: page.author || site.name },
      publisher: { '@id': `${site.url}/#organization` },
      mainEntityOfPage: page.absoluteUrl,
      keywords: (page.tags || []).join(', '),
    });
  }

  if (page.collection === 'products') {
    graph.push({
      '@type': 'SoftwareApplication',
      name: page.title,
      description: page.description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Salesforce',
      url: page.absoluteUrl,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': `${site.url}/#organization` },
    });
  }

  if (page.collection === 'services') {
    graph.push({
      '@type': 'Service',
      name: page.title,
      description: page.description,
      serviceType: page.serviceType || 'Salesforce consulting',
      provider: { '@id': `${site.url}/#organization` },
      areaServed: page.areaServed || 'Worldwide',
    });
  }

  if (faqItems.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  }

  if (page.parentLabel) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site.url },
        { '@type': 'ListItem', position: 2, name: page.parentLabel, item: `${site.url}${page.parentUrl}` },
        { '@type': 'ListItem', position: 3, name: page.title, item: page.absoluteUrl },
      ],
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}
