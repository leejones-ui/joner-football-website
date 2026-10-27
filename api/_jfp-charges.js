// Player charges (Lee, 14 Oct 2026): money a player owes on top of their
// term, tied to the player from the start. Extra sessions and video analysis
// (the coach portal will make these), and custom invoices that are not term
// fees (api/_jfp-invoices.js). See docs/jfp-charges.md.
//
// A charge is a record (KV jfp:charge:<CHG-...>) and a payment request
// (jfp:payreq:<PAY-...>, reason 'charge') the family pays from My account,
// Home and Fees, with Pay. The request never names a Term 4 row (term4Ids is
// empty), so paying it never touches a term fee: the webhook marks the charge
// paid (_jfp-finalise.js) and Money > Extra sessions counts it. Its Stripe
// session says jfpProgramme 'extra' (or 'other'), so it is never JFP term income.
//
// Idempotent on ref: the same ref twice gives back the first charge.
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, newId, formatAud, savePayreq, getPayreq, normName, audit, sydneyToday, validEmail, coachById, coachLabel, closeCheckout, rowEmails, emailsIn } from './_jfp-store.js'
import { getTerm4Row } from './_jfp-airtable.js'
import { fillFees } from './_jfp-stripe.js'
import { settleExtraPaid } from './_jfp-extra-settle.js'

export const CHARGE_KINDS = { extra: 'Extra session', analysis: 'Video analysis', invoice: 'Invoice' }
export const CHARGE_ID = /^CHG-\d{10,16}-[0-9A-F]{6}$/
// The programmes a charge can count in. Term fees (JFP, Pro sessions) are
// never charges: they go on the player's row (an invoice for them does).
export const CHARGE_PROGRAMMES = ['extra', 'other']
export const CHARGE_MIN = 100
export const CHARGE_MAX = 2000000
const LONG = 60 * 60 * 24 * 500
const key = (id) => `jfp:charge:${id}`
const INDEX = 'jfp:charges'
const refKey = (ref) => `jfp:charge-ref:${crypto.createHash('sha256').update(String(ref)).digest('hex').slice(0, 40)}`
const ISO = /^\d{4}-\d{2}-\d{2}$/

export const chargeProgramme = (kind, programme = '') => (kind === 'invoice' && CHARGE_PROGRAMMES.includes(programme) ? programme : kind === 'invoice' ? 'other' : 'extra')

export async function getCharge(id) { const c = clean(id, 60); return CHARGE_ID.test(c) ? kvGetJson(key(c)) : null }
export async function saveCharge(c) { await kvSetJson(key(c.id), c, LONG); await kvCommand(['ZADD', INDEX, String(Date.parse(c.createdAt)), c.id]); return c }
export async function listCharges(limit = 3000) {
  const ids = await kvCommand(['ZREVRANGE', INDEX, '0', String(limit - 1)])
  if (!ids?.length) return []
  return (await kvPipeline(ids.map((id) => ['GET', key(id)]))).map((x) => { try { return typeof x === 'string' ? JSON.parse(x) : null } catch { return null } }).filter(Boolean)
}

// Where a charge stands. Paid other ways (bank, cash) closes its payment
// request; part paid leaves the request open for the rest.
export function chargeStatus(c) {
  if (c.status === 'cancelled') return 'cancelled'
  const paid = paidOf(c)
  if (paid >= c.amountCents) return 'paid'
  return paid > 0 ? 'part' : 'open'
}
export const paidOf = (c) => (c.payments || []).reduce((t, p) => t + (p.cents || 0), 0)
export const CHARGE_STATUS = { open: 'To pay', part: 'Part paid', paid: 'Paid', cancelled: 'Cancelled' }

