import crypto from 'node:crypto'
import fs from 'node:fs'
import { reconcileAuthoritativeFirstPaid } from './lib/first-paid-reconciliation.mjs'

const EXPECTED_META_PIXEL_ID = '232666285545279'
const META_PIXEL_ID = process.env.META_PIXEL_ID || EXPECTED_META_PIXEL_ID
const META_GRAPH_BASE_URL = process.env.NODE_ENV === 'test' && process.env.META_GRAPH_BASE_URL
  ? process.env.META_GRAPH_BASE_URL.replace(/\/$/, '')
  : 'https://graph.facebook.com/v21.0'
const TEN_YEARS = 10 * 365 * 24 * 60 * 60
const SEND_LOCK_SECONDS = 5 * 60
const RECONCILE_CONFIRMATION = '--confirm-authoritative-uscreen-history'
const SEND_CONFIRMATION = '--confirm-verified-first-paid'

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
    invoiceId: record?.reconciliation?.invoiceId,
    paymentId: record?.reconciliation?.paymentId,
    paymentChannel: record?.reconciliation?.channel,
    historyComplete: record?.reconciliation?.historyComplete,
    campaignId: event.custom_data?.campaign_id,
    adsetId: event.custom_data?.adset_id,
    adId: event.custom_data?.ad_id,
    placement: event.custom_data?.placement,
    hasEmailHash: Array.isArray(event.user_data?.em) && event.user_data.em.length > 0,
    hasExternalId: Array.isArray(event.user_data?.external_id) && event.user_data.external_id.length > 0,
    hasFbc: Boolean(event.user_data?.fbc),
    hasFbp: Boolean(event.user_data?.fbp),
    metaEventsReceived: record?.metaEventsReceived,
  }
}

function loadEvidence(path) {
  let raw
  try { raw = fs.readFileSync(path, 'utf8') } catch { throw new Error('Could not read Uscreen evidence file') }
  let evidence
  try { evidence = JSON.parse(raw) } catch { throw new Error('Uscreen evidence file must be valid JSON') }
  return { evidence, evidenceHash: sha256(raw) }
}

function parseTestEventCode(args) {
  const item = args.find((arg) => String(arg).startsWith('--test-event-code='))
  if (!item) return undefined
  const value = item.slice('--test-event-code='.length).trim()
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(value)) throw new Error('Invalid Meta test event code')
  return value
}

