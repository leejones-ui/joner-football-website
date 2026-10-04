// What JFP families have actually paid in Stripe (the Sydney account), read
// live, so the Money tab is right even when Airtable was not updated (Lee,
// 5 Oct 2026: "loads have already paid"). Read only: nothing here changes
// Stripe or Airtable. Staff record a payment in Airtable with one click.
//
// JFP payments are completed Checkout Sessions that are either our own
// online bookings (metadata.jfpBookingId) or one of the JFP payment links
// (its product name says JFP). Holiday bookings share the account and are
// left out (metadata.holidayBookingId), as is anything else.
import { stripeFetch } from './_holiday-store.js'
import { kvGetJson, kvSetJson } from './_jfp-store.js'

const CACHE = 'jfp:stripe-payments'
const CACHE_SECONDS = 300
const MAX_PAGES = 20
export const JFP_PRODUCT = /\bJFP\b|Joner Football Performance|Pathway|1 ?on ?1|1 to 1|Trial|Drop ?in|Sibling/i
export const NOT_JFP = /camp|holiday|clinic|workshop|app subscription|teams/i

async function linkProduct(linkId) {
  const key = `jfp:stripe-link:${linkId}`
  const hit = await kvGetJson(key)
  if (hit?.name != null) return hit.name
  let name = ''
  try {
    const d = await stripeFetch(`/payment_links/${encodeURIComponent(linkId)}/line_items?limit=5`)
    name = (d.data || []).map((x) => x.description || x.price?.nickname || '').filter(Boolean).join(', ')
  } catch (error) { console.error('jfp stripe link read failed', linkId, error.message) }
  await kvSetJson(key, { name, at: new Date().toISOString() })
  return name
}

export function classifySession(s, product) {
  if (s.metadata?.holidayBookingId) return 'holiday'
  if (s.metadata?.jfpBookingId) return 'jfp'
  if (product && JFP_PRODUCT.test(product) && !NOT_JFP.test(product)) return 'jfp'
  return 'other'
}

// { since, at, payments: [...], other: { count, cents } }
export async function jfpStripePayments({ since, fresh = false } = {}) {
  const sinceIso = /^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : '2026-09-01'
  if (!fresh) {
    const hit = await kvGetJson(CACHE)
    if (hit && hit.since === sinceIso && Date.now() - Date.parse(hit.at) < CACHE_SECONDS * 1000) return hit
  }
  const gte = Math.floor(Date.parse(`${sinceIso}T00:00:00+10:00`) / 1000)
  const payments = []
  let other = { count: 0, cents: 0 }
  let after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(gte) })
    q.append('expand[]', 'data.payment_intent.latest_charge')
    if (after) q.set('starting_after', after)
    const d = await stripeFetch(`/checkout/sessions?${q}`)
    for (const s of d.data || []) {
      if (s.payment_status !== 'paid') continue
      const product = s.payment_link ? await linkProduct(typeof s.payment_link === 'string' ? s.payment_link : s.payment_link.id) : (s.metadata?.jfpBookingId ? 'JFP online booking' : '')
      const kind = classifySession(s, product)
      if (kind === 'holiday') continue
      if (kind === 'other') { other = { count: other.count + 1, cents: other.cents + (s.amount_total || 0) }; continue }
      const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null
      const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
      payments.push({
        id: s.id,
        intentId: pi?.id || (typeof s.payment_intent === 'string' ? s.payment_intent : ''),
        at: new Date((s.created || 0) * 1000).toISOString(),
        email: String(s.customer_details?.email || s.customer_email || '').trim().toLowerCase(),
        name: String(s.customer_details?.name || '').trim(),
        amountCents: s.amount_total || 0,
        refundedCents: charge?.amount_refunded || 0,
        product: product || 'JFP',
        source: s.metadata?.jfpBookingId ? 'online' : 'link',
        jfpRef: s.metadata?.jfpBookingId || '',
      })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
  }
  const out = { since: sinceIso, at: new Date().toISOString(), payments: payments.sort((a, b) => b.at.localeCompare(a.at)), other }
  await kvSetJson(CACHE, out)
  return out
}
