// What JFP families have actually paid in Stripe (the Sydney account), read
// live, so the Money tab is right even when Airtable was not updated (Lee,
// 5 Oct 2026: "loads have already paid"). Read only: nothing here changes
// Stripe or Airtable. Staff record a payment in Airtable with one click.
//
// JFP payments are completed Checkout Sessions that are either our own
// online bookings (metadata.jfpBookingId) or one of the JFP payment links
// (its product name says JFP). Holiday bookings share the account and are
// left out (metadata.holidayBookingId), as is anything else.
//
// Each payment carries what Stripe kept: the fee from its balance
// transaction (GST included, never an estimate), the net and how it was paid.
// A refund never gives the fee back, so a refunded payment keeps its fee.
import { stripeFetch } from './_holiday-store.js'
import { kvGetJson, kvSetJson, kvPipeline } from './_jfp-store.js'
// Auto-charges after a session are payment intents, not Checkout Sessions (claude/card-on-file).
import { autoChargePayments } from './_jfp-saved-pay.js'
// Payments Lee marked as holiday training, Pro sessions or not JFP (18 Oct 2026).
import { listStripeClass, applyStripeClass } from './_jfp-stripe-class.js'

// v2 has the fees. The old cache had none, so it is never read.
const CACHE = 'jfp:stripe-payments:v2'
const CACHE_SECONDS = 300
const MAX_PAGES = 20
// A fee Stripe had not worked out when the list was read is asked for on its
// own, a few per read, each at most every 10 minutes, then kept for good.
const FEE_LOOKUPS = 10
const FEE_RETRY_SECONDS = 600
export const feeKey = (intentId) => `jfp:stripe-fee:${intentId}`
// Next term paid early (hold the place, or the full term) is not this term's income.
export const NEXT_TERM_SOURCES = new Set(['next-hold', 'next-full'])
// Personal payment links named after the player are JFP too ("<player> - Additional Tuesday Term 4 session").
export const JFP_PRODUCT = /\bJFP\b|Joner Football Performance|Pathway|1 ?on ?1|1 to 1|Trial|Drop ?in|Sibling|\bTerm [1-4]\b/i
export const NOT_JFP = /camp|holiday|clinic|workshop|app subscription|teams|junior/i

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

// Pro sessions (Lee, 13 Oct 2026; keys agreed with the players work): a quick
// link made for Pro says jfpProgramme 'pro'; a payment link for a Pro row
// says jfpProduct 'pro'. Either way it is Pro money, never JFP term income.
export const isProSession = (s) => s?.metadata?.jfpProgramme === 'pro' || s?.metadata?.jfpProduct === 'pro'

export function classifySession(s, product) {
  if (s.metadata?.holidayBookingId) return 'holiday'
  // A quick link says its programme: only JFP is JFP term income.
  const programme = s.metadata?.jfpProgramme
  if (programme && programme !== 'jfp') return programme === 'holiday' ? 'holiday' : 'other'
  if (s.metadata?.jfpBookingId) return 'jfp'
  if (product && JFP_PRODUCT.test(product) && !NOT_JFP.test(product)) return 'jfp'
  return 'other'
}

// The fee on a charge, from its balance transaction: { fee, gst, net, method },
// or null while Stripe has not made one yet.
export function feeFrom(charge) {
  const bt = charge?.balance_transaction
  if (!bt || typeof bt !== 'object' || typeof bt.fee !== 'number') return null
  const gst = (bt.fee_details || []).filter((d) => d.type === 'tax').reduce((t, d) => t + (d.amount || 0), 0)
  return { fee: bt.fee, gst, net: typeof bt.net === 'number' ? bt.net : null, method: charge.payment_method_details?.type || '' }
}
const feeFields = (f) => (f ? { feeCents: f.fee, feeGstCents: f.gst, stripeNetCents: f.net, feeKnown: true } : { feeCents: null, feeGstCents: null, stripeNetCents: null, feeKnown: false })

