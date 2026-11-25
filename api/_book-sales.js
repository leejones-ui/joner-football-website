// Book sales and where each sale came from. Read only.
//
// Reads Shopify orders through the same read key the portal's Shop orders page
// uses (shopGql in _shop-orders.js), keeps the orders that hold a book, and
// sorts each one into a source bucket from Shopify's own visit trail
// (customerJourneySummary: the buyer's first and last visit to the shop).
//
// Lee's rule: a sale counts for ads when the ad was the FIRST or the LAST touch.
// No customer names, emails or addresses ever leave this file.
import { shopGql, shopConnected, sydneyDay, kvCommand } from './_shop-orders.js'
import { kvGetJson, kvSetJson } from './_holiday-store.js'

// Every book Lee sells. Add the next book here: a key, a name and how to spot
// its products (Shopify product handle or line item title).
export const BOOKS = [
  { key: 'top-50-coaching-drills', name: 'Top 50 Coaching Drills', handle: /^top-50-coaching-drills/i, title: /top 50 coaching drills/i },
]

const CACHE_SECONDS = 600
const MAX_DAYS = 120
const cents = (m) => Math.round(Number(m?.shopMoney?.amount || 0) * 100)
const low = (v) => String(v || '').trim().toLowerCase()

export function bookFor(line) {
  const handle = line?.product?.handle || ''
  const title = line?.title || ''
  return BOOKS.find((b) => b.handle.test(handle) || b.title.test(title)) || null
}

// paperback, pdf, or member (the app member early access PDF).
export function formatFor(line) {
  const text = `${line?.product?.handle || ''} ${line?.title || ''}`.toLowerCase()
  if (/member|early.access/.test(text)) return 'member'
  if (/paperback|hardback|print/.test(text)) return 'paperback'
  if (/pdf|download|ebook|e-book/.test(text)) return 'pdf'
  return line?.requiresShipping ? 'paperback' : 'pdf'
}

function landingParams(visit) {
  try {
    return new URL(String(visit?.landingPage || '')).searchParams
  } catch {
    return new URLSearchParams()
  }
}

// One visit -> ad | email | instagram | facebook | direct | other | none.
export function classifyVisit(visit) {
  if (!visit) return { bucket: 'none', campaign: '', content: '' }
  const q = landingParams(visit)
  const utm = visit.utmParameters || {}
  const source = low(utm.source || q.get('utm_source'))
  const medium = low(utm.medium || q.get('utm_medium'))
  const campaign = String(utm.campaign || q.get('utm_campaign') || '').slice(0, 120)
  const content = String(utm.content || q.get('utm_content') || '').slice(0, 120)
  const ref = low(visit.referrerUrl) + ' ' + low(visit.source)
  const out = (bucket) => ({ bucket, campaign, content })
  const paid = /^(paid|cpc|ppc|paid[_ -]?social|paidsocial)$/.test(medium)
  const metaSource = /facebook|instagram|meta|^fb$|^ig$/.test(source)
  const hasAdId = Boolean(q.get('campaign_id') || q.get('ad_id') || q.get('adset_id'))
  if ((paid && (metaSource || !source)) || (hasAdId && medium !== 'email') || (paid && q.get('fbclid'))) return out('ad')
  if (medium === 'email' || /brevo|sendinblue|newsletter/.test(source) || /sendibm|brevo|sendinblue/.test(ref) || low(visit.source) === 'email') return out('email')
  if (/instagram|^ig$/.test(source) || /instagram/.test(ref)) return out('instagram')
  if (/facebook|^fb$/.test(source) || /facebook|fb\.com|fb\.me/.test(ref)) return out('facebook')
  if (source) return out('other')
  if (!visit.referrerUrl && (!visit.source || low(visit.source) === 'direct')) return out('direct')
  return out('other')
}