// What was asked for, checked, before anything is read. { ok, v } or { ok: false, status, error }.
export function chargeInput(input = {}, config) {
  const bad = (error, status = 400) => ({ ok: false, status, error })
  const kind = Object.hasOwn(CHARGE_KINDS, input.kind) ? input.kind : input.kind == null || input.kind === '' ? 'extra' : ''
  if (!kind) return bad('kind must be extra, analysis or invoice.')
  const amountCents = Number(input.amountCents)
  if (!Number.isInteger(amountCents) || amountCents < CHARGE_MIN || amountCents > CHARGE_MAX) return bad('Enter an amount from A$1 to A$20,000.')
  const sessionDate = input.sessionDate ? clean(input.sessionDate, 10) : ''
  if (sessionDate && !ISO.test(sessionDate)) return bad('The session date does not look right.')
  const coachId = clean(input.coachId, 40)
  const coach = coachId ? coachById(config, coachId) : null
  if (coachId && !coach) return bad('That coach is not on the coach list.')
  const rowId = clean(input.rowId, 30)
  const profileKey = clean(input.profileKey, 200)
  const email = input.email ? validEmail(input.email) : ''
  if (input.email && !email) return bad('That email does not look right.')
  if (!rowId && !profileKey && !email) return bad('Say which player: rowId, profileKey or email.')
  const ref = clean(input.ref, 120)
  const label = clean(input.label, 120) || `${CHARGE_KINDS[kind]}${sessionDate ? `, ${sessionDate}` : ''}`
  return { ok: true, v: { kind, programme: chargeProgramme(kind, input.programme), amountCents, sessionDate, coachId: coach?.id || '', coachName: coach ? coachLabel(coach) : '', rowId, profileKey, email, playerName: clean(input.playerName, 80), parentName: clean(input.parentName, 120), groupId: clean(input.groupId, 80), ref, label, invoiceId: clean(input.invoiceId, 30), note: clean(input.note, 300) } }
}

// The payment request the family pays from My account. Never a Term 4 row.
export function chargePayreq(c, { principal, siteUrl = '', now = new Date().toISOString() }) {
  return {
    id: c.payreqId || newId('PAY'),
    charge: { id: c.id, kind: c.kind },
    ...(c.invoiceId ? { invoiceId: c.invoiceId } : {}),
    reason: 'charge', programme: c.programme,
    email: c.email, parentName: c.parentName,
    playerNames: [c.playerName], playerKeys: [normName(c.playerName)],
    term4Ids: [], chargeRowIds: c.rowId ? [c.rowId] : [], ...(c.profileKey ? { profileKey: c.profileKey } : {}),
    groupId: '', groupLabel: c.label, productLabel: c.label,
    amountCents: c.amountCents - paidOf(c), afterpay: false,
    status: 'open', createdBy: principal?.email || 'system', createdAt: now, expiresAt: '', siteUrl,
  }
}