// Fees missing from the list: the cache first, then Stripe for a few. One
// read for every kept fee and every "asked lately" marker, then at most
// FEE_LOOKUPS markers set and asked, however many are still missing.
const tryKey = (intentId) => `jfp:stripe-fee-try:${intentId}`
export async function fillFees(payments) {
  const missing = payments.filter((p) => !p.feeKnown && p.intentId)
  if (!missing.length) return
  const hits = await kvPipeline(missing.flatMap((p) => [['GET', feeKey(p.intentId)], ['GET', tryKey(p.intentId)]]))
  const found = new Map()
  const ask = []
  for (const [i, p] of missing.entries()) {
    let f = null
    try { f = typeof hits[2 * i] === 'string' ? JSON.parse(hits[2 * i]) : null } catch {}
    if (f && typeof f.fee === 'number') found.set(p, f)
    else if (hits[2 * i + 1] == null && ask.length < FEE_LOOKUPS) ask.push(p)
  }
  const marks = ask.length ? await kvPipeline(ask.map((p) => ['SET', tryKey(p.intentId), '1', 'NX', 'EX', String(FEE_RETRY_SECONDS)])) : []
  for (const [i, p] of ask.entries()) {
    if (marks[i] !== 'OK') continue
    try {
      const f = feeFrom((await stripeFetch(`/payment_intents/${encodeURIComponent(p.intentId)}?expand[]=latest_charge.balance_transaction`))?.latest_charge)
      if (f) { await kvSetJson(feeKey(p.intentId), f); found.set(p, f) }
    } catch (error) { console.error('jfp stripe fee read failed', p.intentId, error.message) }
  }
  for (const [p, f] of found) Object.assign(p, feeFields(f), { payMethod: p.payMethod || f.method || '' })
}

// Next term paid early is kept apart. A payment that names its term counts
// for that term; one that does not (made before the term was written on
// it) is always next term's. Pro payments are kept apart too (pro).
const isNextTerm = (p, term) => p.nextTerm && (!p.forTerm || p.forTerm !== term)
export function splitTerms(out, term) {
  const jfp = out.payments.filter((p) => !p.pro)
  return { ...out, payments: jfp.filter((p) => !isNextTerm(p, term)), next: jfp.filter((p) => isNextTerm(p, term)), pro: out.payments.filter((p) => p.pro) }
}

// { since, at, payments: [...this term], next: [...next term], other: { count, cents } }
// term: the current term (config.term). quick: any read from the last 6
// hours is fine (the page shows it at once, then asks again for the latest).
export async function jfpStripePayments({ since, fresh = false, quick = false, term = '' } = {}) {
  const sinceIso = /^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : '2026-09-01'
  if (!fresh) {
    const hit = await kvGetJson(CACHE)
    // proTagged: read since Pro payments are marked (an older copy is read again once).
    if (hit && hit.proTagged && hit.linkTagged && hit.since === sinceIso && Array.isArray(hit.payments) && Date.now() - Date.parse(hit.at) < (quick ? 6 * 3600 : CACHE_SECONDS) * 1000) return applyStripeClass(splitTerms(hit, term), await listStripeClass())
  }
  const gte = Math.floor(Date.parse(`${sinceIso}T00:00:00+10:00`) / 1000)
  const payments = []
  let other = { count: 0, cents: 0 }
  let after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(gte) })
    // Four levels, Stripe's most: the charge's balance transaction has the fee.
    q.append('expand[]', 'data.payment_intent.latest_charge.balance_transaction')
    if (after) q.set('starting_after', after)
    const d = await stripeFetch(`/checkout/sessions?${q}`)
    for (const s of d.data || []) {
      if (s.payment_status !== 'paid') continue
      const product = s.payment_link ? await linkProduct(typeof s.payment_link === 'string' ? s.payment_link : s.payment_link.id) : s.metadata?.jfpFor ? `Quick link: ${s.metadata.jfpFor}` : (s.metadata?.jfpBookingId ? 'JFP online booking' : '')
      const pro = isProSession(s)
      const kind = pro ? 'jfp' : classifySession(s, product)
      if (kind === 'holiday') continue
      if (kind === 'other') { other = { count: other.count + 1, cents: other.cents + (s.amount_total || 0) }; continue }
      const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null
      const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
      // Nothing charged (a full discount): no fee.
      const fee = !s.amount_total ? { fee: 0, gst: 0, net: 0 } : feeFrom(charge)
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
        // The Stripe payment link it came through (Match to player remembers it).
        linkId: typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id || '',
        payMethod: charge?.payment_method_details?.type || '',
        ...feeFields(fee),
        nextTerm: NEXT_TERM_SOURCES.has(s.metadata?.source || ''),
        forTerm: s.metadata?.jfpTerm || '',
        ...(pro ? { pro: true } : {}),
      })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
  }
  // Saved card or bank auto-charges (claude/card-on-file): in the list like any other payment.
  try { payments.push(...(await autoChargePayments(sinceIso)).filter((p) => !payments.some((x) => x.intentId === p.intentId))) } catch (error) { console.error('jfp auto-charge payments read failed', error.message) }
  // A fee that cannot be found now shows as not known yet, never as nothing.
  try { await fillFees(payments) } catch (error) { console.error('jfp stripe fees failed', error.message) }
  const out = { since: sinceIso, at: new Date().toISOString(), payments: payments.sort((a, b) => b.at.localeCompare(a.at)), other, proTagged: true, linkTagged: true }
  await kvSetJson(CACHE, out)
  return applyStripeClass(splitTerms(out, term), await listStripeClass())
}

