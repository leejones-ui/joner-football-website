// Shared conservative reporting classification. Click cookies, platform names,
// acquisition labels and campaign names are not proof of paid advertising.
const clean = (v) => String(v ?? '').trim().toLowerCase()
const META = new Set(['fb', 'ig', 'an', 'facebook', 'instagram', 'meta', 'app_instagram', 'app_facebook', 'meta_ads'])
const PAID = new Set(['paid_social', 'paidsocial', 'paid', 'cpc'])
const ORGANIC = new Set(['social', 'organic', 'organic_social', 'organic-social'])
const adId = (v) => /^\d{15,20}$/.test(String(v ?? '').trim())
const sourceOf = (touch) => clean(touch?.utm_source || touch?.source)
const mediumOf = (touch) => clean(touch?.utm_medium || touch?.medium).replace(/[ -]/g, '_')
function touchStatus(touch) {
  const source = sourceOf(touch)
  const medium = mediumOf(touch)
  if (!META.has(source)) return 'unknown'
  if (ORGANIC.has(medium)) return 'organic'
  if (PAID.has(medium) && adId(touch?.ad_id || touch?.ad)) return 'paid'
  return 'unknown'
}
// Last-touch labels are primary; first-touch paid proof is disclosed as an
// assist rather than upgrading an organic or missing last touch to paid.
export function classifyPaidMeta(input = {}) {
  const last = input.last_touch && Object.keys(input.last_touch).length ? input.last_touch : input
  const first = input.first_touch && Object.keys(input.first_touch).length ? input.first_touch : null
  const lastStatus = touchStatus(last)
  const firstStatus = first ? touchStatus(first) : 'unknown'
  const paidAssisted = firstStatus === 'paid' && lastStatus !== 'paid'
  const contradictory = clean(input.acquisition) === 'exact_paid_meta' && lastStatus === 'organic'
  const channel = contradictory ? 'unknown' : lastStatus === 'paid' ? 'meta_ads' : lastStatus === 'organic' ? 'meta_organic' : 'unknown'
  return { channel, paid_assisted: paidAssisted, confidence: contradictory ? 'none' : lastStatus === 'paid' ? 'high' : lastStatus === 'organic' ? 'medium' : 'none' }
}
