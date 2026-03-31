export default {
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    { name: 'name', title: 'Name', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'role', title: 'Role', type: 'string' },
    { name: 'quote', title: 'Quote', type: 'text', validation: (Rule: any) => Rule.required() },
    { name: 'image', title: 'Photo', type: 'image', options: { hotspot: true } },
    { name: 'page', title: 'Display On', type: 'string', options: { list: ['homepage', 'training', 'camps', 'app', 'workshops'] } },
    { name: 'featured', title: 'Featured', type: 'boolean' },
  ],
}
