import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import crypto from 'node:crypto'

async function kvCommand(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('queue_configuration')
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(1200), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  if (!response.ok) throw new Error('queue_unavailable')
  const data = await response.json()
  if (data.error) throw new Error('queue_unavailable')
  return data.result
}

export const MASTER_BASE_ID = 'apphU4R0BtVIu5YqT'
export const MASTER_TABLE_ID = 'tblpG1ONWlnNcpt0p'
export const USA_TABLE_ID = 'tblokhiB50ouldnAu'
const OUTBOX_INDEX_KEY = 'master-contact-capture:outbox:index'
const OUTBOX_PREFIX = 'master-contact-capture:outbox:'
const DEFAULT_BATCH = 'website-form-capture'

const COUNTRY_NAMES = { australia: 'AU', au: 'AU', 'australia/au': 'AU', unitedstates: 'US', 'united states': 'US', usa: 'US', us: 'US', canada: 'CA', ca: 'CA', 'united kingdom': 'GB', uk: 'GB', gb: 'GB', newzealand: 'NZ', nz: 'NZ' }
const COUNTRY_CALLING_CODES = { '+61': 'AU', '+44': 'GB', '+64': 'NZ', '+33': 'FR', '+49': 'DE', '+81': 'JP', '+86': 'CN', '+91': 'IN', '+27': 'ZA', '+971': 'AE', '+65': 'SG' }

