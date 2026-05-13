export default {
  name: 'blogPost',
  title: 'Blog Post',
  type: 'document',
  groups: [
    { name: 'content', title: 'Post content', default: true },
    { name: 'media', title: 'Images' },
    { name: 'cta', title: 'CTA and related posts' },
    { name: 'seo', title: 'SEO and publishing' },
  ],
  fields: [
    { name: 'title', title: 'Title', type: 'string', group: 'content', validation: (Rule: any) => Rule.required() },
    { name: 'slug', title: 'Slug', type: 'slug', group: 'content', options: { source: 'title' }, validation: (Rule: any) => Rule.required().warning('A blog post needs a slug before publishing.') },
    { name: 'author', title: 'Author', type: 'string', group: 'content', initialValue: 'Joner Football' },
    { name: 'publishedAt', title: 'Date', type: 'datetime', group: 'content' },
    { name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3, group: 'content' },
    { name: 'body', title: 'Body content', type: 'text', rows: 12, group: 'content', description: 'Main blog article content. Plain text fallback for the live template.' },
    { name: 'richBody', title: 'Rich body content', type: 'array', group: 'content', of: [{ type: 'block' }, { type: 'imageWithMeta' }], description: 'Preferred article content field for native Sanity blog posts.' },
    { name: 'category', title: 'Category', type: 'string', group: 'content', options: { list: ['Players', 'Parents', 'Coaches', 'Coaching', 'Coaching Tips', 'Player Development', 'Drills', 'Camp Stories', 'Training', 'News', 'App'] } },
    { name: 'publishStatus', title: 'Publish status', type: 'string', group: 'content', initialValue: 'draft', options: { list: [
      { title: 'Draft', value: 'draft' },
      { title: 'Published', value: 'published' },
      { title: 'Hidden', value: 'hidden' },
    ], layout: 'radio' } },
    { name: 'featured', title: 'Featured', type: 'boolean', group: 'content', initialValue: false },

    { name: 'coverImage', title: 'Hero image', type: 'image', group: 'media', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt text', type: 'string' }] },
    { name: 'coverImageUrl', title: 'Hero image URL or local path', type: 'string', group: 'media', description: 'Temporary fallback for local image paths before uploads are moved into the Sanity asset library.' },
    { name: 'coverImageAltText', title: 'Hero image alt text fallback', type: 'string', group: 'media', description: 'Used when the hero image is still a local path instead of a Sanity asset.' },
    { name: 'heroImage', title: 'Extra hero image controls', type: 'imageWithMeta', group: 'media' },

    { name: 'relatedPosts', title: 'Related posts', type: 'array', group: 'cta', of: [{ type: 'reference', to: [{ type: 'blogPost' }] }] },
    { name: 'ctaBlock', title: 'CTA block', type: 'editableSection', group: 'cta', description: 'The app, camp, shop, or coaching CTA shown near the article.' },

    { name: 'seo', title: 'SEO fields', type: 'seoFields', group: 'seo' },
    { name: 'internalNotes', title: 'Internal notes', type: 'text', rows: 4, group: 'seo' },
  ],
  validation: (Rule: any) => Rule.custom((doc: any) => {
    if (!doc) return true
    if (doc.publishStatus === 'published' && doc.coverImage && !doc.coverImage.alt) return 'Hero image has no alt text.'
    return true
  }).warning(),
  preview: { select: { title: 'title', subtitle: 'publishedAt', media: 'coverImage' } },
}
