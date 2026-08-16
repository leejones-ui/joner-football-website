import crypto from 'node:crypto'

export const MAX_DETAILED_SALES = 50
const TTL = 10 * 365 * 24 * 60 * 60
const salesIndexKey = 'jfa:reliability:sales:index'
const failuresKey = 'jfa:reliability:webhook:failures'
const aggregateKey = 'jfa:reliability:anonymous:aggregates'
const paymentClaimKey = (id) => `jfa:reliability:payment:${id}`
const saleKey = (id) => `jfa:reliability:sale:${id}`
const failureKey = (id) => `jfa:reliability:webhook:${id}`

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Reliability KV is not configured')
  return { url: url.replace(/\/$/, ''), token }
}
export async function reliabilityKv(command, fetchImpl = fetch) {
  const { url, token } = config()
  const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  if (!response.ok) throw new Error(`Reliability KV failed: ${response.status}`)
  return response.json()
}
const resultOf = async (cmd, fetchImpl) => (await reliabilityKv(cmd, fetchImpl))?.result
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null } }
const cleanId = (value) => String(value || '').trim().slice(0, 180)
export function reliablePaymentIdentity(sale) {
  const providerId = cleanId(
    sale.provider_payment_id || sale.payment_id
    || sale.provider_invoice_id || sale.invoice_id
    || sale.provider_order_id || sale.order_id
    || sale.provider_sale_id,
  )
  if (!providerId) return ''
  return providerId
}

function meaningful(value) {
  const text = cleanId(value).toLowerCase()
  return Boolean(text && !['unknown', 'none', 'null', 'direct', 'no_safe_join'].includes(text))
}

function mergeReliableSale(existing, incoming) {
  const patch = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  const merged = {
    ...(existing || {}),
    ...patch,
    sale_id: incoming.sale_id,
    ledger_version: 1,
    persisted_at: existing?.persisted_at || incoming.persisted_at,
    updated_at: new Date().toISOString(),
  }
  if (meaningful(existing?.acquisition) && !meaningful(incoming?.acquisition)) merged.acquisition = existing.acquisition
  return merged
}

export async function appendReliableSale(sale, fetchImpl = fetch) {
  const paymentIdentity = reliablePaymentIdentity(sale)
  if (!paymentIdentity) throw new Error('payment identity is required')
  const saleId = cleanId(sale.sale_id) || paymentIdentity
  const record = { ...sale, sale_id: saleId, ledger_version: 1, persisted_at: new Date().toISOString() }
  const claimed = await resultOf(['SET', saleKey(saleId), JSON.stringify(record), 'NX', 'EX', String(TTL)], fetchImpl)
  if (claimed !== 'OK') {
    // Authoritative reconciliation may learn missing currency/provider fields
    // after the webhook's first write. Backfill those fields without allowing
    // an "unknown" retry to erase a previously verified acquisition source.
    const existing = parse(await resultOf(['GET', saleKey(saleId)], fetchImpl))
    const merged = mergeReliableSale(existing, record)
    await resultOf(['SET', saleKey(saleId), JSON.stringify(merged), 'EX', String(TTL)], fetchImpl)
    await reliabilityKv(['ZADD', salesIndexKey, String(Date.parse(merged.occurred_at) || Date.now()), saleId], fetchImpl)
    // A prior attempt may have persisted the sale but failed while updating
    // anonymous aggregates; the aggregate claim makes this safe to retry.
    await updateAnonymousAggregate(merged, fetchImpl)
    return { ...merged, duplicate: true }
  }
  try {
    await reliabilityKv(['ZADD', salesIndexKey, String(Date.parse(record.occurred_at) || Date.now()), saleId], fetchImpl)
    await trimDetailedSales(fetchImpl)
  } catch (error) {
    // The sale record is the source of truth. listReliableSales repairs the
    // secondary index, so a partial index write cannot lose the sale.
    throw Object.assign(new Error('Sale persisted but index repair is pending'), { cause: error, saleId })
  }
  await updateAnonymousAggregate(record, fetchImpl)
  return { ...record, duplicate: false }
}

async function trimDetailedSales(fetchImpl) {
  const ids = await resultOf(['ZRANGE', salesIndexKey, '0', String(-(MAX_DETAILED_SALES + 1))], fetchImpl)
  const stale = Array.isArray(ids) ? ids : []
  if (!stale.length) return
  await reliabilityKv(['ZREM', salesIndexKey, ...stale], fetchImpl)
  await reliabilityKv(['DEL', ...stale.map(saleKey)], fetchImpl)
}

async function scanSaleKeys(fetchImpl) {
  const raw = await resultOf(['SCAN', '0', 'MATCH', 'jfa:reliability:sale:*', 'COUNT', '200'], fetchImpl)
  const keys = Array.isArray(raw) ? raw[1] : []
  const rows = []
  for (const key of keys || []) { const row = parse(await resultOf(['GET', key], fetchImpl)); if (row) rows.push(row) }
  return rows
}

