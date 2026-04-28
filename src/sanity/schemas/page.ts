export default {
  name: 'page',
  title: 'Website Page',
  type: 'document',
  fields: [
    { name: 'title', title: 'Page Name', type: 'string', validation: (Rule: any) => Rule.required() },
    {
      name: 'pageKey',
      title: 'Page Key',
      type: 'string',
      description: 'Use one of: home, app, training, camps, hq, about, shop, workshops, teams, join',
      options: { list: ['home', 'app', 'training', 'camps', 'hq', 'about', 'shop', 'workshops', 'teams', 'join'] },
      validation: (Rule: any) => Rule.required(),
    },
    { name: 'heroEyebrow', title: 'Hero Small Red Label', type: 'string' },
    { name: 'heroHeadline', title: 'Hero Headline', type: 'string' },
    { name: 'heroSubheadline', title: 'Hero Subheadline', type: 'text', rows: 3 },
    { name: 'heroImage', title: 'Hero Image', type: 'image', options: { hotspot: true } },
    { name: 'primaryCta', title: 'Primary Button', type: 'cta' },
    { name: 'secondaryCta', title: 'Secondary Button', type: 'cta' },
    { name: 'sections', title: 'Editable Page Sections', type: 'array', of: [{ type: 'editableSection' }] },
    { name: 'seo', title: 'SEO', type: 'seoFields' },
    { name: 'notesForStaff', title: 'Notes For Staff', type: 'text', rows: 4 },
  ],
  preview: {
    select: { title: 'title', subtitle: 'pageKey', media: 'heroImage' },
  },
}
