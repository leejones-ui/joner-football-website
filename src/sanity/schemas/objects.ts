const sectionTypeOptions = [
  { title: 'Hero section', value: 'hero' },
  { title: 'Text and image section', value: 'textImage' },
  { title: 'Full width image section', value: 'fullWidthImage' },
  { title: 'Video section', value: 'video' },
  { title: 'CTA section', value: 'cta' },
  { title: 'Pricing section', value: 'pricing' },
  { title: 'Benefits section', value: 'benefits' },
  { title: 'Feature grid', value: 'featureGrid' },
  { title: 'Testimonial carousel', value: 'testimonialCarousel' },
  { title: 'FAQ section', value: 'faq' },
  { title: 'Gallery section', value: 'gallery' },
  { title: 'Camp details section', value: 'campDetails' },
  { title: 'Countdown or spots section', value: 'countdownSpots' },
  { title: 'Form section', value: 'form' },
  { title: 'Blog content section', value: 'blogContent' },
  { title: 'Logo or trust section', value: 'trust' },
  { title: 'Footer CTA section', value: 'footerCta' },
]

export const seoFields = {
  name: 'seoFields',
  title: 'SEO fields',
  type: 'object',
  fields: [
    { name: 'title', title: 'SEO title', type: 'string', description: 'The title shown in Google and browser tabs.' },
    { name: 'description', title: 'SEO description', type: 'text', rows: 3, description: 'The short description shown in Google search results.' },
    { name: 'image', title: 'Default SEO image', type: 'image', options: { hotspot: true }, description: 'The image used when this page is shared.' },
    { name: 'canonicalUrl', title: 'Canonical URL', type: 'url', description: 'Optional. Leave blank unless this page should point search engines to a different main URL.' },
    { name: 'noIndex', title: 'Hide from Google?', type: 'boolean', initialValue: false, description: 'Turn this on only if this page should not appear in search results.' },
  ],
}

export const imageWithMeta = {
  name: 'imageWithMeta',
  title: 'Image',
  type: 'object',
  fields: [
    { name: 'image', title: 'Upload new image', type: 'image', options: { hotspot: true }, description: 'Use this to replace the image. You can crop and choose the focal point after upload.' },
    { name: 'mobileImage', title: 'Mobile image', type: 'image', options: { hotspot: true }, description: 'Optional. Use this only when mobile needs a different image.' },
    { name: 'alt', title: 'Alt text', type: 'string', description: 'Describe the image for accessibility and Google.' },
    { name: 'caption', title: 'Caption', type: 'string', description: 'Optional caption shown near the image if the page design supports it.' },
    { name: 'hideImage', title: 'Hide image?', type: 'boolean', initialValue: false, description: 'Hide this image instead of deleting it if you may use it later.' },
  ],
  preview: { select: { title: 'alt', subtitle: 'caption', media: 'image' } },
}

export const cta = {
  name: 'cta',
  title: 'Button',
  type: 'object',
  fields: [
    { name: 'label', title: 'Button text', type: 'string', description: 'The words shown on the button.' },
    { name: 'url', title: 'Button link', type: 'url', description: 'This button link is where users go after clicking.', validation: (Rule: any) => Rule.uri({ allowRelative: true, scheme: ['http', 'https', 'mailto', 'tel'] }).warning('Add a button link before publishing this button.') },
    { name: 'openInNewTab', title: 'Open in new tab?', type: 'boolean', initialValue: false },
    { name: 'style', title: 'Button style', type: 'string', initialValue: 'primary', options: { list: [
      { title: 'Primary', value: 'primary' },
      { title: 'Secondary', value: 'secondary' },
      { title: 'Text link', value: 'text' },
    ], layout: 'radio' } },
    { name: 'trackingLabel', title: 'Tracking label', type: 'string', description: 'Optional label used for analytics. Example: home hero join button.' },
  ],
  preview: { select: { title: 'label', subtitle: 'url' } },
}

