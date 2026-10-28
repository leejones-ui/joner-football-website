// One canonical source list for sales attribution. The journey ledger
// (_attribution-ledger.js), the invoice truth acquisition category
// (_invoice-truth.js), the webhook's source_taxonomy and the /go link bank all
// read from here. The Uscreen Head Code (scripts/uscreen-head-attribution-v1.js)
// is pasted into Uscreen by hand, so it cannot import this module; the test
// scripts/test-source-taxonomy.mjs checks every source it can emit is listed.

// Organic social sources, kept specific so a sale shows the exact place it
// came from (Lee's main Instagram, the app Instagram, a ManyChat DM button...).
export const ORGANIC_SOCIAL_SOURCES = Object.freeze([
  'instagram', 'facebook', 'manychat', 'tiktok', 'x', 'threads',
  'main_instagram', 'app_instagram', 'main_instagram_linktree',
  'manychat_instagram', 'manychat_facebook',
  'youtube', 'youtube_coaches', 'youtube_es',
])

// Mediums that say "this was not a paid placement". /go links use social and
// automation; the Head Code and site referrer classifier use organic_social.
export const ORGANIC_SOCIAL_MEDIUMS = Object.freeze(['social', 'automation', 'organic_social', 'social_organic'])

// A Meta sale is paid only with a paid medium or a campaign/ad-set/ad id.
// An fbclid alone is not proof: organic Facebook and Instagram clicks carry one.
export const PAID_MEDIUMS = Object.freeze(['paid_social', 'paidsocial', 'cpc', 'paid', 'ppc'])

// Sources owned by Meta (paid or organic). Only paid evidence makes them Meta ads.
export const META_SOURCES = Object.freeze([
  'meta', 'meta_ads', 'facebook', 'instagram', 'an', 'audience_network',
  'main_instagram', 'app_instagram', 'manychat_instagram', 'manychat_facebook',
])

// Older or alternative spellings still accepted, mapped to the canonical name.
// 'youtube-es' is what Lee's Spanish channel links and the Head Code send.
export const SOURCE_ALIASES = Object.freeze({
  ig: 'instagram', fb: 'facebook', twitter: 'x', tik_tok: 'tiktok',
  'youtube-es': 'youtube_es', 'youtube-coaches': 'youtube_coaches',
  'main-instagram': 'main_instagram', 'app-instagram': 'app_instagram',
  'manychat-instagram': 'manychat_instagram', 'manychat-facebook': 'manychat_facebook',
  'main-instagram-linktree': 'main_instagram_linktree',
})

export const SOURCE_TAXONOMY = Object.freeze([
  'brevo/email', 'lee_manual_email', ...ORGANIC_SOCIAL_SOURCES,
  'meta_ads', 'google_organic', 'google_ads', 'organic', 'referral', 'direct', 'unknown',
])
const KNOWN = new Set(SOURCE_TAXONOMY)
const ORGANIC_SOURCES = new Set(ORGANIC_SOCIAL_SOURCES)
const ORGANIC_MEDIUMS = new Set(ORGANIC_SOCIAL_MEDIUMS)
const PAID = new Set(PAID_MEDIUMS)
const META = new Set(META_SOURCES)
const clean = (value, max = 240) => String(value ?? '').trim().toLowerCase().slice(0, max)

export function normalizeSource(value) {
  const s = clean(value, 180)
  return SOURCE_ALIASES[s] || s
}
export function normalizeMedium(value) {
  return clean(value, 180).replace(/[- ]/g, '_')
}
const touchSource = (touch = {}) => normalizeSource(touch.utm_source || touch.source)
const touchMedium = (touch = {}) => normalizeMedium(touch.utm_medium || touch.medium)

export function isOrganicSocialSource(value) { return ORGANIC_SOURCES.has(normalizeSource(value)) }
export function isOrganicSocialMedium(value) { return ORGANIC_MEDIUMS.has(normalizeMedium(value)) }
export function isPaidMedium(value) { return PAID.has(normalizeMedium(value)) }
export function isMetaSource(value) { return META.has(normalizeSource(value)) }

export function hasMetaClickId(touch = {}) { return Boolean(touch.fbclid || touch.fbc) }
export function hasMetaAdIds(touch = {}) {
  return Boolean(touch.utm_id || touch.campaign_id || touch.adset_id || touch.ad_id || touch.adset || touch.ad)
}

/** Meta paid: a Meta source (or a Meta click id with no other source) plus a
 * paid medium or a campaign/ad-set/ad id. 'meta'/'meta_ads' sources are paid
 * by definition. */
export function isMetaPaidTouch(touch = {}) {
  const source = touchSource(touch)
  if (source === 'meta' || source === 'meta_ads') return true
  const metaOrigin = META.has(source) || (!source && hasMetaClickId(touch))
  if (!metaOrigin) return false
  return isPaidMedium(touchMedium(touch)) || hasMetaAdIds(touch)
}

/** Organic social: a listed social source or social medium, a Meta source with
 * no paid evidence, or a Meta click id on its own. Never true for Meta paid. */
export function isOrganicSocialTouch(touch = {}) {
  if (isMetaPaidTouch(touch)) return false
  const source = touchSource(touch)
  const medium = touchMedium(touch)
  if (PAID.has(medium)) return false
  if (ORGANIC_SOURCES.has(source) || META.has(source)) return true
  if (ORGANIC_MEDIUMS.has(medium)) return true
  return !source && hasMetaClickId(touch)
}

/** Exact classification from explicit source evidence; vague referrers never guess. */
export function classifySource(input = {}) {
  if (isMetaPaidTouch(input)) return 'meta_ads'
  const explicit = normalizeSource(input.source_taxonomy || input.source_detail || input.link_token)
  if (KNOWN.has(explicit)) return explicit
  const source = normalizeSource(input.utm_source || input.source)
  const medium = normalizeMedium(input.utm_medium)
  const detail = clean(input.source_detail || input.link_token)
  const token = `${source} ${medium} ${detail}`
  if (source === 'brevo' && medium === 'email') return 'brevo/email'
  if (source === 'lee_manual_email' || token.includes('lee_manual_email')) return 'lee_manual_email'
  if (ORGANIC_SOURCES.has(source)) return source
  if (source === 'google' && ['cpc', 'ppc', 'paid', 'google_ads'].includes(medium)) return 'google_ads'
  if (source === 'google' && ['organic', 'seo'].includes(medium)) return 'google_organic'
  if (medium === 'organic' || source === 'organic') return 'organic'
  if (medium === 'referral' || source === 'referral') return 'referral'
  if (!source && !medium && !detail && !input.referrer) return 'direct'
  return 'unknown'
}
export function isSourceTaxonomy(value) { return KNOWN.has(normalizeSource(value)) }
