// Portal messages to current JFP families: an email and a text per family,
// each one stored first, approved by staff exactly as shown, then sent once.
//
// Rules (Lee's brief, 5 Oct 2026):
// - Nothing goes until a person approves that exact message. Approval
//   freezes the content, the target and the payment evidence it was based on.
// - At most once: a message is claimed before it is sent and never retried.
//   An unclear outcome is quarantined as "Check it" for a person to settle.
// - Amounts are "due according to current records", checked again right
//   before sending. If the records moved (paid, link cancelled, row changed),
//   the message is cancelled and a fresh one has to be prepared.
// - Texts go through the Mac at the HQ (Messages: iMessage, or SMS when the
//   family has no iMessage). Vercel never reaches into the Mac: the Mac asks
//   for work. Phone numbers stay out of logs and are only resolved from
//   Airtable at the moment the Mac claims the text.
import crypto from 'node:crypto'
import { kvCommand, kvGetJson, kvSetJson, clean, newId, formatAud } from './_holiday-store.js'
import { airtable } from './_jfp-airtable.js'

const LONG = 60 * 60 * 24 * 400
export const TEXT_HOURS = { from: 8, to: 20 } // Sydney time; texts wait outside these hours
export const TEXT_EXPIRES_HOURS = 24 // a queued text not sent by then expires
export const LEASE_SECONDS = 300
export const STATUS_LABELS = {
  draft: 'Draft', sending: 'Sending', queued: 'Waiting for the Mac', claimed: 'Mac is sending', sent: 'Sent',
  failed: 'Not sent', unknown: 'Check it', cancelled: 'Cancelled', expired: 'Expired', delivered: 'Sent (checked by hand)',
}
const FINAL = new Set(['sent', 'failed', 'cancelled', 'expired', 'delivered'])

export const keys = {
  msg: (id) => `jfp:msg:${id}`,
  index: () => 'jfp:msgs',
  lease: (id) => `jfp:msg-lease:${id}`,
  prefs: () => 'jfp:msg-prefs',
  relay: () => 'jfp:msg-relay',
  route: () => 'jfp:msg-route',
}

export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

// ---------- phones ----------

// Australian mobiles to +614XXXXXXXX. Anything else is left out (not guessed).
export function normalisePhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (d.startsWith('0061')) d = d.slice(2)
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`
  if (/^614\d{8}$/.test(d)) return `+${d}`
  if (/^4\d{8}$/.test(d)) return `+61${d}`
  return ''
}
export const maskPhone = (p) => (p ? `•••• ${p.slice(-3)}` : '')

// The family's mobile from their Term 4 rows. Two different numbers on one
// family is ambiguous: no text until a person settles it in Airtable.
export function familyPhone(rows) {
  const raw = [...new Set(rows.map((r) => r.phone).filter(Boolean))]
  const phones = [...new Set(raw.map(normalisePhone).filter(Boolean))]
  if (!raw.length) return { phone: '', problem: 'No mobile in Airtable' }
  if (!phones.length) return { phone: '', problem: 'The mobile in Airtable is not an Australian mobile' }
  if (phones.length > 1) return { phone: '', problem: 'Two different mobiles on this family' }
  return { phone: phones[0], problem: '' }
}

// ---------- evidence: what the amount was based on ----------

// The payment fields of the family's rows and the pay link, as they were when
// the message was prepared. Any change means the message is out of date.
export function evidenceOf(rows, payreq) {
  const list = rows.map((r) => ({
    id: r.id, name: r.player, fee: r.feeAud ?? null, paid: r.paidAud ?? null, balance: r.balanceAud ?? null,
    status: r.paymentStatus || '', type: r.paymentType || '', confirmation: r.confirmation || '',
  })).sort((a, b) => a.id.localeCompare(b.id))
  const link = payreq ? { id: payreq.id, status: payreq.status, amountCents: payreq.amountCents } : null
  return { rows: list, link, hash: sha(JSON.stringify({ list, link })) }
}

// ---------- do not contact ----------

// Families marked Do Not Contact in the Joner Football Master Database.
export async function doNotContact() {
  const q = new URLSearchParams({ filterByFormula: '{Do Not Contact}', pageSize: '100' })
  for (const f of ['Emails from Sources', 'Mobile Number']) q.append('fields[]', f)
  const emails = new Set(), phones = new Set()
  let offset = ''
  do {
    if (offset) q.set('offset', offset)
    const d = await airtable(`${encodeURIComponent('Joner Football Master Database')}?${q}`)
    for (const r of d.records || []) {
      for (const e of String(r.fields['Emails from Sources'] || '').toLowerCase().match(/[^\s,;<>]+@[^\s,;<>]+/g) || []) emails.add(e)
      const p = normalisePhone(r.fields['Mobile Number'])
      if (p) phones.add(p)
    }
    offset = d.offset || ''
  } while (offset)
  return { has: (email, phone) => emails.has(String(email || '').toLowerCase()) || (phone && phones.has(phone)) }
}

// ---------- the text ----------

export function textFor({ parentName, players, kind, amountCents, payUrl, signInUrl, config, sender = 'Lee' }) {
  const first = String(parentName || '').trim().split(/\s+/)[0] || 'there'
  const names = players.map((p) => p.name.split(/\s+/)[0])
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  const term = config.term.replace(/\s*\d{4}$/, '')
  const intro = `Hi ${first}, it's ${sender} from Joner Football.`
  if (kind === 'pay' && payUrl) return `${intro} ${who}'s ${term} place shows ${formatAud(amountCents)} due on our records. You can pay securely here (card, Apple Pay or Afterpay): ${payUrl} If you have already paid or something looks wrong, just reply and we will sort it.`
  return `${intro} Your new JFP account is ready: sign in with your email to see ${who}'s ${term} sessions and dates. ${signInUrl} Any questions, just reply.`
}

