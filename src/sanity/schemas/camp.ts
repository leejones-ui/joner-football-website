export default {
  name: 'camp',
  title: 'Camp',
  type: 'document',
  fields: [
    { name: 'title', title: 'Camp Title', type: 'string', validation: (Rule: any) => Rule.required() },
    { name: 'slug', title: 'URL Slug', type: 'slug', options: { source: 'title' }, validation: (Rule: any) => Rule.required() },
    { name: 'status', title: 'Status', type: 'string', options: { list: ['draft', 'open', 'coming-soon', 'sold-out', 'closed'] }, initialValue: 'draft' },
    { name: 'heroImage', title: 'Hero Image', type: 'image', options: { hotspot: true } },
    { name: 'heroKicker', title: 'Hero Kicker', type: 'string', description: 'Small label above the main headline. Example: World Cup camp or Selection only.' },
    { name: 'heroSubtitle', title: 'Hero Subtitle', type: 'text', rows: 3 },
    { name: 'urgencyLabel', title: 'Urgency Label', type: 'string', description: 'Example: Limited to 30 players or Sold out last year.' },

    { name: 'location', title: 'Location', type: 'string' },
    {
      name: 'destination',
      title: 'Brevo Destination',
      type: 'string',
      description: 'Controls which Brevo list camp leads go into.',
      options: {
        list: [
          { title: 'USA Camp Leads, Brevo list 5', value: 'usa' },
          { title: 'Sydney Camp Leads, Brevo list 6', value: 'sydney' },
        ],
        layout: 'radio',
      },
      initialValue: 'usa',
    },
    { name: 'brevoListId', title: 'Brevo List ID Override', type: 'number', description: 'Optional. Leave blank unless this specific camp needs a different Brevo list.' },
    { name: 'googleSheetTab', title: 'Google Sheet Tab', type: 'string', description: 'Exact tab name in the camps Google Sheet. Example: Texas Houston (June)' },
    { name: 'venue', title: 'Venue / Address', type: 'string' },
    { name: 'venueName', title: 'Venue Name', type: 'string' },
    { name: 'venueAddress', title: 'Venue Address', type: 'string' },
    { name: 'venueNotes', title: 'Venue Notes', type: 'text', rows: 3 },
    { name: 'mapUrl', title: 'Google Maps Link', type: 'url' },
    { name: 'dates', title: 'Dates', type: 'string' },
    { name: 'startDate', title: 'Schema Start Date', type: 'date', description: 'YYYY-MM-DD. Used for SEO Event schema.' },
    { name: 'endDate', title: 'Schema End Date', type: 'date', description: 'YYYY-MM-DD. Used for SEO Event schema.' },
    { name: 'times', title: 'Times', type: 'string' },
    { name: 'ageRange', title: 'Age Range', type: 'string' },
    { name: 'priceLabel', title: 'Price Label', type: 'string', description: 'Example: From $99 or 3 day camp' },

    { name: 'spotsTotal', title: 'Total Spots', type: 'number' },
    { name: 'spotsRemaining', title: 'Spots Remaining', type: 'number' },
    { name: 'jerseySizes', title: 'Jersey Sizes Available', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' } },
    { name: 'dayOptions', title: 'Day Options', type: 'array', of: [{ type: 'string' }], options: { layout: 'tags' }, description: 'Example: 1 day, 2 days, 3 days' },
    {
      name: 'dayPaymentLinks',
      title: 'Day Payment Links',
      type: 'array',
      description: 'Optional. Use when 1 day, 2 days, and 3 days have different Stripe links.',
      of: [{
        type: 'object',
        fields: [
          { name: 'label', title: 'Day Option Label', type: 'string', description: 'Must match the form option exactly, example: 1 Day' },
          { name: 'stripePaymentLink', title: 'Stripe Payment Link', type: 'url' },
          { name: 'paypalPaymentLink', title: 'PayPal Payment Link', type: 'url' },
        ],
        preview: { select: { title: 'label', subtitle: 'stripePaymentLink' } },
      }],
    },

    { name: 'description', title: 'Short Description', type: 'text', rows: 4 },
    {
      name: 'trustItems',
      title: 'Trust Bar Items',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Short proof points. Example: Sold out last year, Max 16 players per coach.',
    },
    {
      name: 'audienceItems',
      title: 'Who This Camp Is For',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'title', title: 'Title', type: 'string' },
          { name: 'description', title: 'Description', type: 'text', rows: 2 },
        ],
        preview: { select: { title: 'title', subtitle: 'description' } },
      }],
    },
    {
      name: 'campHighlights',
      title: 'Camp Highlights',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'title', title: 'Title', type: 'string' },
          { name: 'description', title: 'Description', type: 'text', rows: 2 },
        ],
        preview: { select: { title: 'title', subtitle: 'description' } },
      }],
    },
    {
      name: 'includedItems',
      title: 'What Players Get',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'trainingThemes',
      title: 'Training Themes',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'title', title: 'Theme', type: 'string' },
          { name: 'description', title: 'Description', type: 'text', rows: 2 },
        ],
        preview: { select: { title: 'title', subtitle: 'description' } },
      }],
    },
    {
      name: 'scheduleItems',
      title: 'Schedule Items',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'time', title: 'Time / Day', type: 'string' },
          { name: 'title', title: 'Title', type: 'string' },
          { name: 'description', title: 'Description', type: 'text', rows: 2 },
        ],
        preview: { select: { title: 'title', subtitle: 'time' } },
      }],
    },
    {
      name: 'coachProfiles',
      title: 'Coach Profiles',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'name', title: 'Name', type: 'string' },
          { name: 'role', title: 'Role', type: 'string' },
          { name: 'bio', title: 'Bio', type: 'text', rows: 3 },
          { name: 'image', title: 'Coach Image', type: 'image', options: { hotspot: true } },
        ],
        preview: { select: { title: 'name', subtitle: 'role', media: 'image' } },
      }],
    },
    {
      name: 'galleryImages',
      title: 'Gallery Images',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
          { name: 'alt', title: 'Alt Text', type: 'string' },
          { name: 'caption', title: 'Caption', type: 'string' },
        ],
        preview: { select: { title: 'caption', subtitle: 'alt', media: 'image' } },
      }],
    },
    { name: 'whatToBring', title: 'What To Bring', type: 'array', of: [{ type: 'string' }] },
    {
      name: 'faqItems',
      title: 'FAQs',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'question', title: 'Question', type: 'string' },
          { name: 'answer', title: 'Answer', type: 'text', rows: 3 },
        ],
        preview: { select: { title: 'question', subtitle: 'answer' } },
      }],
    },
    { name: 'extraInfo', title: 'Extra Information', type: 'text', rows: 4 },

    { name: 'stripePaymentLink', title: 'Stripe Payment Link', type: 'url', description: 'Main card checkout link. If Afterpay is enabled inside Stripe, this can cover card + Afterpay.' },
    { name: 'afterpayPaymentLink', title: 'Legacy Afterpay Payment Link', type: 'url', description: 'Legacy field only. Camp pages now show Afterpay inside Stripe instead of a separate method.' },
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