async function main() {
  const [action, userId, ...args] = process.argv.slice(2)
  if (!['inspect', 'reconcile', 'send', 'suppress'].includes(action) || !userId) {
    throw new Error('Usage: first-paid-candidate.mjs inspect|reconcile|send|suppress <uscreen-user-id> [arguments]')
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

  if (action === 'suppress') {
    if (!['candidate', 'verified'].includes(record.status)) throw new Error(`Candidate cannot be suppressed from status: ${record.status}`)
    if (!args.includes('--confirm-known-prior')) throw new Error('Suppression requires --confirm-known-prior')
    const updated = { ...record, status: 'suppressed', suppressedAt: new Date().toISOString() }
    await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
    console.log(JSON.stringify({ status: 'suppressed', eventId: record.eventId }))
    return
  }

  if (action === 'reconcile') {
    if (record.status !== 'candidate') throw new Error(`Candidate is not awaiting reconciliation: ${record.status}`)
    const [evidencePath, invoiceId] = args.filter((arg) => !arg.startsWith('--'))
    if (!evidencePath || !invoiceId || !args.includes(RECONCILE_CONFIRMATION)) {
      throw new Error(`Reconciliation requires <evidence.json> <invoice-id> ${RECONCILE_CONFIRMATION}`)
    }
    const { evidence, evidenceHash } = loadEvidence(evidencePath)
    const result = reconcileAuthoritativeFirstPaid({ expectedUserId: userId, invoiceId, evidence })
    if (!result.eligible) throw new Error(`Uscreen reconciliation rejected candidate: ${result.reason}`)
    if (record.offerId && String(record.offerId) !== result.offerId) throw new Error('Uscreen invoice offer does not match webhook offer')
    const expectedEventId = `JF_First_Paid_Membership.${sha256(`uscreen:${userId}`)}`
    const event = record.metaEvent
    if (!event || event.event_name !== 'JF_First_Paid_Membership' || event.event_id !== record.eventId || event.event_id !== expectedEventId) {
      throw new Error('Stored candidate event ID is not tied to the Uscreen user ID')
    }
    const paidAtSeconds = Math.floor(Date.parse(result.paidAt) / 1000)
    if (!Number.isFinite(paidAtSeconds)) throw new Error('Authoritative invoice paid time is invalid')
    const correctedEvent = {
      ...event,
      event_time: paidAtSeconds,
      custom_data: {
        ...event.custom_data,
        value: result.value,
        currency: result.currency,
        payment_channel: result.channel,
      },
    }
    const updated = {
      ...record,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      metaEvent: correctedEvent,
      reconciliation: {
        invoiceId: result.invoiceId,
        paymentId: result.paymentId,
        offerId: result.offerId,
        channel: result.channel,
        provider: result.provider,
        currency: result.currency,
        value: result.value,
        paidAt: result.paidAt,
        historyComplete: true,
        evidenceHash,
      },
    }
    await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
    console.log(JSON.stringify(safeSummary(updated), null, 2))
    return
  }

  if (record.status !== 'verified') throw new Error(`Candidate is not verified against full Uscreen history: ${record.status}`)
  if (!args.includes(SEND_CONFIRMATION)) {
    throw new Error(`Sending requires ${SEND_CONFIRMATION} after authoritative Uscreen reconciliation`)
  }
  if (META_PIXEL_ID !== EXPECTED_META_PIXEL_ID) throw new Error(`Refusing to send to unexpected Meta Pixel: ${META_PIXEL_ID}`)

  const testEventCode = parseTestEventCode(args)
  const lockKey = `${key}:send-lock`
  const lockToken = crypto.randomUUID()
  const lock = await kv(['SET', lockKey, lockToken, 'NX', 'EX', SEND_LOCK_SECONDS])
  if (lock !== 'OK') throw new Error('Candidate send already in progress')

  try {
    const currentRaw = await kv(['GET', key])
    if (!currentRaw) throw new Error('Candidate disappeared before send')
    const current = typeof currentRaw === 'string' ? JSON.parse(currentRaw) : currentRaw
    if (current.status !== 'verified') throw new Error(`Candidate is not verified before send: ${current.status}`)
    if (String(current.uscreenUserId) !== String(userId)) throw new Error('Candidate identity mismatch before send')
    if (!current.reconciliation?.historyComplete || current.reconciliation?.channel !== 'web') {
      throw new Error('Candidate lacks authoritative web payment reconciliation')
    }
    const event = current.metaEvent
    const expectedEventId = `JF_First_Paid_Membership.${sha256(`uscreen:${userId}`)}`
    if (!event || event.event_name !== 'JF_First_Paid_Membership' || event.event_id !== current.eventId || event.event_id !== expectedEventId) {
      throw new Error('Stored candidate event ID is not tied to the Uscreen user ID')
    }
    if (!/^[A-Z]{3}$/.test(String(event.custom_data?.currency || '')) || !(Number(event.custom_data?.value) > 0)) {
      throw new Error('Candidate value/currency is not authoritative')
    }
    const token = process.env.META_CAPI_TOKEN
    if (!token) throw new Error('META_CAPI_TOKEN is required')
    const payload = { data: [event] }
    if (testEventCode) payload.test_event_code = testEventCode
    const response = await fetch(`${META_GRAPH_BASE_URL}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`Meta CAPI rejected the candidate: ${response.status}`)
    let receipt
    try { receipt = JSON.parse(body) } catch { throw new Error('Meta CAPI returned an unreadable success response') }
    if (Number(receipt?.events_received) !== 1) throw new Error('Meta CAPI did not confirm exactly one received event')
    const updated = {
      ...current,
      status: 'sent',
      sentAt: new Date().toISOString(),
      metaEventsReceived: 1,
      metaTestEvent: Boolean(testEventCode),
    }
    await kv(['SET', key, JSON.stringify(updated), 'EX', TEN_YEARS])
    console.log(JSON.stringify({
      status: 'sent', eventId: current.eventId, value: event.custom_data.value,
      currency: event.custom_data.currency, metaStatus: response.status, eventsReceived: 1,
      testEvent: Boolean(testEventCode),
    }))
  } finally {
    const activeLock = await kv(['GET', lockKey]).catch(() => undefined)
    if (activeLock === lockToken) await kv(['DEL', lockKey]).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