function clean(value, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) }
function unique(values) { return [...new Set(values.map((v) => clean(v, 500)).filter(Boolean))] }
function formulaValue(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") }

export function explicitCountry(input = {}) {
  const raw = clean(input.country || input.countryCode || input.region || '', 40).toLowerCase()
  if (COUNTRY_NAMES[raw]) return COUNTRY_NAMES[raw]
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase()
  if (COUNTRY_CALLING_CODES[raw]) return COUNTRY_CALLING_CODES[raw]
  return null
}

export function normalisePhone(rawPhone, input = {}) {
  const raw = clean(rawPhone, 80)
  if (!raw) return { ok: false, reason: 'missing_phone' }
  const country = explicitCountry(input)
  // A leading + contains its own country code. National numbers require an
  // explicit region; +1 is deliberately never treated as US.
  const parsed = parsePhoneNumberFromString(raw.replace(/^00/, '+'), { defaultCountry: country || undefined, extract: false })
  if (!parsed?.isValid() || parsed.ext || !parsed.country) return { ok: false, reason: 'invalid_phone' }
  return { ok: true, phone: parsed.number, country: parsed.country || country || null }
}

export function buildCapture(input = {}) {
  const phoneResult = normalisePhone(input.phone || input.mobile || input.mobileNumber, input)
  if (!phoneResult.ok) return { ok: false, reason: phoneResult.reason }
  const email = clean(input.email, 200).toLowerCase()
  const source = clean(input.source || input.form || input.endpoint || 'website-form', 160)
  const name = clean(input.contactName || input.parentName || input.parentFullName || input.name || input.playerFullName || input.playerName, 160)
  const type = clean(input.contactType, 120)
  const labels = unique([JSON.stringify({ name, role: type, label: input.sourceLabel || input.formLabel || source })])
  const sourceEvidence = JSON.stringify({ endpoint: clean(input.endpoint, 120), form: clean(input.form, 120), submittedAt: clean(input.submittedAt, 60), name, email, players: (Array.isArray(input.players) ? input.players : []).slice(0, 10).map(p => clean(p?.name, 160)) })
  return {
    ok: true,
    contact: {
      phone: phoneResult.phone,
      country: phoneResult.country,
      email,
      name,
      contactType: type,
      source,
      labels,
      sourceEvidence,
      importBatch: clean(input.importBatch || DEFAULT_BATCH, 120),
      destination: phoneResult.country === 'US' ? 'usa' : 'main',
    },
  }
}

function airtableConfig() {
  const token = process.env.MASTER_CONTACT_AIRTABLE_TOKEN
  if (!token || process.env.MASTER_CONTACT_BASE_ID !== MASTER_BASE_ID || process.env.MASTER_CONTACT_TABLE_ID !== MASTER_TABLE_ID || process.env.MASTER_CONTACT_USA_TABLE_ID !== USA_TABLE_ID) throw new Error('capture_configuration')
  return { token, base: MASTER_BASE_ID }
}

async function airtableRequest(table, path = '', init = {}) {
  const { token, base } = airtableConfig()
  const response = await fetch(`https://api.airtable.com/v0/${base}/${table}${path}`, {
    ...init,
    signal: AbortSignal.timeout(1200),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch {}
  if (!response.ok) throw new Error(`airtable_http_${response.status}`)
  return data
}

async function findByKey(table, key) {
  const formula = `{Master Contact Key}='${formulaValue(key)}'`
  const query = `?maxRecords=2&filterByFormula=${encodeURIComponent(formula)}`
  const data = await airtableRequest(table, query)
  if (!Array.isArray(data.records) || data.records.length > 1) throw new Error('capture_duplicate_or_bad_response')
  return data.records[0] || null
}

function safeInput(input) {
  const payload = {}
  for (const key of ['phone', 'mobile', 'mobileNumber', 'country', 'countryCode', 'name', 'parentName', 'parentFullName', 'contactName', 'email', 'contactType', 'endpoint', 'form', 'source', 'sourceLabel', 'submittedAt']) payload[key] = typeof input[key] === 'string' ? clean(input[key], 200) : ''
  payload.players = (Array.isArray(input.players) ? input.players : []).slice(0, 10).map(p => ({ name: clean(p?.name, 160) }))
  return payload
}

function mergeText(existing, incoming) {
  const result = [...new Set([...String(existing || '').split('\n'), ...String(incoming || '').split('\n')].filter(Boolean))].join('\n')
  if (result.length > 90000) throw new Error('capture_evidence_full')
  return result
}

function fieldsFor(contact, existing = null) {
  const current = existing?.fields || {}
  const fields = {}
  if (!existing && !current['Contact Name'] && contact.name) fields['Contact Name'] = contact.name
  if (!current['Master Contact Key']) fields['Master Contact Key'] = `phone:${contact.phone}`
  if (!existing && !current['Mobile Number']) fields['Mobile Number'] = contact.phone
  if (!existing && !current['Contact Type'] && contact.contactType) fields['Contact Type'] = contact.contactType
  if (!existing && !current['Identity Status']) fields['Identity Status'] = 'Needs Review'
  if (contact.labels.length) fields['Source Contact Labels'] = mergeText(current['Source Contact Labels'], contact.labels.join('\n'))
  fields.Sources = mergeText(current.Sources, contact.source)
  if (contact.email) fields['Emails from Sources'] = mergeText(current['Emails from Sources'], contact.email)
  if (contact.sourceEvidence) fields['Source Evidence'] = mergeText(current['Source Evidence'], contact.sourceEvidence)
  if (!existing && !current['Import Batch']) fields['Import Batch'] = contact.importBatch
  if (!existing) fields['Marketing Permission'] = 'Unknown - consent review required'
  // Existing marketing permission and promotion/suppression flags are never written. Existing identity/owner/link fields are preserved.
  return fields
}

async function persistContact(contact) {
  airtableConfig()
  const key = `phone:${contact.phone}`
  const lock = `${OUTBOX_PREFIX}lock:${crypto.createHash('sha256').update(key).digest('hex')}`
  const token = crypto.randomUUID()
  if (await kvCommand(['SET', lock, token, 'NX', 'EX', '30']) !== 'OK') throw new Error('capture_busy')
  try {
    const main = await findByKey(MASTER_TABLE_ID, key)
    const usa = await findByKey(USA_TABLE_ID, key)
    if (main && usa) throw new Error('capture_duplicate_review')
    const existing = main || usa
    const table = existing ? (main ? MASTER_TABLE_ID : USA_TABLE_ID) : (contact.destination === 'usa' ? USA_TABLE_ID : MASTER_TABLE_ID)
    const fields = fieldsFor(contact, existing)
    let result
    if (existing) result = await airtableRequest(table, `/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: false }) })
    else result = (await airtableRequest(table, '', { method: 'PATCH', body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['Master Contact Key'] }, records: [{ fields }], typecast: false }) })).records?.[0]
    if (!result?.id) throw new Error('capture_bad_response')
    const readback = await airtableRequest(table, `/${result.id}`)
    if (readback.id !== result.id || Object.entries(fields).some(([k,v]) => readback.fields?.[k] !== v)) throw new Error('capture_readback_mismatch')
    return { status: 'persisted', table, recordId: result.id }
  } finally {
    await kvCommand(['EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", '1', lock, token]).catch(() => {})
  }
}

export async function captureWebsiteContact(input = {}) {
  if (process.env.MASTER_CONTACT_CAPTURE_ENABLED !== 'true') return { status: 'disabled' }
  let id, queued = false
  try {
    const payload = safeInput(input)
    const built = buildCapture(payload)
    if (!built.ok && built.reason === 'missing_phone') return { status: 'skipped', reason: built.reason }
    id = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    // Atomic durable queue first. No expiry: unresolved captures need review.
    await kvCommand(['HSETNX', OUTBOX_INDEX_KEY, id, JSON.stringify({ payload, createdAt: new Date().toISOString() })])
    queued = true
    if (!built.ok) return { status: 'review_required', outboxId: id, reason: built.reason }
    const result = await persistContact(built.contact)
    await kvCommand(['HDEL', OUTBOX_INDEX_KEY, id])
    return result
  } catch {
    console.error('Master contact capture incomplete', { outboxId: id, queued })
    return { status: queued ? 'queued' : 'failed', outboxId: id }
  }
}

export async function replayCapture(id) {
  if (process.env.MASTER_CONTACT_CAPTURE_ENABLED !== 'true') return { status: 'disabled' }
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid_capture_id')
  const raw = await kvCommand(['HGET', OUTBOX_INDEX_KEY, id])
  if (!raw) return { status: 'not_found' }
  const built = buildCapture(JSON.parse(raw).payload)
  if (!built.ok) return { status: 'review_required', reason: built.reason }
  const result = await persistContact(built.contact)
  await kvCommand(['HDEL', OUTBOX_INDEX_KEY, id])
  return result
}

export async function listCaptureOutbox(limit = 20, cursor = '0') {
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 20
  const [next, entries] = await kvCommand(['HSCAN', OUTBOX_INDEX_KEY, /^\d+$/.test(cursor) ? cursor : '0', 'COUNT', String(count)])
  return { cursor: String(next), ids: entries.filter((_, i) => i % 2 === 0) }
}
