export const TRACKING_LINK_BANK = Object.freeze({
  'instagram-bio': { channel: 'social', source: 'instagram', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'instagram-post': { channel: 'social', source: 'instagram', campaign: 'app-content', content: 'post', destination: '/join' },
  'instagram-dm': { channel: 'social', source: 'instagram', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'facebook-post': { channel: 'social', source: 'facebook', campaign: 'app-content', content: 'post', destination: '/join' },
  'facebook-dm': { channel: 'social', source: 'facebook', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'manychat-instagram': { channel: 'automation', source: 'manychat', campaign: 'instagram-app-flow', content: 'dm-button', destination: '/join' },
  'manychat-facebook': { channel: 'automation', source: 'manychat', campaign: 'facebook-app-flow', content: 'dm-button', destination: '/join' },
  'brevo': { channel: 'email', source: 'brevo/email', campaign: 'brevo-app', content: 'cta', destination: '/join' },
  'lee-email': { channel: 'email', source: 'lee_manual_email', campaign: 'lee-inbox-app', content: 'manual-email', destination: '/join' },
  'tiktok-bio': { channel: 'social', source: 'tiktok', campaign: 'app-evergreen', content: 'bio', destination: '/join' },
  'tiktok-dm': { channel: 'social', source: 'tiktok', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'x-post': { channel: 'social', source: 'x', campaign: 'app-content', content: 'post', destination: '/join' },
  'x-dm': { channel: 'social', source: 'x', campaign: 'app-dm', content: 'manual-dm', destination: '/join' },
  'threads-post': { channel: 'social', source: 'threads', campaign: 'app-content', content: 'post', destination: '/join' },
  'threads-reply': { channel: 'social', source: 'threads', campaign: 'app-content', content: 'reply', destination: '/join' },
  'meta-ad': { channel: 'paid_social', source: 'meta_ads', campaign: 'meta-app', content: 'ad', destination: '/join' },
})

export const TRACKING_DESTINATIONS = Object.freeze({
  join: '/join',
  app: '/app',
  'free-watch': '/free-bundle/watch',
  'free-bundle': '/free-bundle',
  coaches: '/app/for-coaches',
  reviews: '/reviews',
  blog: '/blog',
  hub: '/hub/app',
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
