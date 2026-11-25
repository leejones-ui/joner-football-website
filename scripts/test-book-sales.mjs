// Book sales: which orders count, and which source each one lands in.
import assert from 'node:assert/strict'
import { classifyVisit, classifyOrder, slimBookOrder, bookSummary, resolveBookWindow, bookSalesData } from '../api/_book-sales.js'

const money = (a) => ({ shopMoney: { amount: String(a) } })
const visit = (o = {}) => ({ source: 'direct', referrerUrl: null, landingPage: 'https://shop.jonerfootball.com/products/top-50-coaching-drills-paperback', utmParameters: null, ...o })
const order = (o = {}) => ({
  name: '#1', createdAt: '2026-11-25T04:00:00Z', cancelledAt: null, test: false, displayFinancialStatus: 'PAID', discountCodes: [],
  currentTotalPriceSet: money(64.95), totalRefundedSet: money(0),
  lineItems: { nodes: [{ title: 'Top 50 Coaching Drills (Paperback)', quantity: 1, requiresShipping: true, discountedTotalSet: money(55), product: { handle: 'top-50-coaching-drills-paperback' } }] },
  customerJourneySummary: { ready: true, firstVisit: visit(), lastVisit: visit() }, ...o,
})
const adVisit = visit({ source: 'facebook', referrerUrl: 'https://l.facebook.com/', utmParameters: { source: 'facebook', medium: 'paid', campaign: 'top50', content: 'ad1' } })
let n = 0
const check = (name, fn) => { fn(); n += 1; console.log('ok', name) }

