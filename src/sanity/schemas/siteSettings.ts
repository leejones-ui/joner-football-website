export default {
  name: 'siteSettings',
  title: 'Global Site Settings',
  type: 'document',
  fields: [
    { name: 'title', title: 'Site Title', type: 'string', initialValue: 'Joner Football' },
    { name: 'logo', title: 'Main Logo', type: 'image' },
    { name: 'appLogo', title: 'App Logo', type: 'image' },
    { name: 'contactEmail', title: 'Contact Email', type: 'string', initialValue: 'leejones@jonerfootball.com' },
    { name: 'contactPhone', title: 'Contact Phone', type: 'string' },
    { name: 'appUrl', title: 'Main App Link', type: 'url', initialValue: 'https://app.jonerfootball.com' },
    { name: 'joinUrl', title: 'Join Page Link', type: 'url', initialValue: 'https://jonerfootball.com/join/' },
    { name: 'instagramUrl', title: 'Instagram URL', type: 'url' },
    { name: 'youtubeUrl', title: 'YouTube URL', type: 'url' },
    { name: 'facebookUrl', title: 'Facebook URL', type: 'url' },
    { name: 'tiktokUrl', title: 'TikTok URL', type: 'url' },
    { name: 'defaultSeo', title: 'Default SEO', type: 'seoFields' },
  ],
}
