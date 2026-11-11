// Shop orders in the Joner Football Portal (Lee, 11 Nov 2026: "build orders
// into the Joner portal so that myself and Ligia just have all things Joner
// football in one place"). Read only: sales today / this week / 30 days, the
// orders still to post (red after 2 days), top products this week, and the
// latest orders, each linking to the order in Shopify admin.
//
// Access: a Dev Dashboard app on the Joner store with read_orders and
// read_products. Its client ID and secret (Vercel env SHOPIFY_CLIENT_ID,
// SHOPIFY_CLIENT_SECRET) are swapped for a 24 hour Admin API token by the
// client credentials grant; the token is kept in KV for 23 hours. An older
// admin-made app token (SHOPIFY_ADMIN_TOKEN, shpat_...) also works.
// Shopify stopped letting stores make new admin-made apps in 2026.
import { kvCommand, kvGetJson, kvSetJson } from './_holiday-store.js'

// The store's real Shopify address (shop.jonerfootball.com is the shop front).
export const SHOP = (process.env.SHOPIFY_SHOP || '7269eh-0c').replace(/\.myshopify\.com$/, '')
const API_VERSION = '2026-01'
const TOKEN_KEY = 'shop:admin-token'
const CACHE_KEY = 'shop:orders'
const CACHE_SECONDS = 120
export const LATE_DAYS = 2

export function shopConnected(env = process.env) {
  return Boolean(env.SHOPIFY_ADMIN_TOKEN || (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET))
}
export const adminOrderUrl = (legacyId) => `https://${SHOP}.myshopify.com/admin/orders/${legacyId}`

