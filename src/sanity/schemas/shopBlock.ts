export default {
  name: 'shopBlock',
  title: 'Shop / Product Block',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'category', title: 'Category', type: 'string', options: { list: ['merch', 'equipment', 'books', 'digital', 'app'] } },
    { name: 'description', title: 'Description', type: 'text', rows: 3 },
    { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
    { name: 'buttonText', title: 'Button Text', type: 'string' },
    { name: 'buttonUrl', title: 'Button Link', type: 'url' },
    { name: 'order', title: 'Display Order', type: 'number' },
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
  ],
}
