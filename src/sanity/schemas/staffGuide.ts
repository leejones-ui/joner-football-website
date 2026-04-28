export default {
  name: 'staffGuide',
  title: 'Staff Editing Guide',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', initialValue: 'How To Edit The Joner Football Website' },
    { name: 'guide', title: 'Guide', type: 'text', rows: 14, initialValue: 'Use Pages to edit key page copy and images. Use Camps to add or update camps. Use FAQs, Testimonials, Partners and Shop Blocks for reusable content. Do not paste passwords or API keys into Sanity. If you are unsure, leave the item as draft and ask Lee.' },
  ],
}
