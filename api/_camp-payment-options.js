export const CAMP_PAYMENT_OPTIONS = {
  'houston-world-cup-camp-june-2026': {
    campIncludes: ['houston', 'texas houston'],
    displayName: 'Houston World Cup Camp June 2026',
    currency: 'usd',
    successPath: '/camps/texas-houston-june/?payment=success',
    cancelPath: '/camps/texas-houston-june/?payment=cancelled#register',
    amounts: { one: 13000, two: 25000, three: 35000 },
  },
  'dallas-world-cup-camp-june-2026': {
    campIncludes: ['dallas', 'texas dallas'],
    displayName: 'Dallas World Cup Camp June 2026',
    currency: 'usd',
    successPath: '/camps/texas-dallas-june/?payment=success',
    cancelPath: '/camps/texas-dallas-june/?payment=cancelled#register',
    amounts: { one: 13000, two: 25000, three: 35000 },
  },
  'sydney-july-camp-2026': {
    campIncludes: ['sydney', 'sydney july', 'sydney big 1'],
    displayName: 'Sydney July Camp 2026',
    currency: 'aud',
    successPath: '/camps/sydney-big-1-july/?payment=success',
    cancelPath: '/camps/sydney-big-1-july/?payment=cancelled#register',
    amounts: { one: 15000, two: 25000, three: 35000 },
    secretEnv: 'STRIPE_SECRET_KEY_SYDNEY',
    webhookSecretEnv: 'STRIPE_CAMP_WEBHOOK_SECRET_SYDNEY',
  },
}

export function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim()
}

export function selectedDayKey(value) {
  const text = cleanText(value).toLowerCase()
  if (text.includes('3 days') || text.includes('all 3')) return 'three'
  if (text.includes('2 days')) return 'two'
  return 'one'
}

export function campPaymentConfig(camp, destination = '') {
  const haystack = `${camp} ${destination}`.toLowerCase()
  return Object.values(CAMP_PAYMENT_OPTIONS).find((config) =>
    config.campIncludes.some((needle) => haystack.includes(needle))
  ) || null
}

export function siteUrl(req) {
  return (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || `https://${req.headers.host || 'jonerfootball.com'}`).replace(/\/$/, '')
}