// createPlayerCharge({ config, principal, rowId | profileKey, email, playerName,
//   amountCents, label, kind, sessionDate, coachId, groupId, ref, programme, invoiceId, siteUrl })
// -> { ok: true, payreqId, charge, payreq, existing } | { ok: false, status, error }
// The coach side uses kind 'extra' and ref `extra:<slotId>`, and reads the
// request's status with getPayreq(payreqId): 'paid' however it was paid.
// The coach portal calls this for extra sessions (docs/jfp-charges.md).
export async function createPlayerCharge(input = {}) {
  const { config, principal } = input
  if (!config || !principal?.email) return { ok: false, status: 400, error: 'config and principal are required.' }
  const r = chargeInput(input, config)
  if (!r.ok) return r
  const v = r.v
  // The same ref again (a retry, a double tap): the first charge, unchanged.
  let claimed = ''
  if (v.ref) {
    const hit = await kvCommand(['GET', refKey(v.ref)])
    if (hit && hit !== 'pending') {
      const c = await getCharge(hit)
      // The same ref for a different player is a mistake on the caller's side, never a silent reuse.
      const same = c && (!v.rowId || c.rowId === v.rowId) && (!v.profileKey || c.profileKey === v.profileKey) && (!v.email || c.email === v.email)
      if (c && !same) return { ok: false, status: 409, code: 'ref_other_player', error: 'That ref is already used by a charge for another player. Make the ref unique per player (e.g. extra:<slotId>:<rowId>).' }
      if (c) return { ok: true, existing: true, charge: c, payreq: c.payreqId ? await getPayreq(c.payreqId) : null, payreqId: c.payreqId }
    }
    if ((await kvCommand(['SET', refKey(v.ref), 'pending', 'NX', 'EX', '30'])) !== 'OK') return { ok: false, status: 409, code: 'busy', error: 'That charge is being made right now. Try again in a moment.' }
    claimed = refKey(v.ref)
  }
  try {
    // The player: their Term 4 row when there is one (name, parent, email).
    let row = null
    if (v.rowId) {
      row = await getTerm4Row(v.rowId)
      if (!row) return { ok: false, status: 404, error: 'Player row not found.' }
    }
    const playerName = v.playerName || row?.player || ''
    if (!playerName) return { ok: false, status: 400, error: 'Say the player\'s name (playerName).' }
    const email = v.email || (row ? rowEmails(row)[0] || '' : '') || (v.profileKey.includes('|') ? validEmail(v.profileKey.split('|')[1]) : '')
    if (!email) return { ok: false, status: 400, error: `There is no email for ${playerName}, so the family could not see or pay it. Add one first.` }
    const now = new Date().toISOString()
    const c = {
      id: newId('CHG'), kind: v.kind, programme: v.programme, label: v.label, amountCents: v.amountCents,
      rowId: row?.id || '', profileKey: v.profileKey, email, playerName, parentName: v.parentName || row?.parent || '',
      sessionDate: v.sessionDate, coachId: v.coachId, coachName: v.coachName, groupId: v.groupId || row?.groupId || '',
      ref: v.ref, ...(v.invoiceId ? { invoiceId: v.invoiceId } : {}), note: v.note,
      status: 'open', payments: [], createdBy: principal.email, createdAt: now,
    }
    const q = chargePayreq(c, { principal, siteUrl: input.siteUrl || '', now })
    c.payreqId = q.id
    await savePayreq(q)
    await saveCharge(c)
    if (claimed) await kvCommand(['SET', claimed, c.id])
    claimed = ''
    await audit({ by: principal.email, action: 'charge.create', target: c.id, after: { kind: c.kind, programme: c.programme, cents: c.amountCents, row: c.rowId, payreq: q.id, ref: c.ref } })
    // notifyFamily (claude/card-on-file): "You have a payment to make", or that
    // it will be charged to their saved card after the session. Never fatal.
    let emailed = false
    if (input.notifyFamily === true) {
      try { emailed = (await (await import('./_jfp-saved-pay.js')).notifyNewCharge({ charge: c, payreq: q, siteUrl: input.siteUrl || '' })).emailed === true } catch (error) { console.error('jfp charge email failed', c.id, error.message) }
    }
    return { ok: true, existing: false, charge: c, payreq: q, payreqId: q.id, ...(input.notifyFamily === true ? { emailed } : {}) }
  } finally {
    if (claimed) await kvCommand(['DEL', claimed]).catch(() => {})
  }
}