async function adminToken({ fresh = false } = {}, deps = {}) {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN
  const get = deps.kvGetJson || kvGetJson
  if (!fresh) {
    const hit = await get(TOKEN_KEY).catch(() => null)
    if (hit?.token && hit.expiresAt > Date.now() + 60_000) return hit.token
  }
  const res = await (deps.fetch || fetch)(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID || '', client_secret: process.env.SHOPIFY_CLIENT_SECRET || '' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error(`Shopify would not give a token (${res.status}${data.error ? `: ${String(data.error_description || data.error).slice(0, 80)}` : ''}). Check the app is installed on the store.`)
  const ttl = Math.max(60, Math.min(Number(data.expires_in) || 86399, 86399) - 3600)
  await (deps.kvSetJson || kvSetJson)(TOKEN_KEY, { token: data.access_token, expiresAt: Date.now() + ttl * 1000 }, ttl).catch(() => {})
  return data.access_token
}

export async function shopGql(query, variables = {}, deps = {}) {
  const call = async (token) => (deps.fetch || fetch)(`https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  })
  let res = await call(await adminToken({}, deps))
  // A token Shopify has dropped: get a new one once.
  if (res.status === 401 && !process.env.SHOPIFY_ADMIN_TOKEN) res = await call(await adminToken({ fresh: true }, deps))
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.errors?.length) throw new Error(`Shopify answered ${res.status}${data.errors?.[0]?.message ? `: ${String(data.errors[0].message).slice(0, 100)}` : ''}`)
  return data.data
}

const ORDER_FIELDS = `
  id legacyResourceId name createdAt cancelledAt test displayFinancialStatus displayFulfillmentStatus
  currentTotalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }
  customer { displayName } shippingAddress { countryCodeV2 city provinceCode }
  lineItems(first: 30) { nodes { title variantTitle quantity requiresShipping unfulfilledQuantity originalTotalSet { shopMoney { amount } } product { handle } } }
  fulfillments(first: 3) { createdAt trackingInfo(first: 1) { number company url } }`
// Pages of 100 (Shopify's most per page). Recent: the last 35 days.
// Open: every order still to post, however old.
const PAGE_QUERY = `query($q: String!, $after: String, $reverse: Boolean!) {
  shop { currencyCode }
  orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: $reverse, query: $q) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } }
}`
async function allOrders(q, reverse, deps, maxPages = 5) {
  const out = []
  let after = null, currency = 'AUD'
  for (let i = 0; i < maxPages; i++) {
    const d = await shopGql(PAGE_QUERY, { q, after, reverse }, deps)
    currency = d.shop?.currencyCode || currency
    out.push(...(d.orders?.nodes || []))
    if (!d.orders?.pageInfo?.hasNextPage) break
    after = d.orders.pageInfo.endCursor
  }
  return { nodes: out, currency }
}

const cents = (m) => Math.round(Number(m?.shopMoney?.amount || 0) * 100)
// Sydney calendar date of an instant.
export function sydneyDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)
// Monday of this week in Sydney.
export function weekStart(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  return addDays(today, -((dow + 6) % 7))
}

export function slimOrder(o, nowMs = Date.now()) {
  const items = (o.lineItems?.nodes || []).map((li) => ({ title: li.title, variant: li.variantTitle || '', qty: li.quantity, toShip: li.requiresShipping ? Math.max(0, Number(li.unfulfilledQuantity ?? li.quantity)) : 0, cents: cents(li.originalTotalSet), handle: li.product?.handle || '' }))
  const toShip = items.reduce((t, i) => t + i.toShip, 0)
  const tracking = (o.fulfillments || []).flatMap((f) => f.trackingInfo || []).find((t) => t?.number) || null
  const ageDays = Math.floor((nowMs - Date.parse(o.createdAt)) / 86400_000)
  const open = !o.cancelledAt && !o.test && toShip > 0 && !/^(FULFILLED|RESTOCKED)$/.test(o.displayFulfillmentStatus || '') && !/REFUNDED|VOIDED/.test(o.displayFinancialStatus || '')
  return {
    id: o.legacyResourceId, name: o.name, createdAt: o.createdAt, day: sydneyDay(Date.parse(o.createdAt)), customer: o.customer?.displayName || '',
    country: o.shippingAddress?.countryCodeV2 || '', place: [o.shippingAddress?.city, o.shippingAddress?.provinceCode].filter(Boolean).join(', '),
    totalCents: cents(o.currentTotalPriceSet), refundedCents: cents(o.totalRefundedSet), paid: o.displayFinancialStatus || '', fulfilment: o.displayFulfillmentStatus || '',
    cancelled: Boolean(o.cancelledAt), test: Boolean(o.test), items, toShip, toPost: open, ageDays, late: open && ageDays >= LATE_DAYS,
    tracking: tracking ? { number: tracking.number, company: tracking.company || '', url: tracking.url || '' } : null,
    url: adminOrderUrl(o.legacyResourceId),
  }
}

// Totals from the slim orders (pure, so it is tested without Shopify).
export function shopSummary(orders, nowMs = Date.now()) {
  const today = sydneyDay(nowMs)
  const week = weekStart(today)
  const month = addDays(today, -29)
  const real = orders.filter((o) => !o.test && !o.cancelled)
  const sum = (list) => ({ orders: list.length, cents: list.reduce((t, o) => t + o.totalCents, 0) })
  const top = new Map()
  for (const o of real.filter((x) => x.day >= week)) for (const i of o.items) {
    const k = i.handle || i.title
    const t = top.get(k) || { title: i.title, qty: 0, cents: 0 }
    t.qty += i.qty; t.cents += i.cents
    top.set(k, t)
  }
  const toPost = orders.filter((o) => o.toPost).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    today: sum(real.filter((o) => o.day === today)),
    week: { ...sum(real.filter((o) => o.day >= week)), from: week },
    month: { ...sum(real.filter((o) => o.day >= month)), from: month },
    toPost, late: toPost.filter((o) => o.late).length,
    top: [...top.values()].sort((a, b) => b.qty - a.qty || b.cents - a.cents).slice(0, 5),
    recent: orders.filter((o) => !o.test).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25),
  }
}

export async function shopOrdersData({ fresh = false, nowMs = Date.now() } = {}, deps = {}) {
  if (!shopConnected(deps.env || process.env)) return { connected: false, shop: SHOP }
  const get = deps.kvGetJson || kvGetJson
  if (!fresh) {
    const hit = await get(CACHE_KEY).catch(() => null)
    if (hit?.orders) return { connected: true, shop: SHOP, at: hit.at, ...shopSummary(hit.orders, nowMs) }
  }
  const since = new Date(nowMs - 35 * 86400_000).toISOString()
  const [recent, open] = await Promise.all([allOrders(`created_at:>=${since}`, true, deps), allOrders('status:open fulfillment_status:unshipped', false, deps)])
  const byId = new Map()
  for (const o of [...recent.nodes, ...open.nodes]) byId.set(o.legacyResourceId, slimOrder(o, nowMs))
  const orders = [...byId.values()]
  const at = new Date(nowMs).toISOString()
  await (deps.kvSetJson || kvSetJson)(CACHE_KEY, { at, orders }, CACHE_SECONDS).catch(() => {})
  return { connected: true, shop: SHOP, at, currency: recent.currency, ...shopSummary(orders, nowMs) }
}

// The sidebar's red count: orders still to post. Never throws.
export async function shopToPostCount() {
  try {
    const d = await shopOrdersData()
    return d.connected ? { count: d.toPost.length, late: d.late } : { count: 0, late: 0, off: true }
  } catch { return { count: 0, late: 0, error: true } }
}

export { kvCommand }
