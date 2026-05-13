import { staticPageKeyOptions } from '../pageCatalog.js'

export default {
  name: 'page',
  title: 'Website Page',
  type: 'document',
  groups: [
    { name: 'basics', title: 'Page basics', default: true },
    { name: 'hero', title: 'Hero' },
    { name: 'sections', title: 'Page sections' },
    { name: 'forms', title: 'Forms' },
    { name: 'seo', title: 'SEO and publishing' },
  ],
  fields: [
    { name: 'title', title: 'Page title', type: 'string', group: 'basics', description: 'The page name shown inside Sanity.', validation: (Rule: any) => Rule.required() },
    { name: 'pageKey', title: 'Which website page is this?', type: 'string', group: 'basics', description: 'Choose the website page this record controls.', options: { list: staticPageKeyOptions }, validation: (Rule: any) => Rule.required() },
    { name: 'pageMode', title: 'How should this page render?', type: 'string', group: 'basics', initialValue: 'fallback', description: 'Fallback keeps the coded layout. Replace swaps the route to the fully editable Sanity page builder.', options: { list: [
      { title: 'Keep coded layout, use safe overrides only', value: 'fallback' },
      { title: 'Replace route with fully editable Sanity page', value: 'replace' },
    ], layout: 'radio' } },
    { name: 'slug', title: 'Slug / URL', type: 'slug', group: 'basics', options: { source: 'title' }, description: 'The public page URL. Example: join or training/jfp-program.' },
    { name: 'publishStatus', title: 'Publish status', type: 'string', group: 'basics', initialValue: 'draft', options: { list: [
      { title: 'Draft', value: 'draft' },
      { title: 'Published', value: 'published' },
      { title: 'Hidden', value: 'hidden' },
    ], layout: 'radio' } },
    { name: 'previewUrl', title: 'Preview URL', type: 'url', group: 'basics', description: 'Paste the preview link for checking this page.' },
    { name: 'lastEditedNotes', title: 'Last updated notes', type: 'text', rows: 4, group: 'basics', description: 'Internal notes for Lee and the team.' },

    { name: 'heroEyebrow', title: 'Hero small label', type: 'string', group: 'hero' },
    { name: 'heroHeadline', title: 'Hero headline', type: 'string', group: 'hero', description: 'This is the big headline at the top of the page.' },
    { name: 'heroSubheadline', title: 'Hero subheadline', type: 'text', rows: 3, group: 'hero' },
    { name: 'heroImage', title: 'Hero image', type: 'imageWithMeta', group: 'hero' },
    { name: 'heroVideo', title: 'Hero video or video embed', type: 'url', group: 'hero', description: 'Paste a YouTube, Vimeo, or hosted video link.' },
    { name: 'primaryCta', title: 'Main CTA button', type: 'cta', group: 'hero' },
    { name: 'secondaryCta', title: 'Secondary CTA button', type: 'cta', group: 'hero' },

    { name: 'sections', title: 'Page sections in order', type: 'array', group: 'sections', of: [{ type: 'editableSection' }], description: 'Add, remove, hide, duplicate, and reorder sections here. Use drag and drop to move sections up or down.' },
    { name: 'testimonials', title: 'Testimonials', type: 'array', group: 'sections', of: [{ type: 'testimonialItem' }] },
    { name: 'faqs', title: 'FAQs', type: 'array', group: 'sections', of: [{ type: 'faqItem' }] },
    { name: 'imageGallery', title: 'Image gallery', type: 'array', group: 'sections', of: [{ type: 'imageWithMeta' }], description: 'Drag images up or down to change the gallery order.' },
    { name: 'pricingBlocks', title: 'Pricing blocks', type: 'array', group: 'sections', of: [{ type: 'priceOption' }] },
    { name: 'buttonLinks', title: 'Button links', type: 'array', group: 'sections', of: [{ type: 'cta' }] },

    { name: 'formSettings', title: 'Form settings', type: 'formSettings', group: 'forms' },

    { name: 'seo', title: 'SEO', type: 'seoFields', group: 'seo' },
    { name: 'trackingLabel', title: 'Tracking/source label', type: 'string', group: 'seo', description: 'Optional label used for analytics and hidden form tracking.' },
    { name: 'internalNotes', title: 'Internal notes', type: 'text', rows: 4, group: 'seo' },
  ],
  validation: (Rule: any) => Rule.custom((doc: any) => {
    if (!doc) return true
    const warnings = []
    if (doc.publishStatus === 'published' && !doc.heroHeadline) warnings.push('Hero headline is missing.')
    if (doc.publishStatus === 'published' && doc.primaryCta?.label && !doc.primaryCta?.url) warnings.push('Main button has text but no link.')
    if (doc.publishStatus === 'published' && doc.heroImage?.image && !doc.heroImage?.alt) warnings.push('Hero image has no alt text.')
    return warnings.length ? warnings.join(' ') : true
  }).warning(),
  preview: {
    select: { title: 'title', subtitle: 'pageKey', media: 'heroImage.image' },
  },
}
