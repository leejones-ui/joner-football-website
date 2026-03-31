export default {
  name: 'hubContent',
  title: 'Hub Content',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'type', title: 'Content Type', type: 'string', options: { list: ['weekly-challenge', 'free-drill', 'quiz', 'ask-lee', 'announcement'] } },
    { name: 'description', title: 'Description', type: 'text' },
    { name: 'link', title: 'Link', type: 'url' },
    { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
    { name: 'publishedAt', title: 'Published At', type: 'datetime' },
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
  ],
}
