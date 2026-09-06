export const TRACKING_LINK_BANK = Object.freeze({
  'instagram': { channel: 'social', source: 'main_instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'main-instagram': { channel: 'social', source: 'main_instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'instagram-bio': { channel: 'social', source: 'main_instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'instagram-post': { channel: 'social', source: 'main_instagram', campaign: 'app-content', content: 'post', destination: '/join' },
  'instagram-dm': { channel: 'social', source: 'main_instagram', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'app-instagram': { channel: 'social', source: 'app_instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'app-instagram-bio': { channel: 'social', source: 'app_instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'app-instagram-post': { channel: 'social', source: 'app_instagram', campaign: 'app-content', content: 'post', destination: '/join' },
  'app-instagram-dm': { channel: 'social', source: 'app_instagram', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'facebook': { channel: 'social', source: 'facebook', campaign: 'app-evergreen', content: 'page', destination: '/join' },
  'facebook-post': { channel: 'social', source: 'facebook', campaign: 'app-content', content: 'post', destination: '/join' },
  'facebook-dm': { channel: 'social', source: 'facebook', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'manychat-instagram': { channel: 'automation', source: 'manychat_instagram', campaign: 'instagram-app-flow', content: 'dm-button', destination: '/join' },
  'manychat-facebook': { channel: 'automation', source: 'manychat_facebook', campaign: 'facebook-app-flow', content: 'dm-button', destination: '/join' },
  'brevo': { channel: 'email', source: 'brevo/email', campaign: 'brevo-app', content: 'cta', destination: '/join' },
  'email': { channel: 'email', source: 'email', campaign: 'app-email', content: 'cta', destination: '/join' },
  'lee-email': { channel: 'email', source: 'lee_manual_email', campaign: 'lee-inbox-app', content: 'manual-email', destination: '/join' },
  'tiktok': { channel: 'social', source: 'tiktok', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'tiktok-bio': { channel: 'social', source: 'tiktok', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'tiktok-dm': { channel: 'social', source: 'tiktok', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'youtube': { channel: 'social', source: 'youtube', campaign: 'main-channel', content: 'description-or-comment', destination: '/join' },
  'youtube-main': { channel: 'social', source: 'youtube', campaign: 'main-channel', content: 'description-or-comment', destination: '/join' },
  'youtube-coaches': { channel: 'social', source: 'youtube_coaches', campaign: 'coaches-channel', content: 'description-or-comment', destination: '/join' },
  'youtube-spanish': { channel: 'social', source: 'youtube', campaign: 'spanish-channel', content: 'description-or-comment', destination: '/join' },
  'x': { channel: 'social', source: 'x', campaign: 'app-content', content: 'post', destination: '/join' },
  'twitter': { channel: 'social', source: 'x', campaign: 'app-content', content: 'post', destination: '/join' },
  'x-post': { channel: 'social', source: 'x', campaign: 'app-content', content: 'post', destination: '/join' },
  'x-reply': { channel: 'social', source: 'x', campaign: 'app-content', content: 'reply', destination: '/join' },
  'x-dm': { channel: 'social', source: 'x', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'threads': { channel: 'social', source: 'threads', campaign: 'app-content', content: 'post', destination: '/join' },
  'threads-post': { channel: 'social', source: 'threads', campaign: 'app-content', content: 'post', destination: '/join' },
  'threads-reply': { channel: 'social', source: 'threads', campaign: 'app-content', content: 'reply', destination: '/join' },
  'ads': { channel: 'paid_social', source: 'meta_ads', campaign: 'meta-app', content: 'ad', destination: '/join' },
  'meta-ad': { channel: 'paid_social', source: 'meta_ads', campaign: 'meta-app', content: 'ad', destination: '/join' },
  'google': { channel: 'organic_search', source: 'google', campaign: 'organic-search', content: 'search', destination: '/join' },
  'google-ad': { channel: 'paid_search', source: 'google_ads', campaign: 'google-app', content: 'ad', destination: '/join' },
})

export const TRACKING_DESTINATIONS = Object.freeze({
  join: '/join',
  app: '/app',
  home: '/',
  'football-training-app': '/football-training-app',
  'free-watch': '/free-bundle/watch',
  'free-video-fake-shot-analysis': 'https://app.jonerfootball.com/programs/the_fake_shot_joners_breakdown_ep_2-bf6c6e',
  'free-video-fake-shot-guide': 'https://app.jonerfootball.com/programs/how-to-do-fake-shot',
  'free-video-vini-explosive-dribble': 'https://app.jonerfootball.com/programs/how-to-do-vini-jr-explosive-dribble',
  'free-video-finishing-voiceover': 'https://app.jonerfootball.com/programs/joner_voiceover_1v1_finishing_v3-c65c05',
  'loyalmax-checkout': 'https://app.jonerfootball.com/checkout/new?o=202578&d=LOYALMAX',
  'free-bundle': '/free-bundle',
  coaches: '/app/for-coaches',
  reviews: '/reviews',
  blog: '/blog',
  hub: '/hub/app',
  'hub-resources': '/hub/resources',
  programmes: '/programmes',
  training: '/training',
  'professional-training': '/training/professional-training',
  'game-analysis': '/training/game-analysis',
  'jfp-programme': '/training/jfp-program',
  'technique-test': '/technique-test',
  shop: '/shop',
  'training-programs': '/shop/training-programs',
  books: '/books',
  teams: '/teams',
  camps: '/camps',
  workshops: '/workshops',
  'coaches-course': '/workshops/coaches-course',
  contact: '/contact',
  'training-enquiries': '/training-enquiries/',
  'joners-juniors': '/joners-juniors/',
  mindsetseminar: '/mindsetseminar',
})

export function getTrackingLink(token) {
  const key = String(token || '').trim().toLowerCase()
  return { token: key, ...TRACKING_LINK_BANK[key] }
}

export function getTrackingDestination(key, fallback = '/join') {
  return TRACKING_DESTINATIONS[String(key || '').trim().toLowerCase()] || fallback
}

export function getTrackingDestinationToken(key, fallback = 'join') {
  const token = String(key || '').trim().toLowerCase()
  return TRACKING_DESTINATIONS[token] ? token : fallback
}