// What Stripe kept on this term's payments, all of them, refunded ones too.
export function feeTotals(payments) {
  const known = (p) => (p.feeKnown ? p.feeCents || 0 : 0)
  const byMethod = new Map()
  for (const p of payments) {
    const k = p.payMethod || 'unknown'
    const x = byMethod.get(k) || { method: k, count: 0, grossCents: 0, feeCents: 0, pendingCount: 0 }
    x.count += 1
    x.grossCents += p.amountCents || 0
    x.feeCents += known(p)
    if (!p.feeKnown) x.pendingCount += 1
    byMethod.set(k, x)
  }
  return {
    stripeFeesCents: payments.reduce((t, p) => t + known(p), 0),
    feeGstCents: payments.reduce((t, p) => t + (p.feeKnown ? p.feeGstCents || 0 : 0), 0),
    feesPendingCount: payments.filter((p) => !p.feeKnown).length,
    feesByMethod: [...byMethod.values()].sort((a, b) => b.grossCents - a.grossCents || a.method.localeCompare(b.method)),
  }
}

// Read only: every paid Checkout Session in a date range (Sydney dates), with
// what it was for, so staff can find payments made before the portal (Lee,
// 12 Oct 2026: Term 4 links Ligia sent on 8 Sept). At most 70 days.
export async function stripeScan({ from, to }) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')
  if (!ok(from) || !ok(to) || to < from) throw new Error('Choose a from and to date.')
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 70) throw new Error('At most 70 days at a time.')
  const gte = Math.floor(Date.parse(`${from}T00:00:00+10:00`) / 1000), lt = Math.floor(Date.parse(`${to}T00:00:00+10:00`) / 1000) + 86400
  const out = []
  let after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(gte), 'created[lt]': String(lt) })
    q.append('expand[]', 'data.line_items')
    q.append('expand[]', 'data.payment_intent.latest_charge')
    if (after) q.set('starting_after', after)
    const d = await stripeFetch(`/checkout/sessions?${q}`)
    for (const x of d.data || []) {
      if (x.payment_status !== 'paid') continue
      const pi = x.payment_intent && typeof x.payment_intent === 'object' ? x.payment_intent : null
      const link = typeof x.payment_link === 'string' ? x.payment_link : x.payment_link?.id || ''
      out.push({
        id: x.id, intentId: pi?.id || '', at: new Date(x.created * 1000).toISOString(),
        email: String(x.customer_details?.email || x.customer_email || '').trim().toLowerCase(), name: String(x.customer_details?.name || '').trim(),
        amountCents: x.amount_total || 0, refundedCents: pi?.latest_charge?.amount_refunded || 0,
        product: (x.line_items?.data || []).map((i) => i.description).filter(Boolean).join(', ') || (link ? await linkProduct(link) : ''),
        link, description: pi?.description || '', metadata: x.metadata || {}, customFields: (x.custom_fields || []).map((f) => `${f.label?.custom || f.key}: ${f.text?.value || f.dropdown?.value || f.numeric?.value || ''}`),
      })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
  }
  // Card payments that did not come through Checkout (invoices, charges made
  // in the dashboard): listed apart so nothing is missed.
  const seen = new Set(out.map((x) => x.intentId).filter(Boolean))
  after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', 'created[gte]': String(gte), 'created[lt]': String(lt) })
    q.append('expand[]', 'data.latest_charge')
    if (after) q.set('starting_after', after)
    const d = await stripeFetch(`/payment_intents?${q}`)
    for (const x of d.data || []) {
      if (x.status !== 'succeeded' || seen.has(x.id)) continue
      const ch = x.latest_charge && typeof x.latest_charge === 'object' ? x.latest_charge : null
      out.push({ id: x.id, intentId: x.id, at: new Date(x.created * 1000).toISOString(), email: String(ch?.billing_details?.email || x.receipt_email || '').toLowerCase(), name: String(ch?.billing_details?.name || ''), amountCents: x.amount_received || x.amount || 0, refundedCents: ch?.amount_refunded || 0, product: '', link: '', description: x.description || '', metadata: x.metadata || {}, customFields: [], notCheckout: true, invoice: x.invoice || '' })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
  }
  return out
}
