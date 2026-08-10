import crypto from 'node:crypto'

const META_PIXEL_ID = process.env.META_PIXEL_ID || '1025098535155731'
const TEN_YEARS = 10 * 365 * 24 * 60 * 60

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

async function kv(command) {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required')
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!response.ok) throw new Error(`KV request failed: ${response.status}`)
  return (await response.json())?.result
}

function keyForUser(userId) {
  return `jf:meta:first-paid:${sha256(`uscreen:${userId}`)}`
}

function safeSummary(record) {
  const event = record?.metaEvent || {}
  return {
    status: record?.status,
    eventId: record?.eventId,
    uscreenUserId: record?.uscreenUserId,
    eventTime: event.event_time,
    eventName: event.event_name,
    currency: event.custom_data?.currency,
    value: event.custom_data?.value,
    campaignId: event.custom_data?.campaign_id,
    adsetId: event.custom_data?.adset_id,
    adId: event.custom_data?.ad_id,
    placement: event.custom_data?.placement,
    hasEmailHash: Array.isArray(event.user_data?.em) && event.user_data.em.length > 0,
    hasExternalId: Array.isArray(event.user_data?.external_id) && event.user_data.external_id.length > 0,
    hasFbc: Boolean(event.user_data?.fbc),
    hasFbp: Boolean(event.user_data?.fbp),
  }
}

async function main() {
  const [action, userId, confirmation] = process.argv.slice(2)
  if (!['inspect', 'send', 'suppress'].includes(action) || !userId) {
    throw new Error('Usage: first-paid-candidate.mjs inspect|send|suppress <uscreen-user-id> [confirmation]')
  }
  const key = keyForUser(userId)
  const raw = await kv(['GET', key])
  if (!raw) throw new Error('No first-paid candidate found for that Uscreen user ID')
  const record = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (String(record.uscreenUserId) !== String(userId)) throw new Error('Candidate identity mismatch')

  if (action === 'inspect') {
    console.log(JSON.stringify(safeSummary(record), null, 2))
    return
  }

  if (record.status !== 'candidate') throw new Error(`Candidate is not awaiting verification: ${record.status}`)

  if (action === 'suppress') {
    if (confirmation !== '--confirm-known-prior') throw new Error('Suppression requires --confirm-known-prior')
    const updated = { ...record, status: 'suppressed', suppressedAt: new Date().toISOString() }
    await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
    console.log(JSON.stringify({ status: 'suppressed', eventId: record.eventId }))
    return
  }

  if (confirmation !== '--confirm-verified-first-paid') {
    throw new Error('Sending requires --confirm-verified-first-paid after Uscreen payment-history verification')
  }
  const event = record.metaEvent
  if (!event || event.event_name !== 'JF_First_Paid_Membership' || event.event_id !== record.eventId) {
    throw new Error('Stored candidate payload is invalid')
  }
  const token = process.env.META_CAPI_TOKEN
  if (!token) throw new Error('META_CAPI_TOKEN is required')
  const response = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: [event] }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Meta CAPI rejected the candidate: ${response.status}`)
  const updated = { ...record, status: 'sent', sentAt: new Date().toISOString() }
  await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
  console.log(JSON.stringify({ status: 'sent', eventId: record.eventId, metaStatus: response.status, responseReceived: Boolean(body) }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
