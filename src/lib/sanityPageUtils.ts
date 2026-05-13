export function shouldReplaceSanityPage(page: any) {
  return page?.pageMode === 'replace'
}

export function getSanityText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function getSanityImageUrl(image: any, fallback = '') {
  return image?.imageUrl || image?.mobileImageUrl || fallback
}

export function getSanityCta(cta: any, fallback?: any) {
  if (cta?.label && cta?.url) return cta
  return fallback || null
}

export function getSanityRenderableSections(page: any) {
  const sections = Array.isArray(page?.sections) ? page.sections.filter((section: any) => section?.active !== false) : []

  if (Array.isArray(page?.buttonLinks) && page.buttonLinks.length) {
    sections.push({
      _key: 'page-button-links',
      sectionType: 'cta',
      active: true,
      headline: 'Quick links',
      buttons: page.buttonLinks,
    })
  }

  if (Array.isArray(page?.pricingBlocks) && page.pricingBlocks.length) {
    sections.push({
      _key: 'page-pricing-blocks',
      sectionType: 'pricing',
      active: true,
      headline: 'Pricing',
      pricingOptions: page.pricingBlocks,
    })
  }

  if (Array.isArray(page?.testimonials) && page.testimonials.length) {
    sections.push({
      _key: 'page-testimonials',
      sectionType: 'testimonialCarousel',
      active: true,
      headline: 'Testimonials',
      testimonials: page.testimonials,
    })
  }

  if (Array.isArray(page?.faqs) && page.faqs.length) {
    sections.push({
      _key: 'page-faqs',
      sectionType: 'faq',
      active: true,
      headline: 'FAQs',
      faqs: page.faqs,
    })
  }

  if (Array.isArray(page?.imageGallery) && page.imageGallery.length) {
    sections.push({
      _key: 'page-image-gallery',
      sectionType: 'gallery',
      active: true,
      headline: 'Gallery',
      gallery: page.imageGallery,
    })
  }

  return sections
}
