export default {
  name: 'siteSettings',
  title: 'Global Site Settings',
  type: 'document',
  groups: [
    { name: 'brand', title: 'Logo and brand', default: true },
    { name: 'navigation', title: 'Navigation' },
    { name: 'footer', title: 'Footer' },
    { name: 'links', title: 'Important links' },
    { name: 'seo', title: 'Default SEO' },
    { name: 'tracking', title: 'Analytics and tracking' },
  ],
  fields: [
    { name: 'title', title: 'Site title', type: 'string', group: 'brand', initialValue: 'Joner Football' },
    { name: 'logo', title: 'Logo', type: 'image', group: 'brand', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt text', type: 'string' }] },
    { name: 'appLogo', title: 'App logo', type: 'image', group: 'brand', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt text', type: 'string' }] },
    { name: 'headerCta', title: 'Header CTA', type: 'cta', group: 'brand', description: 'The main button shown in the site header.' },

    { name: 'mainNavItems', title: 'Main nav items', type: 'array', group: 'navigation', of: [{ type: 'object', fields: [
      { name: 'label', title: 'Menu label', type: 'string' },
      { name: 'url', title: 'Menu link', type: 'url', validation: (Rule: any) => Rule.uri({ allowRelative: true, scheme: ['http', 'https', 'mailto', 'tel'] }).warning() },
      { name: 'openInNewTab', title: 'Open in new tab?', type: 'boolean', initialValue: false },
      { name: 'dropdownItems', title: 'Dropdown items', type: 'array', of: [{ type: 'cta' }], description: 'Optional dropdown links under this menu item.' },
    ], preview: { select: { title: 'label', subtitle: 'url' } } }] },
    { name: 'campsDropdownItems', title: 'Camps dropdown', type: 'array', group: 'navigation', of: [{ type: 'cta' }], description: 'Camp links shown in the camps dropdown.' },
    { name: 'buttonCta', title: 'Header button CTA', type: 'cta', group: 'navigation' },

    { name: 'footerText', title: 'Footer text', type: 'text', rows: 3, group: 'footer' },
    { name: 'footerLinks', title: 'Footer links', type: 'array', group: 'footer', of: [{ type: 'cta' }] },
    { name: 'socialLinks', title: 'Social links', type: 'array', group: 'footer', of: [{ type: 'object', fields: [
      { name: 'platform', title: 'Platform name', type: 'string' },
      { name: 'url', title: 'Social link', type: 'url' },
    ], preview: { select: { title: 'platform', subtitle: 'url' } } }] },

    { name: 'contactEmail', title: 'Contact email', type: 'string', group: 'links', initialValue: 'leejones@jonerfootball.com' },
    { name: 'contactPhone', title: 'Phone number', type: 'string', group: 'links' },
    { name: 'appUrl', title: 'App link', type: 'url', group: 'links', initialValue: 'https://app.jonerfootball.com' },
    { name: 'joinUrl', title: 'Join page link', type: 'url', group: 'links', initialValue: 'https://jonerfootball.com/join/' },
    { name: 'coachesUrl', title: 'Coaches link', type: 'url', group: 'links', initialValue: 'https://app.jonerfootball.com/join_us' },
    { name: 'shopUrl', title: 'Shop link', type: 'url', group: 'links', initialValue: 'https://jonerfootball.com/shop/' },
    { name: 'instagramUrl', title: 'Instagram URL', type: 'url', group: 'links' },
    { name: 'youtubeUrl', title: 'YouTube URL', type: 'url', group: 'links' },
    { name: 'facebookUrl', title: 'Facebook URL', type: 'url', group: 'links' },
    { name: 'tiktokUrl', title: 'TikTok URL', type: 'url', group: 'links' },

    { name: 'defaultSeo', title: 'Default SEO', type: 'seoFields', group: 'seo' },
    { name: 'defaultSeoImage', title: 'Default SEO image', type: 'image', group: 'seo', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt text', type: 'string' }] },
    { name: 'defaultMetaDescription', title: 'Default meta description', type: 'text', rows: 3, group: 'seo' },

    { name: 'analyticsIds', title: 'Analytics/tracking IDs', type: 'array', group: 'tracking', of: [{ type: 'object', fields: [
      { name: 'name', title: 'Tracking tool name', type: 'string', description: 'Example: Google Analytics, Meta Pixel.' },
      { name: 'trackingId', title: 'Tracking ID', type: 'string' },
      { name: 'notes', title: 'Notes', type: 'text', rows: 2 },
    ], preview: { select: { title: 'name', subtitle: 'trackingId' } } }], description: 'Only add IDs already used by the website.' },
  ],
  preview: { select: { title: 'title', media: 'logo' } },
}
