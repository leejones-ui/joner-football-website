const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Download storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.')
  return { url: url.replace(/\/$/, ''), token }
}

async function kvCommand(command) {
  const { url, token } = getKvConfig()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `KV request failed: ${response.status}`)
  }

  return response.json()
}

function tokenKey(token) {
  return `download:${token}`
}

export async function saveDownloadToken(token, record, ttlSeconds = DEFAULT_TTL_SECONDS) {
  await kvCommand(['SET', tokenKey(token), JSON.stringify(record), 'EX', String(ttlSeconds)])
}

export async function getDownloadToken(token) {
  const data = await kvCommand(['GET', tokenKey(token)])
  if (!data?.result) return null
  try {
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result
  } catch {
    return null
  }
}

export async function updateDownloadToken(token, record) {
  const ttl = await kvCommand(['TTL', tokenKey(token)])
  const ttlSeconds = Number(ttl?.result || DEFAULT_TTL_SECONDS)
  await saveDownloadToken(token, record, ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS)
}
