export default {
  name: 'camp',
  title: 'Camp',
  type: 'document',
  fields: [
    { name: 'title', title: 'Camp Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'slug', title: 'URL Slug', type: 'slug', options: { source: 'title' }, validation: (Rule: any) => Rule.required() },
    { name: 'status', title: 'Status', type: 'string', options: { list: ['draft', 'open', 'coming-soon', 'sold-out', 'closed'] }, initialValue: 'draft' },
    { name: 'heroImage', title: 'Hero Image', type: 'image', options: { hotspot: true } },

    { name: 'location', title: 'Location', type: 'string' },
    {
      name: 'destination',
      title: 'Brevo Destination',
      type: 'string',
      description: 'Controls which Brevo list camp leads go into.',
      options: {
        list: [
          { title: 'USA Camp Leads, Brevo list 4', value: 'usa' },
          { title: 'Sydney Camp Leads, Brevo list 6', value: 'sydney' },
        ],
        layout: 'radio',
      },
      initialValue: 'usa',
    },
    { name: 'brevoListId', title: 'Brevo List ID Override', type: 'number', description: 'Optional. Leave blank unless this specific camp needs a different Brevo list.' },
    { name: 'venue', title: 'Venue / Address', type: 'string' },
    { name: 'dates', title: 'Dates', type: 'string' },
    { name: 'times', title: 'Times', type: 'string' },
    { name: 'ageRange', title: 'Age Range', type: 'string' },
    { name: 'priceLabel', title: 'Price Label', type: 'string', description: 'Example: From $99 or 3 day camp' },

    { name: 'spotsTotal', title: 'Total Spots', type: 'number' },
    { name: 'spotsRemaining', title: 'Spots Remaining', type: 'number' },
    { name: 'jerseySizes', title: 'Jersey Sizes Available', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' } },
    { name: 'dayOptions', title: 'Day Options', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' }, description: 'Example: 1 day, 2 days, 3 days' },

    { name: 'description', title: 'Short Description', type: 'text', rows: 4 },
    { name: 'whatToBring', title: 'What To Bring', type: 'array', of: [{ type: 'string' }] },
    { name: 'extraInfo', title: 'Extra Information', type: 'text', rows: 4 },

    { name: 'stripePaymentLink', title: 'Stripe Payment Link', type: 'url' },
    { name: 'paypalPaymentLink', title: 'PayPal Payment Link', type: 'url' },
    { name: 'trainingAgreementLink', title: 'Training Agreement Link', type: 'url' },
    { name: 'notificationEmail', title: 'Notification Email', type: 'string', initialValue: 'leejones@jonerfootball.com' },
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'dates',
      media: 'heroImage',
    },
  },
}
