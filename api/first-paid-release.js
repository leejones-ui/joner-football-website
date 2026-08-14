import crypto from 'node:crypto'

const EXPECTED_META_PIXEL_ID = '232666285545279'
const SEND_LOCK_SECONDS = 5 * 60
const TEN_YEARS = 10 * 365 * 24 * 60 * 60

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function keyForUser(userId) {
  return `jf:meta:first-paid:${sha256(`uscreen:${userId}`)}`
}

function authorized(req) {
  const expected = process.env.ATTRIBUTION_REPORT_TOKEN || process.env.OWNER_API_TOKEN
  const actual = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
  if (!expected || !actual) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function kv(command) {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new Error('KV is not configured')
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`KV request failed: ${response.status}`)
  return (await response.json())?.result
}

function parseRecord(raw) {
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }
  if (!authorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })

  const userId = String(req.body?.uscreen_user_id || '').trim()
  const confirmation = String(req.body?.confirmation || '')
  if (!/^\d+$/.test(userId) || confirmation !== 'confirm-verified-first-paid') {
    return res.status(400).json({ success: false, error: 'Explicit verified release confirmation required' })
  }

  const pixelId = process.env.META_PIXEL_ID || EXPECTED_META_PIXEL_ID
  if (pixelId !== EXPECTED_META_PIXEL_ID) {
    return res.status(500).json({ success: false, error: 'Unexpected Meta Pixel configuration' })
  }
  if (!process.env.META_CAPI_TOKEN) {
    return res.status(500).json({ success: false, error: 'Meta CAPI is not configured' })
  }

  const key = keyForUser(userId)
  const lockKey = `${key}:send-lock`
  const lockToken = crypto.randomUUID()
  const lock = await kv(['SET', lockKey, lockToken, 'NX', 'EX', SEND_LOCK_SECONDS])
  if (lock !== 'OK') return res.status(409).json({ success: false, error: 'Release already in progress' })

  try {
    const current = parseRecord(await kv(['GET', key]))
    if (!current || current.status !== 'verified') {
      return res.status(409).json({ success: false, error: 'Candidate is not in verified state' })
    }
    if (String(current.uscreenUserId) !== userId) {
      return res.status(409).json({ success: false, error: 'Candidate identity mismatch' })
    }
    if (current.reconciliation?.historyComplete !== true || current.reconciliation?.channel !== 'web') {
      return res.status(409).json({ success: false, error: 'Authoritative web payment reconciliation is incomplete' })
    }

    const event = current.metaEvent
    const expectedEventId = `JF_First_Paid_Membership.${sha256(`uscreen:${userId}`)}`
    if (!event || event.event_name !== 'JF_First_Paid_Membership' || event.event_id !== current.eventId || event.event_id !== expectedEventId) {
      return res.status(409).json({ success: false, error: 'Stable candidate identity validation failed' })
    }
    if (!/^[A-Z]{3}$/.test(String(event.custom_data?.currency || '')) || !(Number(event.custom_data?.value) > 0)) {
      return res.status(409).json({ success: false, error: 'Authoritative value or currency is invalid' })
    }

    const metaResponse = await fetch(`https://graph.facebook.com/v21.0/${EXPECTED_META_PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
    })
    const rawReceipt = await metaResponse.text()
    if (!metaResponse.ok) return res.status(502).json({ success: false, error: `Meta CAPI rejected release: ${metaResponse.status}` })

    let receipt
    try { receipt = JSON.parse(rawReceipt) } catch { return res.status(502).json({ success: false, error: 'Meta CAPI receipt was unreadable' }) }
    if (Number(receipt?.events_received) !== 1) {
      return res.status(502).json({ success: false, error: 'Meta did not confirm exactly one event' })
    }

    const updated = {
      ...current,
      status: 'sent',
      sentAt: new Date().toISOString(),
      metaEventsReceived: 1,
      metaTestEvent: false,
    }
    await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
    return res.status(200).json({
      success: true,
      status: 'sent',
      event_id: current.eventId,
      currency: event.custom_data.currency,
      value: event.custom_data.value,
      events_received: 1,
    })
  } catch (error) {
    console.error('First-paid release failed:', error?.message || error)
    return res.status(500).json({ success: false, error: 'First-paid release failed' })
  } finally {
    const activeLock = await kv(['GET', lockKey]).catch(() => undefined)
    if (activeLock === lockToken) await kv(['DEL', lockKey]).catch(() => undefined)
  }
}