export const priceOption = {
  name: 'priceOption',
  title: 'Price option',
  type: 'object',
  fields: [
    { name: 'label', title: 'Price label', type: 'string', description: 'Example: 1 Day, 2 Days, 3 Days, Monthly, Annual.' },
    { name: 'price', title: 'Camp price', type: 'string', description: 'Type the price exactly as it should appear on the website.' },
    { name: 'description', title: 'Short price description', type: 'text', rows: 2 },
    { name: 'stripePaymentLink', title: 'Stripe link', type: 'url', description: 'If this is empty, Sanity will show a warning because Stripe should be ready before publishing.', validation: (Rule: any) => Rule.uri({ scheme: ['http', 'https'] }).warning('Stripe link is missing for this price option.') },
    { name: 'paypalPaymentLink', title: 'PayPal link', type: 'url', description: 'Leave PayPal blank if this camp only uses Stripe.' },
    { name: 'featured', title: 'Highlight this option?', type: 'boolean', initialValue: false },
  ],
  preview: { select: { title: 'label', subtitle: 'price' } },
}

export const simpleItem = {
  name: 'simpleItem',
  title: 'Text item',
  type: 'object',
  fields: [
    { name: 'title', title: 'Title', type: 'string' },
    { name: 'description', title: 'Description', type: 'text', rows: 3 },
    { name: 'image', title: 'Image', type: 'imageWithMeta' },
    { name: 'button', title: 'Button', type: 'cta' },
    { name: 'showItem', title: 'Show this item?', type: 'boolean', initialValue: true },
  ],
  preview: { select: { title: 'title', subtitle: 'description', media: 'image.image' } },
}

export const faqItem = {
  name: 'faqItem',
  title: 'FAQ item',
  type: 'object',
  fields: [
    { name: 'question', title: 'Question', type: 'string' },
    { name: 'answer', title: 'Answer', type: 'text', rows: 4 },
  ],
  preview: { select: { title: 'question', subtitle: 'answer' } },
}

export const testimonialItem = {
  name: 'testimonialItem',
  title: 'Testimonial',
  type: 'object',
  fields: [
    { name: 'quote', title: 'Testimonial quote', type: 'text', rows: 4 },
    { name: 'name', title: 'Person name', type: 'string' },
    { name: 'role', title: 'Role or context', type: 'string', description: 'Example: Parent, coach, academy player.' },
    { name: 'image', title: 'Person image', type: 'imageWithMeta' },
  ],
  preview: { select: { title: 'name', subtitle: 'quote', media: 'image.image' } },
}