// A payment onto a charge: Stripe (the webhook), bank, cash or other. Never
// the same payment twice (its id). Returns the charge, or null if unknown.
export async function addChargePayment(id, pay) {
  const lock = `jfp:charge-lock:${id}`
  for (let i = 0; i < 20 && (await kvCommand(['SET', lock, '1', 'NX', 'EX', '10'])) !== 'OK'; i++) await new Promise((r) => setTimeout(r, 100))
  try {
    const c = await getCharge(id)
    if (!c) return null
    if (pay.id && (c.payments || []).some((p) => p.id === pay.id)) return c
    c.payments = [...(c.payments || []), { id: pay.id || newId('PMT'), method: pay.method, cents: pay.cents, feeCents: pay.feeCents ?? (pay.method === 'stripe' ? null : 0), date: pay.date || sydneyToday(), at: pay.at || new Date().toISOString(), by: pay.by || '', ...(pay.payreqId ? { payreqId: pay.payreqId } : {}), ...(pay.intentId ? { intentId: pay.intentId } : {}), ...(pay.note ? { note: pay.note } : {}) }]
    c.status = chargeStatus(c)
    if (c.status === 'paid' && !c.paidAt) c.paidAt = new Date().toISOString()
    await saveCharge(c)
    return c
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

// After a payment that did not come through the request (bank, cash): the
// request asks only for what is left, or closes when nothing is.
export async function settleChargePayreq(c) {
  const q = c.payreqId ? await getPayreq(c.payreqId) : null
  if (!q || !['open', 'checkout'].includes(q.status)) return { ok: true }
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return { ok: false, error: 'The family is paying the rest by card right now. Check again in a minute.' }
  }
  const left = c.amountCents - paidOf(c)
  // Paid in full another way: the request reads 'paid' (getPayreq is how the
  // coach side checks a booking is paid), marked paidOffline with the method.
  if (c.status === 'cancelled') await savePayreq({ ...q, status: 'cancelled', stripeSessionId: '', cancelledAt: new Date().toISOString(), cancelReason: 'Charge cancelled' })
  else if (left <= 0) { const last = (c.payments || []).at(-1) || {}; await savePayreq({ ...q, status: 'paid', stripeSessionId: '', paidAt: new Date().toISOString(), paidCents: paidOf(c), paidOffline: true, paidMethod: last.method || 'other' }); await settleExtraPaid(q.id) }
  else await savePayreq({ ...q, amountCents: left, status: 'open', stripeSessionId: '' })
  return { ok: true }
}

// Recorded by staff (bank, cash, other): { ok, charge } or { ok: false, status, error }.
const METHODS = new Set(['bank', 'cash', 'other'])
export async function recordChargePayment({ id, method, amountCents, date, note, principal, paymentId = '' }) {
  const c = await getCharge(id)
  if (!c) return { ok: false, status: 404, error: 'Charge not found.' }
  if (c.status === 'cancelled') return { ok: false, status: 409, error: 'This charge was cancelled.' }
  const m = METHODS.has(method) ? method : ''
  if (!m) return { ok: false, status: 400, error: 'How was it paid: bank, cash or other?' }
  const left = c.amountCents - paidOf(c)
  if (left <= 0) return { ok: false, status: 409, error: 'This charge is already paid.' }
  const cents = amountCents == null || amountCents === '' ? left : Number(amountCents)
  if (!Number.isInteger(cents) || cents <= 0 || cents > left) return { ok: false, status: 400, error: `Enter the amount, up to the ${formatAud(left)} still to pay.` }
  const day = date && ISO.test(date) ? date : sydneyToday()
  if (day > sydneyToday()) return { ok: false, status: 400, error: 'The payment date cannot be in the future.' }
  const next = await addChargePayment(c.id, { id: paymentId || newId(m === 'cash' ? 'CASH' : m === 'bank' ? 'BANK' : 'OFF'), method: m, cents, date: day, by: principal.email, note: clean(note, 200) })
  const s = await settleChargePayreq(next)
  await audit({ by: principal.email, action: 'charge.payment', target: c.id, after: { method: m, cents, date: day } })
  return { ok: true, charge: next, ...(s.ok ? {} : { warning: s.error }) }
}

export async function cancelCharge({ id, principal, why = '' }) {
  const c = await getCharge(id)
  if (!c) return { ok: false, status: 404, error: 'Charge not found.' }
  if (paidOf(c) > 0) return { ok: false, status: 409, error: 'Money has come in on this charge. Refunds are made in Stripe; cancel only an unpaid charge.' }
  const q = c.payreqId ? await getPayreq(c.payreqId) : null
  if (q?.status === 'paid') return { ok: false, status: 409, error: 'This charge has just been paid.' }
  if (q?.status === 'checkout' && q.stripeSessionId && (await closeCheckout(q.stripeSessionId)) === 'complete') return { ok: false, status: 409, error: 'The family has just paid. It will show as paid in a minute.' }
  const next = { ...c, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: principal.email, cancelReason: clean(why, 200) }
  await saveCharge(next)
  if (q && ['open', 'checkout'].includes(q.status)) await savePayreq({ ...q, status: 'cancelled', stripeSessionId: '', cancelledAt: next.cancelledAt, cancelReason: 'Charge cancelled' })
  await audit({ by: principal.email, action: 'charge.cancel', target: c.id, after: { why: next.cancelReason } })
  return { ok: true, charge: next }
}

// A Stripe payment staff matched to a player as an extra session (Money >
// JFP, Stripe payments not matched): a charge, already paid by that payment.
export async function chargeFromStripe({ config, principal, payment, row, label = '', ref }) {
  const made = await createPlayerCharge({ config, principal, rowId: row.id, email: payment.email || '', playerName: row.player, amountCents: payment.amountCents - (payment.refundedCents || 0), label: label || `Extra session (Stripe, ${sydneyToday(Date.parse(payment.at))})`, kind: 'extra', ref })
  if (!made.ok) return made
  const c = await addChargePayment(made.charge.id, { id: payment.intentId || payment.id, intentId: payment.intentId || '', method: 'stripe', cents: payment.amountCents - (payment.refundedCents || 0), feeCents: payment.feeKnown ? payment.feeCents : null, date: sydneyToday(Date.parse(payment.at)), at: payment.at, by: principal.email, note: `Stripe ${payment.id}, matched by ${principal.name || principal.email}` })
  await settleChargePayreq(c)
  return { ok: true, charge: c }
}

// ---------- Money > Extra sessions ----------

const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
const monthLabel = (ym) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00Z`))
const METHOD_LABEL = { stripe: 'Stripe', bank: 'Bank transfer', cash: 'Cash', other: 'Other' }

// Every payment on an Extra sessions charge, plus paid quick links made for
// Extra sessions, as lines: { kind, id, paidDate, who, coach, takenCents,
// refundedCents, feeCents, keptCents, ... }.
export function extraLines({ charges = [], payreqs = [] }) {
  const byPayreq = new Map(payreqs.map((q) => [q.id, q]))
  const lines = []
  for (const c of charges) {
    if (c.programme !== 'extra') continue
    for (const p of c.payments || []) {
      const q = p.method === 'stripe' && p.payreqId ? byPayreq.get(p.payreqId) : null
      const refunded = q?.refundedCents || 0
      const fee = p.method === 'stripe' ? (p.feeCents ?? null) : 0
      lines.push({ kind: p.method, id: p.id, chargeId: c.id, paidDate: p.date, sessionDate: c.sessionDate || '', who: c.playerName, rowId: c.rowId || '', coachId: c.coachId || '', coach: c.coachName || '', note: c.label, takenCents: p.cents, refundedCents: refunded, feeCents: fee, feePending: fee == null, keptCents: p.cents - refunded - (fee || 0), intentId: p.intentId || '' })
    }
  }
  for (const q of payreqs) {
    if (!q.quick || q.programme !== 'extra' || q.status !== 'paid') continue
    const fee = q.stripeFeeCents ?? null
    const taken = q.paidCents ?? q.amountCents
    lines.push({ kind: 'stripe', id: q.stripePaymentIntentId || q.id, payreqId: q.id, paidDate: q.paidAt ? sydneyToday(Date.parse(q.paidAt)) : '', sessionDate: '', who: (q.playerNames || []).join(', ') || q.payerName || q.payerEmail || '', rowId: q.rowId || '', coachId: '', coach: '', note: `Quick link: ${q.forText}`, quick: true, toCheck: !(q.playerNames || []).length, takenCents: taken, refundedCents: q.refundedCents || 0, feeCents: fee, feePending: fee == null, keptCents: taken - (q.refundedCents || 0) - (fee || 0), intentId: q.stripePaymentIntentId || '' })
  }
  return lines.sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || '') || String(a.id).localeCompare(String(b.id)))
}

function tally(list) {
  const part = (l) => ({ count: l.length, takenCents: sum(l, 'takenCents'), refundedCents: sum(l, 'refundedCents'), feeCents: sum(l, 'feeCents'), keptCents: sum(l, 'keptCents') })
  return { ...part(list), feesPending: list.filter((x) => x.feePending).length, stripe: part(list.filter((x) => x.kind === 'stripe')), bank: part(list.filter((x) => x.kind === 'bank')), cash: part(list.filter((x) => x.kind === 'cash' || x.kind === 'other')) }
}
function groupBy(list, keyOf, labelOf) {
  const m = new Map()
  for (const x of list) {
    const k = keyOf(x)
    const g = m.get(k) || { id: k, label: labelOf(x), lines: [] }
    g.lines.push(x)
    m.set(k, g)
  }
  return [...m.values()].map((g) => ({ id: g.id, label: g.label, ...tally(g.lines) }))
}

// The whole view. month: 'YYYY-MM' or '' for every month.
export function extraMoneyView({ charges = [], payreqs = [], month = '', at = '' } = {}) {
  const all = extraLines({ charges, payreqs })
  const months = [...new Set(all.map((x) => (x.paidDate || '').slice(0, 7)).filter(Boolean))].sort().reverse()
  const chosen = months.includes(month) ? month : ''
  const list = chosen ? all.filter((x) => (x.paidDate || '').startsWith(chosen)) : all
  const mine = charges.filter((c) => c.programme === 'extra')
  const open = mine.filter((c) => ['open', 'part'].includes(chargeStatus(c))).map((c) => chargeView(c))
  return {
    at: at || new Date().toISOString(), month: chosen, months: months.map((m) => ({ id: m, label: monthLabel(m) })),
    totals: { ...tally(list), owingCents: open.reduce((t, c) => t + c.owingCents, 0), openCount: open.length, chargedCents: mine.filter((c) => c.status !== 'cancelled').reduce((t, c) => t + c.amountCents, 0) },
    byMonth: groupBy(list, (x) => (x.paidDate || '').slice(0, 7) || 'none', (x) => (x.paidDate ? monthLabel(x.paidDate.slice(0, 7)) : 'No date')).sort((a, b) => b.id.localeCompare(a.id)),
    byCoach: groupBy(list, (x) => x.coachId || '', (x) => x.coach || 'No coach named').sort((a, b) => b.keptCents - a.keptCents || a.label.localeCompare(b.label)),
    byPlayer: groupBy(list, (x) => x.rowId || x.who, (x) => x.who || 'Not matched to a player').sort((a, b) => a.label.localeCompare(b.label)),
    open, charges: mine.slice(0, 300).map((c) => chargeView(c)),
    toCheck: all.filter((x) => x.toCheck).map((x) => ({ id: x.id, payreqId: x.payreqId, paidDate: x.paidDate, takenCents: x.takenCents, who: x.who, note: x.note })),
    lines: list.map((x) => ({ ...x, method: METHOD_LABEL[x.kind] || 'Other' })),
  }
}

export function chargeView(c) {
  const st = chargeStatus(c)
  const paid = paidOf(c)
  return { id: c.id, kind: c.kind, kindLabel: CHARGE_KINDS[c.kind] || 'Charge', programme: c.programme, label: c.label, player: c.playerName, parent: c.parentName || '', email: c.email, rowId: c.rowId || '', sessionDate: c.sessionDate || '', coach: c.coachName || '', coachId: c.coachId || '', amountCents: c.amountCents, paidCents: paid, owingCents: st === 'cancelled' ? 0 : Math.max(0, c.amountCents - paid), status: st, statusLabel: CHARGE_STATUS[st], payreqId: c.payreqId || '', invoiceId: c.invoiceId || '', ref: c.ref || '', createdAt: c.createdAt, createdBy: c.createdBy, payments: (c.payments || []).map((p) => ({ method: METHOD_LABEL[p.method] || p.method, cents: p.cents, date: p.date })) }
}

// Read and worked out. Stripe fees not known when the payment came in are
// looked up (a few at a time, kept for good) the way Money > JFP does.
export async function extraMoneyData({ month = '', payreqs = null } = {}) {
  const [charges, reqs] = await Promise.all([listCharges(), payreqs ? Promise.resolve(payreqs) : (await import('./_jfp-store.js')).listPayreqs()])
  const missing = []
  for (const c of charges) for (const p of c.payments || []) if (p.method === 'stripe' && p.feeCents == null && p.intentId) missing.push({ p, intentId: p.intentId, feeKnown: false })
  if (missing.length) {
    try { await fillFees(missing); for (const m of missing) if (m.feeKnown) m.p.feeCents = m.feeCents } catch (error) { console.error('jfp extra fees failed', error.message) }
  }
  return extraMoneyView({ charges, payreqs: reqs, month })
}

// For the family (My account > Fees): their charges, by any of their emails.
export function familyCharges(charges, emails) {
  const mine = new Set(emails)
  return charges.filter((c) => emailsIn(c.email).some((e) => mine.has(e)) && c.status !== 'cancelled')
}

// The Stripe metadata My account adds when a family pays any request: the
// player (jfpPlayer, jfpRowIds) on every link, and for a charge its program
// (jfpProgramme 'extra' or 'other', so never JFP term income) and its id.
export function chargeCheckoutMeta(q) {
  const names = (q.playerNames || []).filter(Boolean)
  const rowIds = [...new Set([...(q.term4Ids || []), ...(q.chargeRowIds || [])].filter(Boolean))]
  const meta = {
    ...(names.length ? { jfpPlayer: names.join(', ').slice(0, 450) } : {}),
    ...(rowIds.length ? { jfpRowIds: rowIds.join(',').slice(0, 450) } : {}),
    ...(q.charge ? { jfpProgramme: q.programme || 'extra', jfpCharge: q.charge.id } : {}),
    ...(q.invoiceId ? { jfpInvoice: q.invoiceId } : {}),
  }
  return Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`metadata[${k}]`, v], [`payment_intent_data[metadata][${k}]`, v]]))
}
