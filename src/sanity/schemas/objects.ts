export const seoFields = {
  name: 'seoFields',
  title: 'SEO Fields',
  type: 'object',
  fields: [
    { name: 'title', title: 'SEO Title', type: 'string' },
    { name: 'description', title: 'SEO Description', type: 'text', rows: 3 },
    { name: 'image', title: 'Social Share Image', type: 'image', options: { hotspot: true } },
    { name: 'canonicalUrl', title: 'Canonical URL', type: 'url', description: 'Optional. Leave blank unless this page should point search engines to a different primary URL.' },
    { name: 'noIndex', title: 'Hide From Search Engines', type: 'boolean', initialValue: false },
  ],
}

export const cta = {
  name: 'cta',
  title: 'Call To Action',
  type: 'object',
  fields: [
    { name: 'label', title: 'Button Text', type: 'string' },
    { name: 'url', title: 'Button Link', type: 'url' },
  ],
}

export const editableSection = {
  name: 'editableSection',
  title: 'Editable Section',
  type: 'object',
  fields: [
    { name: 'label', title: 'Internal Label', type: 'string', description: 'For staff only. Example: Homepage hero or App feature block.' },
    { name: 'eyebrow', title: 'Small Red Label', type: 'string' },
    { name: 'headline', title: 'Headline', type: 'string' },
    { name: 'subheadline', title: 'Subheadline', type: 'text', rows: 3 },
    { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
    { name: 'cta', title: 'CTA Button', type: 'cta' },
    { name: 'active', title: 'Show This Section', type: 'boolean', initialValue: true },
  ],
}
