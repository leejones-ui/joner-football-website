export default {
  name: 'blogPost',
  title: 'Blog Post',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' } },
    { name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3 },
    { name: 'body', title: 'Body', type: 'array', of: [{ type: 'block' }, { type: 'image', options: { hotspot: true } }] },
    { name: 'publishedAt', title: 'Published At', type: 'datetime' },
    { name: 'category', title: 'Category', type: 'string', options: { list: ['Training', 'Camps', 'Coaching', 'Mindset', 'App'] } },
    { name: 'featuredImage', title: 'Featured Image', type: 'image', options: { hotspot: true } },
    { name: 'seoDescription', title: 'SEO Description', type: 'string' },
  ],
}