export const formField = {
  name: 'formField',
  title: 'Form field',
  type: 'object',
  fields: [
    { name: 'label', title: 'Field label', type: 'string', description: 'Example: Player first name.' },
    { name: 'fieldKey', title: 'Field key', type: 'string', description: 'Short internal name. Example: playerFirstName.' },
    { name: 'fieldType', title: 'Field type', type: 'string', initialValue: 'text', options: { list: [
      { title: 'Text', value: 'text' },
      { title: 'Email', value: 'email' },
      { title: 'Phone', value: 'phone' },
      { title: 'Number', value: 'number' },
      { title: 'Long text', value: 'textarea' },
      { title: 'Dropdown', value: 'select' },
      { title: 'Checkbox', value: 'checkbox' },
      { title: 'Hidden tracking field', value: 'hidden' },
    ] } },
    { name: 'required', title: 'Required field?', type: 'boolean', initialValue: false },
    { name: 'options', title: 'Dropdown options', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' } },
    { name: 'defaultValue', title: 'Default value', type: 'string' },
  ],
  preview: { select: { title: 'label', subtitle: 'fieldType' } },
}

export const formSettings = {
  name: 'formSettings',
  title: 'Form settings',
  type: 'object',
  fields: [
    { name: 'title', title: 'Form title', type: 'string' },
    { name: 'introText', title: 'Form intro text', type: 'text', rows: 3 },
    { name: 'fields', title: 'Fields shown', type: 'array', of: [{ type: 'formField' }], description: 'Add, remove, and reorder the fields shown on this form.' },
    { name: 'hiddenTrackingFields', title: 'Hidden tracking fields', type: 'array', of: [{ type: 'formField' }], description: 'Tracking fields the visitor does not see.' },
    { name: 'brevoListIds', title: 'Brevo list IDs', type: 'array', of: [{ type: 'number' }], description: 'Leads from this form go into these Brevo lists.' },
    { name: 'googleSheetTab', title: 'Google Sheet tab', type: 'string', description: 'The tab where leads should be saved.' },
    { name: 'adminEmail', title: 'Admin email', type: 'string', description: 'The team email that receives form notifications.' },
    { name: 'successMessage', title: 'Success message', type: 'text', rows: 3, description: 'Message shown after the form is submitted.' },
    { name: 'redirectBehavior', title: 'Redirect or payment behavior', type: 'string', options: { list: [
      { title: 'Show success message only', value: 'message' },
      { title: 'Redirect to button link', value: 'redirect' },
      { title: 'Send to payment after signup', value: 'payment' },
    ] }, initialValue: 'message' },
    { name: 'buttonText', title: 'Button text', type: 'string', initialValue: 'Submit' },
  ],
}

export const editableSection = {
  name: 'editableSection',
  title: 'Page section',
  type: 'object',
  fields: [
    { name: 'sectionType', title: 'Section type', type: 'string', initialValue: 'textImage', options: { list: sectionTypeOptions }, description: 'Choose what this section is for.' },
    { name: 'label', title: 'Section name for staff', type: 'string', description: 'For staff only. Example: Homepage hero or App feature block.' },
    { name: 'active', title: 'Show this section?', type: 'boolean', initialValue: true, description: 'Hide this section instead of deleting it if you may use it later.' },
    { name: 'eyebrow', title: 'Small label', type: 'string' },
    { name: 'headline', title: 'Headline', type: 'string', description: 'This is the main headline for this section.' },
    { name: 'subheadline', title: 'Subheadline', type: 'text', rows: 3 },
    { name: 'body', title: 'Body text', type: 'array', of: [{ type: 'block' }], description: 'Main editable text for this section.' },
    { name: 'image', title: 'Main image', type: 'imageWithMeta' },
    { name: 'videoUrl', title: 'Video link or embed', type: 'url', description: 'Paste a YouTube, Vimeo, or hosted video link.' },
    { name: 'buttons', title: 'Button links', type: 'array', of: [{ type: 'cta' }], description: 'Every button in this section can be edited here.' },
    { name: 'items', title: 'Cards, benefits, features, or logos', type: 'array', of: [{ type: 'simpleItem' }], description: 'Add, remove, and reorder the items shown in this section.' },
    { name: 'pricingOptions', title: 'Pricing blocks', type: 'array', of: [{ type: 'priceOption' }] },
    { name: 'testimonials', title: 'Testimonials', type: 'array', of: [{ type: 'testimonialItem' }] },
    { name: 'faqs', title: 'FAQs', type: 'array', of: [{ type: 'faqItem' }] },
    { name: 'gallery', title: 'Image gallery order', type: 'array', of: [{ type: 'imageWithMeta' }], description: 'Drag images up or down to change the gallery order.' },
    { name: 'form', title: 'Form settings', type: 'formSettings' },
    { name: 'trackingLabel', title: 'Tracking/source label', type: 'string', description: 'Optional source label used in forms and analytics.' },
    { name: 'internalNotes', title: 'Internal notes', type: 'text', rows: 3 },
  ],
  preview: {
    select: { title: 'label', subtitle: 'sectionType', media: 'image.image' },
    prepare({ title, subtitle, media }: any) {
      const option = sectionTypeOptions.find((item) => item.value === subtitle)
      return { title: title || option?.title || 'Page section', subtitle: option?.title || subtitle, media }
    },
  },
}