// Whole order: ads when either end of the trail was an ad, otherwise the last
// visit (then the first). 'unknown' when Shopify kept no trail.
export function classifyOrder(journey) {
  const first = classifyVisit(journey?.firstVisit)
  const last = classifyVisit(journey?.lastVisit)
  if (first.bucket === 'ad' || last.bucket === 'ad') {
    const ad = last.bucket === 'ad' ? last : first
    return { bucket: 'ad', firstTouch: first.bucket, lastTouch: last.bucket, campaign: ad.campaign, content: ad.content }
  }
  const pick = last.bucket !== 'none' ? last : first
  return { bucket: pick.bucket === 'none' ? 'unknown' : pick.bucket, firstTouch: first.bucket, lastTouch: last.bucket, campaign: pick.campaign, content: pick.content }
}

// A Shopify order -> the slim, private-free row the dashboard gets. null when
// the order holds no book, was a test, or was cancelled or fully refunded.
export function slimBookOrder(o) {
  if (!o || o.test || o.cancelledAt) return null
  const lines = (o.lineItems?.nodes || []).filter((l) => bookFor(l))
  if (!lines.length) return null
  if (/^(REFUNDED|VOIDED)$/.test(o.displayFinancialStatus || '')) return null
  const items = lines.map((l) => ({ book: bookFor(l).key, format: formatFor(l), qty: Number(l.quantity || 0), cents: cents(l.discountedTotalSet) }))
  const bookCents = items.reduce((t, i) => t + i.cents, 0)
  const allBooks = lines.length === (o.lineItems?.nodes || []).length
  const src = classifyOrder(o.customerJourneySummary)
  return {
    order: o.name,
    at: o.createdAt,
    day: sydneyDay(Date.parse(o.createdAt)),
    items,
    copies: items.reduce((t, i) => t + i.qty, 0),
    bookCents,
    // What the buyer paid in all (books, postage, tax), only when the order is books alone.
    paidCents: allBooks ? Math.max(0, cents(o.currentTotalPriceSet) - cents(o.totalRefundedSet)) : bookCents,
    free: bookCents === 0,
    code: (o.discountCodes || [])[0] || '',
    source: src.bucket,
    firstTouch: src.firstTouch,
    lastTouch: src.lastTouch,
    campaign: src.campaign,
    content: src.content,
  }
}

export const SOURCE_LABELS = {
  ad: 'Facebook and Instagram ads',
  email: 'Email',
  instagram: 'Instagram (not ads)',
  facebook: 'Facebook (not ads)',
  direct: 'Direct or the website',
  other: 'Other',
  unknown: 'Not tracked',
}

export function bookSummary(rows, { from, to }) {
  const paid = rows.filter((r) => !r.free)
  const free = rows.filter((r) => r.free)
  const blank = () => ({ orders: 0, copies: 0, bookCents: 0, paidCents: 0 })
  const add = (t, r) => { t.orders += 1; t.copies += r.copies; t.bookCents += r.bookCents; t.paidCents += r.paidCents }
  const totals = blank()
  const bySource = {}
  const byFormat = {}
  const byBook = {}
  const byDay = {}
  for (const key of Object.keys(SOURCE_LABELS)) bySource[key] = { ...blank(), label: SOURCE_LABELS[key] }
  for (const r of paid) {
    add(totals, r)
    add(bySource[r.source] || (bySource[r.source] = { ...blank(), label: r.source }), r)
    byDay[r.day] = byDay[r.day] || { day: r.day, orders: 0, copies: 0, bookCents: 0, adOrders: 0 }
    byDay[r.day].orders += 1
    byDay[r.day].copies += r.copies
    byDay[r.day].bookCents += r.bookCents
    if (r.source === 'ad') byDay[r.day].adOrders += 1
    for (const i of r.items) {
      const f = (byFormat[i.format] = byFormat[i.format] || { orders: 0, copies: 0, bookCents: 0 })
      f.orders += 1; f.copies += i.qty; f.bookCents += i.cents
      const b = (byBook[i.book] = byBook[i.book] || { name: BOOKS.find((x) => x.key === i.book)?.name || i.book, copies: 0, bookCents: 0 })
      b.copies += i.qty; b.bookCents += i.cents
    }
  }
  // Every day in the window, so the chart has no gaps.
  const days = []
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10)) {
    days.push(byDay[d] || { day: d, orders: 0, copies: 0, bookCents: 0, adOrders: 0 })
    if (days.length > MAX_DAYS + 2) break
  }
  const ad = bySource.ad
  const adCampaigns = {}
  for (const r of paid.filter((x) => x.source === 'ad')) {
    const k = r.campaign || 'No campaign name'
    adCampaigns[k] = adCampaigns[k] || { campaign: k, orders: 0, copies: 0, bookCents: 0 }
    adCampaigns[k].orders += 1; adCampaigns[k].copies += r.copies; adCampaigns[k].bookCents += r.bookCents
  }
  return {
    totals,
    byFormat,
    byBook,
    bySource,
    daily: days,
    ads: { orders: ad.orders, copies: ad.copies, bookCents: ad.bookCents, paidCents: ad.paidCents, campaigns: Object.values(adCampaigns) },
    free: { orders: free.length, copies: free.reduce((t, r) => t + r.copies, 0), label: 'Free to Max members' },
  }
}

