// Shop orders in the portal (Lee, 11 Nov 2026): the sums and the "to post"
// list, without Shopify. Run: node scripts/test-shop-orders.mjs
import assert from 'node:assert/strict'
import { slimOrder, shopSummary, weekStart, sydneyDay, shopConnected, LATE_DAYS } from '../api/_shop-orders.js'

const now = Date.parse('2026-11-11T02:00:00Z') // Wed 11 Nov, 1pm Sydney
const order = (n, iso, status, items, extra = {}) => ({ legacyResourceId: String(n), name: `#${n}`, createdAt: iso, cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: status, currentTotalPriceSet: { shopMoney: { amount: String(items.reduce((t, i) => t + i.a, 0)) } }, totalRefundedSet: { shopMoney: { amount: '0' } }, customer: { displayName: 'C' }, shippingAddress: { countryCodeV2: 'AU' }, lineItems: { nodes: items.map((i) => ({ title: i.t, quantity: i.q || 1, requiresShipping: i.ship !== false, unfulfilledQuantity: status === 'FULFILLED' ? 0 : i.q || 1, originalTotalSet: { shopMoney: { amount: String(i.a) } }, product: { handle: i.t } })) }, fulfillments: [], ...extra })

assert.equal(sydneyDay(now), '2026-11-11')
assert.equal(weekStart('2026-11-11'), '2026-11-09', 'the week starts on Monday')
assert.equal(weekStart('2026-11-09'), '2026-11-09')
assert.equal(weekStart('2026-11-15'), '2026-11-09', 'Sunday belongs to the week that started Monday')

const list = [
  order(1, '2026-11-08T01:00:00Z', 'UNFULFILLED', [{ t: 'Hoodie', a: 89 }]), // Sun, 3 days old: late
  order(2, '2026-11-11T00:30:00Z', 'UNFULFILLED', [{ t: 'Cap', a: 35, q: 2 }]), // today
  order(3, '2026-11-10T03:00:00Z', 'FULFILLED', [{ t: 'Tee', a: 45 }]),
  order(4, '2026-11-10T04:00:00Z', 'UNFULFILLED', [{ t: 'Shorts', a: 47 }], { cancelledAt: '2026-11-10T05:00:00Z' }),
  order(5, '2026-11-10T06:00:00Z', 'UNFULFILLED', [{ t: 'Book PDF', a: 30, ship: false }]), // nothing to post
  order(6, '2026-11-10T07:00:00Z', 'UNFULFILLED', [{ t: 'Tee', a: 45 }], { test: true }),
  order(7, '2026-10-01T00:00:00Z', 'FULFILLED', [{ t: 'Tee', a: 45 }]), // older than 30 days
].map((o) => slimOrder(o, now))

const s = shopSummary(list, now)
assert.deepEqual(s.toPost.map((o) => o.name), ['#1', '#2'], 'only paid orders with items to send, oldest first')
assert.equal(s.late, 1)
assert.equal(LATE_DAYS, 2)
assert.deepEqual(s.today, { orders: 1, cents: 3500 })
assert.equal(s.week.orders, 3, 'Mon to today: Cap, Tee, Book (not the cancelled one, not the test)')
assert.equal(s.week.cents, 3500 + 4500 + 3000)
assert.equal(s.month.orders, 4, 'last 30 days adds Sunday\'s hoodie')
assert.equal(s.top[0].title, 'Cap', 'top product by quantity')
assert.ok(!s.recent.some((o) => o.test), 'test orders never shown')
assert.match(list[0].url, /^https:\/\/7269eh-0c\.myshopify\.com\/admin\/orders\/1$/)
assert.equal(shopConnected({}), false)
assert.equal(shopConnected({ SHOPIFY_CLIENT_ID: 'a', SHOPIFY_CLIENT_SECRET: 'b' }), true)
assert.equal(shopConnected({ SHOPIFY_ADMIN_TOKEN: 'shpat_x' }), true)
console.log('shop orders: 15 checks passed')
