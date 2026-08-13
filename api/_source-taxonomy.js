export const SOURCE_TAXONOMY = Object.freeze([
  'brevo/email', 'lee_manual_email', 'instagram', 'facebook', 'manychat',
  'tiktok', 'x', 'meta_ads', 'google_organic', 'google_ads', 'direct', 'unknown',
])
const KNOWN = new Set(SOURCE_TAXONOMY)
const clean = (value, max = 240) => String(value ?? '').trim().toLowerCase().slice(0, max)

/** Exact classification from explicit source evidence; vague referrers never guess. */
export function classifySource(input = {}) {
  const explicit = clean(input.source_taxonomy || input.source_detail || input.link_token)
  if (KNOWN.has(explicit)) return explicit
  const source = clean(input.utm_source || input.source)
  const medium = clean(input.utm_medium)
  const detail = clean(input.source_detail || input.link_token)
  const token = `${source} ${medium} ${detail}`
  if (source === 'brevo' && medium === 'email') return 'brevo/email'
  if (source === 'lee_manual_email' || token.includes('lee_manual_email')) return 'lee_manual_email'
  if ((source === 'meta' || source === 'facebook' || source === 'instagram') && ['paid_social', 'paidsocial', 'cpc', 'paid'].includes(medium)) return 'meta_ads'
  if (source === 'instagram' || source === 'ig') return 'instagram'
  if (source === 'facebook' || source === 'fb') return 'facebook'
  if (source === 'manychat') return 'manychat'
  if (source === 'tiktok' || source === 'tik_tok') return 'tiktok'
  if (source === 'x' || source === 'twitter') return 'x'
  if (source === 'google' && ['cpc', 'ppc', 'paid', 'google_ads'].includes(medium)) return 'google_ads'
  if (source === 'google' && ['organic', 'seo'].includes(medium)) return 'google_organic'
  if (!source && !medium && !detail && !input.referrer) return 'direct'
  return 'unknown'
}
export function isSourceTaxonomy(value) { return KNOWN.has(clean(value)) }