export function resolveBookWindow(query = {}, nowMs = Date.now()) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  const today = sydneyDay(nowMs)
  const to = ok(query.to) ? String(query.to) : today
  const from = ok(query.from) ? String(query.from) : new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86400_000).toISOString().slice(0, 10)
  if (from > to) throw new Error('Use a valid from/to date window')
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000 > MAX_DAYS) throw new Error(`Date window cannot exceed ${MAX_DAYS} days`)
  return { from, to, timezone: 'Australia/Sydney' }
}

const JOURNEY = `customerJourneySummary { ready
  firstVisit { occurredAt source referrerUrl landingPage utmParameters { source medium campaign content } }
  lastVisit { occurredAt source referrerUrl landingPage utmParameters { source medium campaign content } } }`
const query = (journey) => `query($q: String!, $after: String) {
  orders(first: 100, after: $after, sortKey: CREATED_AT, query: $q) { pageInfo { hasNextPage endCursor } nodes {
    name createdAt cancelledAt test displayFinancialStatus discountCodes
    currentTotalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }
    lineItems(first: 15) { nodes { title quantity requiresShipping discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount } } product { handle } } }
    ${journey ? JOURNEY : ''}
  } }
}`

async function fetchOrders(window, deps, journey) {
  // A day either side in UTC, then cut to Sydney days below.
  const start = new Date(Date.parse(`${window.from}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10)
  const end = new Date(Date.parse(`${window.to}T00:00:00Z`) + 2 * 86400_000).toISOString().slice(0, 10)
  const q = `created_at:>=${start} created_at:<${end}`
  const out = []
  let after = null
  for (let i = 0; i < 40; i++) {
    const d = await (deps.shopGql || shopGql)(query(journey), { q, after }, deps)
    out.push(...(d.orders?.nodes || []))
    if (!d.orders?.pageInfo?.hasNextPage) return { nodes: out, complete: true }
    after = d.orders.pageInfo.endCursor
  }
  return { nodes: out, complete: false }
}

export async function bookSalesData(window, { fresh = false, nowMs = Date.now() } = {}, deps = {}) {
  if (!(deps.shopConnected || shopConnected)()) throw Object.assign(new Error('Shopify is not connected'), { code: 'not_connected' })
  const key = `shop:book-sales:${window.from}:${window.to}`
  if (!fresh) {
    const hit = await (deps.kvGetJson || kvGetJson)(key).catch(() => null)
    if (hit?.rows) return { ...hit, cached: true }
  }
  let got
  let journey = true
  let journeyError = ''
  try {
    got = await fetchOrders(window, deps, true)
  } catch (error) {
    // The key may not be allowed to read the visit trail: still give the sales.
    journey = false
    journeyError = String(error?.message || '').slice(0, 160)
    got = await fetchOrders(window, deps, false)
  }
  const rows = got.nodes.map(slimBookOrder).filter((r) => r && r.day >= window.from && r.day <= window.to)
  const data = { at: new Date(nowMs).toISOString(), journey, journeyError, complete: got.complete, rows }
  await (deps.kvSetJson || kvSetJson)(key, data, CACHE_SECONDS).catch(() => {})
  return { ...data, cached: false }
}

export { kvCommand }
