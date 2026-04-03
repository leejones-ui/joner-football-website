export default {
  name: 'camp',
  title: 'Camp',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' } },
    { name: 'location', title: 'Location', type: 'string' },
    { name: 'dates', title: 'Dates', type: 'string' },
    { name: 'ageRange', title: 'Age Range', type: 'string' },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: ['open', 'coming-soon', 'closed', 'full'] },
    },
    { name: 'spotsTotal', title: 'Total Spots', type: 'number' },
    { name: 'spotsRemaining', title: 'Spots Remaining', type: 'number' },
    { name: 'description', title: 'Description', type: 'text' },
    { name: 'applyLink', title: 'Apply Link', type: 'url' },
  ],
}