check('ad visit from utm tags', () => assert.equal(classifyVisit(adVisit).bucket, 'ad'))
check('ad visit from ids on the landing page', () => assert.equal(classifyVisit(visit({ landingPage: 'https://shop.jonerfootball.com/products/x?campaign_id=1&ad_id=2&fbclid=z' })).bucket, 'ad'))
check('facebook with no paid tag is not an ad', () => assert.equal(classifyVisit(visit({ source: 'https://facebook.com', referrerUrl: 'https://facebook.com' })).bucket, 'facebook'))
check('instagram', () => assert.equal(classifyVisit(visit({ source: 'Instagram', referrerUrl: 'https://instagram.com' })).bucket, 'instagram'))
check('brevo email by tag and by referrer', () => {
  assert.equal(classifyVisit(visit({ utmParameters: { source: 'brevo', medium: 'email' } })).bucket, 'email')
  assert.equal(classifyVisit(visit({ source: 'https://meexl.r.a.d.sendibm1.com/', referrerUrl: 'https://meexl.r.a.d.sendibm1.com/' })).bucket, 'email')
})
check('direct, other, none', () => {
  assert.equal(classifyVisit(visit()).bucket, 'direct')
  assert.equal(classifyVisit(visit({ source: 'Google', referrerUrl: 'https://www.google.com/' })).bucket, 'other')
  assert.equal(classifyVisit(null).bucket, 'none')
})
check('ad first touch, direct last = ad sale', () => assert.equal(classifyOrder({ firstVisit: adVisit, lastVisit: visit() }).bucket, 'ad'))
check('direct first, ad last = ad sale', () => assert.equal(classifyOrder({ firstVisit: visit(), lastVisit: adVisit }).bucket, 'ad'))
check('no trail = not tracked', () => assert.equal(classifyOrder({ firstVisit: null, lastVisit: null }).bucket, 'unknown'))
check('paperback order: book money apart from postage, no private fields', () => {
  const r = slimBookOrder(order())
  assert.equal(r.bookCents, 5500); assert.equal(r.paidCents, 6495); assert.equal(r.items[0].format, 'paperback'); assert.equal(r.day, '2026-11-25')
  assert.deepEqual(Object.keys(r).filter((k) => /name|email|customer|address/i.test(k)), [])
})
check('free member copy is not a sale', () => {
  const r = slimBookOrder(order({ discountCodes: ['MAXBOOK'], currentTotalPriceSet: money(0), lineItems: { nodes: [{ title: 'Top 50 Coaching Drills (PDF, app member early access)', quantity: 1, requiresShipping: false, discountedTotalSet: money(0), product: { handle: 'top-50-coaching-drills-pdf-app-member-early-access' } }] } }))
  assert.equal(r.free, true); assert.equal(r.items[0].format, 'member')
})
check('not a book, test, cancelled, refunded = left out', () => {
  assert.equal(slimBookOrder(order({ lineItems: { nodes: [{ title: 'Cap', quantity: 1, discountedTotalSet: money(40), product: { handle: 'joner-football-hat' } }] } })), null)
  assert.equal(slimBookOrder(order({ test: true })), null)
  assert.equal(slimBookOrder(order({ cancelledAt: '2026-11-25T05:00:00Z' })), null)
  assert.equal(slimBookOrder(order({ displayFinancialStatus: 'REFUNDED' })), null)
})
check('book with a cap: only the book money counts', () => {
  const o = order({ currentTotalPriceSet: money(110) })
  o.lineItems.nodes.push({ title: 'Cap', quantity: 1, discountedTotalSet: money(40), product: { handle: 'joner-football-hat' } })
  const r = slimBookOrder(o)
  assert.equal(r.bookCents, 5500); assert.equal(r.paidCents, 5500)
})
check('summary: totals, sources, free count, every day present', () => {
  const rows = [order(), order({ name: '#2', customerJourneySummary: { firstVisit: adVisit, lastVisit: visit() } }), order({ name: '#3', createdAt: '2026-11-23T04:00:00Z', lineItems: { nodes: [{ title: 'Top 50 Coaching Drills (PDF download)', quantity: 2, requiresShipping: false, discountedTotalSet: money(0), product: { handle: 'top-50-coaching-drills-pdf-download' } }] } })].map(slimBookOrder)
  const s = bookSummary(rows, { from: '2026-11-22', to: '2026-11-25' })
  assert.equal(s.totals.orders, 2); assert.equal(s.totals.bookCents, 11000)
  assert.equal(s.bySource.ad.orders, 1); assert.equal(s.bySource.direct.orders, 1)
  assert.equal(s.ads.orders, 1); assert.equal(s.ads.campaigns[0].campaign, 'top50')
  assert.equal(s.free.orders, 1); assert.equal(s.free.copies, 2)
  assert.equal(s.daily.length, 4); assert.equal(s.daily[3].adOrders, 1)
  assert.equal(s.byFormat.paperback.copies, 2)
})
check('window: default 30 days, limits', () => {
  const w = resolveBookWindow({}, Date.parse('2026-11-25T10:00:00Z'))
  assert.equal(w.to, '2026-11-25'); assert.equal(w.from, '2026-10-27')
  assert.throws(() => resolveBookWindow({ from: '2026-01-01', to: '2026-11-25' }))
  assert.throws(() => resolveBookWindow({ from: '2026-11-26', to: '2026-11-25' }))
})
await (async () => {
  let calls = 0
  const deps = {
    shopConnected: () => true, kvGetJson: async () => null, kvSetJson: async () => {},
    shopGql: async (q) => { calls += 1; if (/customerJourneySummary/.test(q)) throw new Error('Access denied for customerJourneySummary field'); return { orders: { pageInfo: { hasNextPage: false }, nodes: [order({ customerJourneySummary: undefined })] } } },
  }
  const d = await bookSalesData({ from: '2026-11-20', to: '2026-11-25' }, {}, deps)
  assert.equal(d.journey, false); assert.equal(d.rows.length, 1); assert.equal(d.rows[0].source, 'unknown'); assert.equal(calls, 2)
  n += 1; console.log('ok', 'no visit trail access: sales still come back, marked not tracked')
})()
console.log(`${n} book sales checks passed`)
