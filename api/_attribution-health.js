// Shared health and alert state for the attribution system. Everything lives
// in the same KV store as the ledgers so the dashboard can read one source.
const HEALTH_KEY = 'jfa:health'
const ALERTS_KEY = 'jfa:alerts:list'
const TTL = 90 * 24 * 60 * 60

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : undefined
}

async function kv(command, fetchImpl = fetch) {
  const config = kvConfig()
  if (!config) return undefined
  const response = await fetchImpl(config.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`Health KV failed: ${response.status}`)
  return (await response.json())?.result
}

// Fire-and-forget: health markers must never break the money path.
export async function setHealthField(field, value, fetchImpl = fetch) {
  try {
    await kv(['HSET', HEALTH_KEY, String(field), typeof value === 'string' ? value : JSON.stringify(value)], fetchImpl)
  } catch { /* non-fatal */ }
}

export async function bumpHealthCounter(field, by = 1, fetchImpl = fetch) {
  try { await kv(['HINCRBY', HEALTH_KEY, String(field), String(by)], fetchImpl) } catch { /* non-fatal */ }
}

export async function getHealth(fetchImpl = fetch) {
  try {
    const raw = await kv(['HGETALL', HEALTH_KEY], fetchImpl)
    const out = {}
    for (let i = 0; i < (raw || []).length; i += 2) out[raw[i]] = raw[i + 1]
    return out
  } catch { return {} }
}

export async function recordAlert(alert, fetchImpl = fetch) {
  try {
    const record = { ...alert, at: new Date().toISOString() }
    await kv(['LPUSH', ALERTS_KEY, JSON.stringify(record)], fetchImpl)
    await kv(['LTRIM', ALERTS_KEY, '0', '99'], fetchImpl)
    await kv(['EXPIRE', ALERTS_KEY, String(TTL)], fetchImpl)
    return record
  } catch { return undefined }
}

export async function listAlerts(limit = 20, fetchImpl = fetch) {
  try {
    const raw = await kv(['LRANGE', ALERTS_KEY, '0', String(Math.max(0, limit - 1))], fetchImpl)
    return (raw || []).map((item) => { try { return JSON.parse(item) } catch { return undefined } }).filter(Boolean)
  } catch { return [] }
}