export async function listReliableSales(fetchImpl = fetch) {
  const indexed = await resultOf(['ZREVRANGE', salesIndexKey, '0', String(MAX_DETAILED_SALES - 1)], fetchImpl)
  const ids = Array.isArray(indexed) ? indexed : []
  const byId = new Map()
  for (const id of ids) { const row = parse(await resultOf(['GET', saleKey(id)], fetchImpl)); if (row) byId.set(row.sale_id, row) }
  // Self-healing: recover records written before an index failure.
  for (const row of await scanSaleKeys(fetchImpl)) byId.set(row.sale_id, row)
  const rows = [...byId.values()].sort((a,b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))).slice(0, MAX_DETAILED_SALES)
  for (const row of rows) await reliabilityKv(['ZADD', salesIndexKey, String(Date.parse(row.occurred_at) || Date.now()), row.sale_id], fetchImpl)
  return rows
}

export async function recordWebhookFailure(failure, fetchImpl = fetch) {
  const eventId = cleanId(failure.event_id) || crypto.randomUUID()
  const record = { ...failure, event_id: eventId, status: 'dead_letter', attempts: Number(failure.attempts || 1), recorded_at: new Date().toISOString() }
  const claimed = await resultOf(['SET', failureKey(eventId), JSON.stringify(record), 'NX', 'EX', String(TTL)], fetchImpl)
  if (claimed === 'OK') await reliabilityKv(['LPUSH', failuresKey, eventId], fetchImpl)
  return record
}
export async function listWebhookFailures(fetchImpl = fetch) {
  const ids = await resultOf(['LRANGE', failuresKey, '0', '99'], fetchImpl)
  const rows = []
  for (const id of (ids || [])) { const row = parse(await resultOf(['GET', failureKey(id)], fetchImpl)); if (row && row.status !== 'replayed') rows.push(row) }
  return rows
}
export async function replayWebhookFailure(eventId, processor, fetchImpl = fetch) {
  const record = parse(await resultOf(['GET', failureKey(cleanId(eventId))], fetchImpl))
  if (!record) return { status: 'not_found' }
  if (record.status === 'replayed') return record
  try { const result = await processor(record.payload); const next = { ...record, status: 'replayed', replayed_at: new Date().toISOString(), replay_result: result }; await reliabilityKv(['SET', failureKey(record.event_id), JSON.stringify(next), 'EX', String(TTL)], fetchImpl); return next }
  catch (error) { const next = { ...record, attempts: record.attempts + 1, error: String(error?.message || error) }; await reliabilityKv(['SET', failureKey(record.event_id), JSON.stringify(next), 'EX', String(TTL)], fetchImpl); return next }
}

function channelOf(sale) { return String(sale.acquisition || sale.channel || sale.billing_origin || 'unknown').toLowerCase().replace(/[^a-z0-9_:-]/g, '_').slice(0, 50) || 'unknown' }
async function updateAnonymousAggregate(sale, fetchImpl) {
  const paymentId = reliablePaymentIdentity(sale)
  // Before 2026-08-16 the claim key included the event kind. Migrate that
  // claim lazily so reconciliation cannot count an already-recorded payment
  // again after identity was tightened to the authoritative provider ID.
  const legacyKind = cleanId(sale.kind || 'payment').toLowerCase() || 'payment'
  const legacyKinds = [...new Set(['payment', 'renewal', 'refund', legacyKind])]
  const legacyClaims = await resultOf(['MGET', ...legacyKinds.map((kind) => paymentClaimKey(`${kind}:${paymentId}`))], fetchImpl)
  if (Array.isArray(legacyClaims) && legacyClaims.some(Boolean)) {
    await resultOf(['SET', paymentClaimKey(paymentId), '1', 'NX', 'EX', String(TTL)], fetchImpl)
    return false
  }
  const claimed = await resultOf(['SET', paymentClaimKey(paymentId), '1', 'NX', 'EX', String(TTL)], fetchImpl)
  if (claimed !== 'OK') return false
  const amount = Number(sale.amount || 0)
  const channel = channelOf(sale)
  await reliabilityKv(['HINCRBY', `${aggregateKey}:${channel}`, 'count', '1'], fetchImpl)
  await reliabilityKv(['HINCRBY', `${aggregateKey}:${channel}`, 'revenue_cents', String(Math.round(amount * 100))], fetchImpl)
  return true
}
export async function getAnonymousAggregates(fetchImpl = fetch) {
  const raw = await resultOf(['SCAN', '0', 'MATCH', `${aggregateKey}:*`, 'COUNT', '200'], fetchImpl)
  const out = {}
  for (const key of (Array.isArray(raw) ? raw[1] : [])) { const values = await resultOf(['HGETALL', key], fetchImpl); const map = {}; for (let i=0;i<(values||[]).length;i+=2) map[values[i]]=Number(values[i+1]); const channel=key.slice(`${aggregateKey}:`.length); out[channel]={ count: map.count || 0, revenue: (map.revenue_cents || 0)/100 } }
  return out
}
export async function reconcileAuthoritativePayments(payments, fetchImpl = fetch) {
  const results = []
  for (const payment of payments || []) results.push(await appendReliableSale({ ...payment, sale_id: reliablePaymentIdentity(payment), kind: payment.kind || 'payment', acquisition: channelOf(payment) }, fetchImpl))
  return results
}
