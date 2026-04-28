export default {
  name: 'faq',
  title: 'FAQ',
  type: 'document',
  fields: [
    { name: 'question', title: 'Question', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'answer', title: 'Answer', type: 'text', rows: 4, validation: (Rule: any) => Rule.required() },
    { name: 'page', title: 'Display On Page', type: 'string', options: { list: ['home', 'app', 'training', 'camps', 'hq', 'about', 'shop', 'workshops', 'teams', 'join'] } },
    { name: 'order', title: 'Display Order', type: 'number' },
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
  ],
}
