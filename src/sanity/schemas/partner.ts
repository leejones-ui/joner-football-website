export default {
  name: 'partner',
  title: 'Partner',
  type: 'document',
  fields: [
    { name: 'name', title: 'Name', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'role', title: 'Partner Role', type: 'string' },
    { name: 'logo', title: 'Logo', type: 'image' },
    { name: 'url', title: 'Website URL', type: 'url' },
    { name: 'order', title: 'Display Order', type: 'number' },
  ],
}