// ---------- storage ----------

export async function getMsg(id) { const c = clean(id, 60); return c ? kvGetJson(keys.msg(c)) : null }
export async function saveMsg(m) {
  await kvSetJson(keys.msg(m.id), m, LONG)
  await kvCommand(['ZADD', keys.index(), String(Date.parse(m.createdAt)), m.id])
  return m
}
export async function listMsgs(limit = 400) {
  const ids = (await kvCommand(['ZREVRANGE', keys.index(), '0', String(limit - 1)])) || []
  const out = []
  for (const id of ids) { const m = await kvGetJson(keys.msg(id)); if (m) out.push(await settleLease(m)) }
  return out
}

export function payloadHash(m) {
  return sha(JSON.stringify(m.channel === 'email' ? { to: m.target.ref, subject: m.content.subject, html: m.content.html } : { to: m.target.hash, text: m.content.text }))
}

export function newMsg({ channel, family, content, target, evidence, payreq, route, by, selfTest = false }) {
  const now = new Date().toISOString()
  const m = {
    id: newId('MSG'), channel, createdAt: now, status: 'draft', selfTest,
    email: family?.email || '', parentName: family?.parent || '', players: (family?.players || []).map((p) => p.name),
    rowIds: (family?.players || []).map((p) => p.rowId), kind: family?.kind || 'test', amountCents: family?.owingCents || 0,
    payreqId: payreq?.id || '', payUrl: content.payUrl || '',
    evidence: evidence || null, target, content: { subject: content.subject, html: content.html, text: content.text },
    route: route || null, requestedBy: by, events: [{ at: now, by, what: 'prepared' }],
  }
  m.payloadHash = payloadHash(m)
  return m
}

export function event(m, by, what, extra = {}) {
  m.events = [...(m.events || []), { at: new Date().toISOString(), by, what, ...extra }].slice(-40)
  return m
}
export const isFinal = (m) => FINAL.has(m.status)

// A claim whose lease ran out without a receipt: the Mac may or may not have
// sent it. Never sent again on its own: a person checks the phone.
async function settleLease(m) {
  if (m.status === 'claimed' && m.leaseUntil && Date.parse(m.leaseUntil) < Date.now()) {
    m.status = 'unknown'
    event(m, 'system', 'no receipt from the Mac before the claim ran out: check Messages before doing anything')
    await saveMsg(m)
  }
  if (m.status === 'sending' && m.leaseUntil && Date.parse(m.leaseUntil) < Date.now()) {
    m.status = 'unknown'
    event(m, 'system', 'the email send did not finish: check Brevo before doing anything')
    await saveMsg(m)
  }
  return m
}

// One claim per message, ever. Returns false when someone else holds it.
export async function claim(id, seconds = LEASE_SECONDS) {
  return (await kvCommand(['SET', keys.lease(id), String(Date.now()), 'NX', 'EX', String(seconds)])) === 'OK'
}

// ---------- family preferences (text yes or no) ----------

export async function getPrefs() {
  const raw = (await kvCommand(['HGETALL', keys.prefs()])) || []
  const out = {}
  for (let i = 0; i + 1 < raw.length; i += 2) { try { out[raw[i]] = JSON.parse(raw[i + 1]) } catch {} }
  return out
}
export async function setPref(email, pref) { await kvCommand(['HSET', keys.prefs(), email, JSON.stringify(pref)]) }

// ---------- the Mac relay and the text route ----------

export async function relayStatus() { return (await kvGetJson(keys.relay())) || null }
export async function routeStatus() { return (await kvGetJson(keys.route())) || { verified: false } }
export async function saveRoute(r) { await kvSetJson(keys.route(), r, LONG) }
export async function saveRelay(r) { await kvSetJson(keys.relay(), r, LONG) }

export function sydneyHour(ms = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).format(new Date(ms))) % 24
}
// JFP_TEXT_ANYTIME is only set by the local test harness.
export const textHoursOpen = (ms = Date.now()) => { if (process.env.JFP_TEXT_ANYTIME === '1') return true; const h = sydneyHour(ms); return h >= TEXT_HOURS.from && h < TEXT_HOURS.to }

// ---------- email: Brevo, keeping its message id as the receipt ----------

export async function sendEmailExact({ to, name, subject, html, replyTo = 'ligia@jonerfootball.com' }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) { const e = new Error('BREVO_API_KEY is not configured.'); e.definite = true; throw e }
  const sender = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  let res
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ sender: { name: 'Joner Football', email: sender }, to: [{ email: to, name }], replyTo: { email: replyTo, name: 'Joner Football' }, subject, htmlContent: html }),
    })
  } catch (error) { error.definite = false; throw error } // network: it may or may not have gone
  const text = await res.text()
  if (!res.ok) {
    const e = new Error(`Brevo ${res.status}: ${text.slice(0, 200)}`)
    // Brevo refused it (bad request, auth): definitely not sent. A 5xx is unclear.
    e.definite = res.status >= 400 && res.status < 500
    throw e
  }
  let messageId = ''
  try { messageId = JSON.parse(text).messageId || '' } catch {}
  return { messageId }
}
