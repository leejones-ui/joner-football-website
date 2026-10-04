// Turning a paid Stripe session into Airtable. Called by the webhook and by
// the success page, which can race, and either can die part way.
//
// Two kinds of payment arrive here:
//   JFP-...  a new online booking: create the Term 4 rows, the waivers for new
//            players, one ledger row, and the emails.
//   PAY-...  a payment request against rows that already exist (a player staff
//            added, an approved application, a balance): mark those rows paid.
//
// A short takeover lease, then each side effect records done / failed /
// uncertain. Airtable writes look for their own earlier rows first, so a
// retry can never create a second enrolment, waiver or ledger payment.
// A payment that arrives for something already cancelled, or a second
// payment for something already paid, is never dropped: it is recorded on
// the booking, flagged for staff and emailed to Lee.
import crypto from 'node:crypto'
import { stripeFetch } from './_holiday-store.js'
import {
  getBooking, saveBooking, getGroup, getConfig, confirmPlaces, settlePlaces, releasePlaces, coachById, kvCommand, keys, clean,
  getPayreq, savePayreq, ONLINE_TAG, audit, claimOnce, dropParentHold, normName,
} from './_jfp-store.js'
import {
  createTerm4Rows, findTerm4ByTag, updateTerm4Rows, getTerm4Row, createLedgerRow, findLedgerByPayment, createWaiverRows, waiverFields,
  findWaiversByTag, appendNote, bustRosterCache, loadRoster,
} from './_jfp-airtable.js'
import { recordNext, setNextStatus, nextStatuses } from './_jfp-next.js'
import { sendParentConfirmation, sendStaffAlert, sendCoachAlert, sendPaymentReceipt, sendPaymentStaffAlert, sendAttentionAlert } from './_jfp-email.js'

const LEASE_SECONDS = 120
export const EFFECTS = ['airtable', 'waiver', 'ledger', 'parentEmail', 'staffAlert', 'coachAlert']
export const PAY_EFFECTS = ['airtable', 'ledger', 'parentEmail', 'staffAlert']
// Safe to run again after an unclear outcome: each looks for its own rows first.
const IDEMPOTENT = new Set(['airtable', 'waiver', 'ledger'])

export function jfpBookingIdFromSession(session) {
  return clean(session?.metadata?.jfpBookingId || '', 60)
}

// The lease carries a token so a run that overruns can never delete the
// lease a later run now holds.
async function takeLease(id) {
  const token = crypto.randomBytes(12).toString('hex')
  return (await kvCommand(['SET', keys.finalised(id), token, 'NX', 'EX', String(LEASE_SECONDS)])) === 'OK' ? token : ''
}
export const DROP_LEASE_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"
async function dropLease(id, token) { if (token) await kvCommand(['EVAL', DROP_LEASE_SCRIPT, '1', keys.finalised(id), token]) }

function classify(error) {
  const m = String(error?.message || error)
  return /Airtable \d{3}|Brevo \d{3}|not configured|INVALID|permission|row missing/i.test(m) ? 'failed' : 'uncertain'
}

async function runEffect(name, record, save, fn) {
  const cur = record.effects?.[name]
  if (cur?.status === 'done' || cur?.status === 'uncertain') return
  const attempts = (cur?.attempts || 0) + 1
  record.effects = { ...(record.effects || {}), [name]: { status: 'running', at: new Date().toISOString(), attempts } }
  await save(record)
  try {
    const result = await fn()
    record.effects[name] = { status: 'done', at: new Date().toISOString(), attempts, ...(result === false ? { note: 'nothing to do' } : {}) }
  } catch (error) {
    console.error(`jfp ${name} failed for ${record.id}`, error)
    record.effects[name] = { status: classify(error), at: new Date().toISOString(), attempts, error: String(error?.message || error).slice(0, 300) }
  }
  await save(record)
}

// The exact Stripe fee, from the balance transaction, not an estimate.
async function stripeFee(paymentIntentId) {
  if (!paymentIntentId) return null
  try {
    const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`)
    const bt = pi?.latest_charge?.balance_transaction
    return typeof bt?.fee === 'number' ? bt.fee : null
  } catch (error) {
    console.warn('jfp stripe fee read failed', error.message)
    return null
  }
}

export function splitFee(total, n) {
  if (total == null || n < 1) return null
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0))
}

// Split `total` cents across rows in proportion to `weights`, to the cent.
export function splitBy(total, weights) {
  if (total == null) return null
  const sum = weights.reduce((t, w) => t + Math.max(0, w), 0)
  if (!sum) return splitFee(total, weights.length)
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total)
  const out = raw.map(Math.floor)
  let rest = total - out.reduce((t, v) => t + v, 0)
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; rest > 0; k = (k + 1) % out.length, rest -= 1) out[order[k][1]] += 1
  return out
}

export function effectsSummary(record, list = EFFECTS) {
  const e = record.effects || {}
  const pending = list.filter((k) => !e[k] || e[k].status === 'running')
  const failed = list.filter((k) => e[k]?.status === 'failed')
  const uncertain = list.filter((k) => e[k]?.status === 'uncertain')
  return { pending, failed, uncertain, ok: !pending.length && !failed.length && !uncertain.length && !record.needsAttention }
}

const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
function sessionInfo(session) {
  return {
    sessionId: session?.id || '',
    intentId: typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id || '',
    amountCents: Number(session?.amount_total ?? 0),
  }
}

// ---------- payments we did not expect ----------

// Record it on the booking, flag it, and tell Lee once. Never drop it.
async function unexpectedPayment(record, session, save, reason) {
  const info = sessionInfo(session)
  const list = record.unexpectedPayments || []
  const seen = list.some((p) => p.sessionId === info.sessionId)
  if (seen) return { ok: true, attention: reason, record }
  list.push({ ...info, reason, at: new Date().toISOString() })
  record.unexpectedPayments = list
  record.needsAttention = [...new Set([...(record.needsAttention ? String(record.needsAttention).split(', ') : []), reason])].join(', ')
  await save(record)
  await audit({ by: 'stripe', action: `payment.${reason}`, target: record.id, after: info })
  if (await claimOnce(`jfp:attention:${info.sessionId}`)) {
    try { await sendAttentionAlert({ record, reason, info, config: await getConfig() }) } catch (error) { console.error('jfp attention alert failed', error) }
  }
  return { ok: true, attention: reason, record }
}

// Something a person should look at, flagged on the record, logged and
// emailed to staff once. Never blocks the rest of the payment's effects.
async function flagAttention(record, reason, save, extra = '') {
  record.needsAttention = [...new Set([...(record.needsAttention ? String(record.needsAttention).split(', ') : []), reason])].join(', ')
  await save(record)
  await audit({ by: 'system', action: `payment.${reason}`, target: record.id, after: { extra } })
  if (await claimOnce(`jfp:attention:${record.id}:${reason}`)) {
    try { await sendAttentionAlert({ record, reason, info: { amountCents: record.paidCents ?? record.amountPaidCents ?? 0, intentId: record.stripePaymentIntentId, sessionId: record.stripeSessionId, extra }, config: await getConfig() }) } catch (error) { console.error('jfp attention alert failed', error) }
  }
}

// ---------- online bookings ----------

function paidFieldsFresh(unitCents, fee, evidence) {
  return {
    ...(fee != null ? { 'Term 4 Stripe Fee AUD': fee / 100, 'Term 4 Net Collected AUD': (unitCents - fee) / 100, 'Term 4 Fee Reconciliation': 'Verified' } : { 'Term 4 Fee Reconciliation': 'Pending verification' }),
    'Term 4 Payment Evidence': evidence,
  }
}

function term4Fields({ booking, group, coachAirtableName, fee, index }) {
  const p = booking.players[index]
  const today = new Date().toISOString().slice(0, 10)
  return {
    'Player Name': p.name,
    'Parent Name': booking.parentName,
    'Email': booking.email,
    'Phone': booking.mobile,
    'Term 3 Day': group.day,
    'Term 3 Time': group.time,
    'Term 3 Location': group.location,
    'Coach': coachAirtableName || '',
    'Term 4 Confirmation': 'Confirmed',
    'Confirmation Date': today,
    'Term 4 Fee': booking.unitCents / 100,
    'Term 4 Amount Paid': booking.unitCents / 100,
    'Term 4 Payment Status': 'Paid',
    'Term 4 Payment Type': booking.paymentType || 'JFP 10 weeks',
    'Term 4 Notes': `Booked online${booking.option === 'oneToOne' ? ' as a 1 to 1 for the term [JFP-1TO1]' : ''}${p.age != null ? `, age ${p.age}` : ''}${p.isNew ? ', new player' : ''}${booking.proRata ? `, starts ${booking.startDate} (${booking.sessions} sessions, pro rata)` : ''}. [${ONLINE_TAG}:${booking.id}]${booking.notes ? `\nParent notes: ${booking.notes}` : ''}`,
    ...(p.sourceTerm3 ? { 'Source Term 3 Record ID': p.sourceTerm3 } : {}),
    ...(booking.kit ? { 'Training Kit': booking.kit } : {}),
    ...paidFieldsFresh(booking.unitCents, fee, `Stripe ${booking.stripePaymentIntentId} via ${booking.stripeSessionId}.${fee != null ? ' Fee from balance transaction' : ' Fee not yet read'}${booking.players.length > 1 ? `, split across ${booking.players.length} players in one payment` : ''}.`),
  }
}

async function runBookingEffects(booking, retry = new Set()) {
  const [group, config] = await Promise.all([getGroup(booking.groupId), getConfig()])
  const g = group || booking.groupSnapshot
  const coach = coachById(config, g.coachId)
  const save = saveBooking
  for (const k of retry) delete booking.effects?.[k]
  await runEffect('airtable', booking, save, async () => {
    const existing = await findTerm4ByTag(ONLINE_TAG, booking.id)
    if (existing.length) { booking.term4Ids = existing } else {
      const fees = splitFee(booking.stripeFeeCents, booking.players.length)
      // The same child already holding a place here (two tabs, two bookings):
      // still recorded, because the money moved, but flagged for a refund.
      const roster = await loadRoster({ fresh: true })
      const dupes = booking.players.filter((p) => roster.players.some((r) => r.groupId === booking.groupId && r.holdsPlace && normName(r.player) === normName(p.name) && !r.notes.includes(`[${ONLINE_TAG}:${booking.id}]`)))
      booking.term4Ids = await createTerm4Rows(booking.players.map((_, i) => term4Fields({ booking, group: g, coachAirtableName: coach?.airtableName, fee: fees?.[i] ?? null, index: i })))
      if (dupes.length) await flagAttention(booking, 'duplicate-enrolment', saveBooking, dupes.map((p) => p.name).join(', '))
    }
    // Airtable now holds these places; the KV hold can lapse.
    await settlePlaces(booking.groupId, booking.id, booking.players.length)
  })
  await runEffect('waiver', booking, save, async () => {
    const needs = booking.players.filter((p) => p.waiver)
    if (!needs.length) return false
    const tag = `[${ONLINE_TAG}:${booking.id}]`
    const existing = await findWaiversByTag(tag)
    if (existing.length) { booking.waiverIds = existing; return }
    booking.waiverIds = await createWaiverRows(needs.map((p) => waiverFields({ player: p, parent: { name: booking.parentName, email: booking.email, mobile: booking.mobile }, config, signature: p.waiver.signature, acceptedAt: p.waiver.acceptedAt, media: p.waiver.media, tag })))
    await bustRosterCache()
  })
  await runEffect('ledger', booking, save, async () => {
    const paymentId = booking.stripePaymentIntentId || booking.id
    const existing = await findLedgerByPayment(paymentId)
    if (existing.length) { booking.ledgerId = existing[0]; return }
    booking.ledgerId = await createLedgerRow({
      paymentId, config, playerNames: booking.players.map((p) => p.name), amountCents: booking.amountPaidCents ?? booking.priceCents,
      paidAt: booking.paidAt, sourceIds: booking.term4Ids || [], sessionId: booking.stripeSessionId, intentId: booking.stripePaymentIntentId,
      notes: `JFP online booking ${booking.id}${booking.stripeFeeCents != null ? `. Stripe fee A$${(booking.stripeFeeCents / 100).toFixed(2)}` : ''}`,
    })
  })
  await runEffect('parentEmail', booking, save, () => sendParentConfirmation({ booking, group: g, config, siteUrl: booking.siteUrl || '' }))
  await runEffect('staffAlert', booking, save, () => sendStaffAlert({ booking, group: g, config }))
  await runEffect('coachAlert', booking, save, () => sendCoachAlert({ booking, group: g, config }))
}

// ---------- payment requests ----------

async function runPayreqEffects(payreq, retry = new Set()) {
  const config = await getConfig()
  const group = payreq.groupId ? await getGroup(payreq.groupId) : null
  const save = savePayreq
  for (const k of retry) delete payreq.effects?.[k]
  await runEffect('airtable', payreq, save, async () => {
    // Next term: no Term 4 row changes; the place is recorded as held or paid.
    if (payreq.next) {
      const row = await getTerm4Row(payreq.next.rowId)
      const before = (await nextStatuses(payreq.next.term))[payreq.next.rowId]
      // The hold already paid is saved on the link when it is made, so a retry
      // or repair records the same total every time.
      const paid = (payreq.paidCents ?? payreq.amountCents) + Number(payreq.next.holdPaidCents || 0)
      // A link that is no longer this player's current one was paid anyway:
      // still recorded, flagged for a person to look at.
      if (before?.payreqId && before.payreqId !== payreq.id && ['held', 'paid'].includes(before.status)) await flagAttention(payreq, 'second-payment', savePayreq, payreq.playerNames.join(', '))
      const status = payreq.next.choice === 'hold' ? 'held' : 'paid'
      const who = row || { id: payreq.next.rowId, player: payreq.playerNames[0], parent: payreq.parentName, email: payreq.email, phone: '', coach: '' }
      await recordNext({ term: payreq.next.term, row: who, group, status, amountCents: paid, holdCents: status === 'held' ? paid : null, paymentId: payreq.stripePaymentIntentId || payreq.id, note: status === 'held' ? `Non-refundable hold, comes off the ${payreq.next.term} fee.` : `${payreq.next.term} paid in full.`, by: payreq.email })
      await setNextStatus(payreq.next.term, payreq.next.rowId, { status, payreqId: payreq.id, paidCents: paid })
      return
    }
    const rows = []
    for (const id of payreq.term4Ids) {
      const row = await getTerm4Row(id)
      if (!row) throw new Error(`Airtable row missing: ${id}`)
      rows.push(row)
    }
    // Split by what each row still owes (siblings on 850 and 425 stay right).
    const owed = rows.map((r) => Math.max(0, cents(r.feeAud) - cents(r.paidAud)))
    const share = splitBy(payreq.paidCents ?? payreq.amountCents, owed)
    const fees = payreq.stripeFeeCents != null ? splitBy(payreq.stripeFeeCents, share) : null
    const updates = []
    rows.forEach((row, i) => {
      // Already applied by an earlier attempt: leave this row alone.
      if (row.notes.includes(`[PAID:${payreq.id}]`)) return
      const paid = cents(row.paidAud) + share[i]
      const fee = cents(row.feeAud) || paid
      const addedFee = fees?.[i] ?? null
      updates.push({ id: row.id, fields: {
        'Term 4 Amount Paid': paid / 100,
        'Term 4 Payment Status': paid >= fee ? 'Paid' : 'Partially Paid',
        ...(['Awaiting Reply', 'Not Contacted', 'Needs Follow-up', ''].includes(row.confirmation) ? { 'Term 4 Confirmation': 'Confirmed', 'Confirmation Date': new Date().toISOString().slice(0, 10) } : {}),
        'Term 4 Notes': appendNote(row.notes, `Paid ${(share[i] / 100).toFixed(2)} online. [PAID:${payreq.id}]`),
        // Add to what earlier payments recorded; never overwrite them.
        ...(addedFee != null ? {
          'Term 4 Stripe Fee AUD': (cents(row.stripeFeeAud) + addedFee) / 100,
          'Term 4 Net Collected AUD': (cents(row.netAud) + share[i] - addedFee) / 100,
          ...(row.reconciliation === '' || row.reconciliation === 'Pending verification' || row.reconciliation === 'Verified' ? { 'Term 4 Fee Reconciliation': 'Verified' } : {}),
        } : {}),
        'Term 4 Payment Evidence': `${row.evidence ? `${row.evidence}\n` : ''}Stripe ${payreq.stripePaymentIntentId} via ${payreq.stripeSessionId}, ${(share[i] / 100).toFixed(2)}${addedFee != null ? `, fee ${(addedFee / 100).toFixed(2)} from balance transaction` : ', fee not yet read'}${rows.length > 1 ? `, one payment split across ${rows.length} rows by balance owed` : ''}.`.slice(-4000),
      } })
    })
    if (updates.length) await updateTerm4Rows(updates)
    // What this payment put on each row, so a later refund takes back only that.
    payreq.rowShares = Object.fromEntries(rows.map((row, i) => [row.id, share[i]]))
    // More paid than the rows cost (two links paid for one player): flag it.
    const over = rows.filter((row, i) => !row.notes.includes(`[PAID:${payreq.id}]`) && cents(row.paidAud) + share[i] > (cents(row.feeAud) || Infinity))
    if (over.length) await flagAttention(payreq, 'overpaid', savePayreq, over.map((r) => r.player).join(', '))
  })
  await runEffect('ledger', payreq, save, async () => {
    const paymentId = payreq.stripePaymentIntentId || payreq.id
    const existing = await findLedgerByPayment(paymentId)
    if (existing.length) { payreq.ledgerId = existing[0]; return }
    payreq.ledgerId = await createLedgerRow({
      paymentId, config: payreq.next ? { ...config, term: payreq.next.term } : config, playerNames: payreq.playerNames, amountCents: payreq.paidCents ?? payreq.amountCents, paidAt: payreq.paidAt,
      sourceIds: payreq.term4Ids, sessionId: payreq.stripeSessionId, intentId: payreq.stripePaymentIntentId,
      notes: `JFP payment request ${payreq.id} (${payreq.reason || 'payment'})${payreq.stripeFeeCents != null ? `. Stripe fee A$${(payreq.stripeFeeCents / 100).toFixed(2)}` : ''}`,
    })
  })
  await runEffect('parentEmail', payreq, save, () => sendPaymentReceipt({ payreq, group, config, siteUrl: payreq.siteUrl || '' }))
  await runEffect('staffAlert', payreq, save, () => sendPaymentStaffAlert({ payreq, group, config }))
}

// ---------- entry points ----------

// Returns { ok, already?, busy?, attention?, booking|payreq }. busy means
// another run holds the lease: the webhook answers 500 so Stripe retries.
export async function finaliseJfpBooking(id, session) {
  const isPay = id.startsWith('PAY-')
  const get = isPay ? getPayreq : getBooking
  const save = isPay ? savePayreq : saveBooking
  let record = await get(id)
  if (!record) return { ok: false, reason: 'unknown' }
  const info = sessionInfo(session)
  const lease = await takeLease(id)
  if (!lease) return { ok: false, busy: true, [isPay ? 'payreq' : 'booking']: record }
  try {
    record = await get(id)
    if (record.status === 'cancelled' || record.status === 'expired') {
      return { ...(await unexpectedPayment(record, session, save, 'paid-after-cancel')), [isPay ? 'payreq' : 'booking']: record }
    }
    if (record.status === 'paid' && record.stripeSessionId && info.sessionId && record.stripeSessionId !== info.sessionId) {
      return { ...(await unexpectedPayment(record, session, save, 'second-payment')), already: true, [isPay ? 'payreq' : 'booking']: record }
    }
    if (record.status !== 'paid') {
      if (!isPay) await confirmPlaces(record.groupId, record.id, record.players.length)
      const heldUntil = Date.parse(record.holdExpiresAt || 0)
      record = {
        ...record,
        status: 'paid',
        paidAt: new Date().toISOString(),
        stripeSessionId: info.sessionId || record.stripeSessionId,
        stripePaymentIntentId: info.intentId,
        ...(isPay ? { paidCents: info.amountCents || record.amountCents } : { amountPaidCents: info.amountCents || record.priceCents }),
        needsAttention: !isPay && heldUntil && Date.now() > heldUntil ? 'late-payment' : (record.needsAttention || ''),
      }
      record.stripeFeeCents = await stripeFee(record.stripePaymentIntentId)
      await save(record)
      if (!isPay) await dropParentHold(record.email, record.id)
      if (isPay) await audit({ by: record.email, action: 'payreq.paid', target: record.id, after: { cents: record.paidCents } })
    }
    if (isPay) await runPayreqEffects(record); else await runBookingEffects(record)
    return { ok: true, already: false, [isPay ? 'payreq' : 'booking']: record }
  } finally {
    await dropLease(id, lease)
  }
}

// Staff repair: retry failures, unfinished steps, and unclear outcomes for
// the steps that are safe to repeat. Emails with an unclear outcome are left
// for a human, so nobody gets a second copy. Refuses while a run is live.
export async function repairJfpBooking(id) {
  const isPay = id.startsWith('PAY-')
  const get = isPay ? getPayreq : getBooking
  const record = await get(id)
  if (!record || record.status !== 'paid') return { ok: false, reason: 'not-paid' }
  const lease = await takeLease(id)
  if (!lease) return { ok: false, reason: 'busy' }
  try {
    const fresh = await get(id)
    const list = isPay ? PAY_EFFECTS : EFFECTS
    const retry = new Set(list.filter((k) => {
      const s = fresh.effects?.[k]?.status
      return s === 'failed' || s === 'running' || (s === 'uncertain' && IDEMPOTENT.has(k))
    }))
    if (fresh.stripeFeeCents == null) fresh.stripeFeeCents = await stripeFee(fresh.stripePaymentIntentId)
    if (isPay) await runPayreqEffects(fresh, retry); else await runBookingEffects(fresh, retry)
    return { ok: true, summary: effectsSummary(fresh, list) }
  } finally {
    await dropLease(id, lease)
  }
}

// Only the session the record is waiting on may release it: an older
// session we closed ourselves (the parent paid again later) changes nothing.
export async function expireJfpBooking(id, session) {
  const sid = session?.id || ''
  if (id.startsWith('PAY-')) {
    const payreq = await getPayreq(id)
    if (payreq?.status === 'checkout' && (!sid || payreq.stripeSessionId === sid)) { await savePayreq({ ...payreq, status: 'open', stripeSessionId: '' }); return { changed: true } }
    return { changed: false }
  }
  const booking = await getBooking(id)
  if (!booking || !['held', 'reserving'].includes(booking.status)) return { changed: false }
  if (sid && ((booking.stripeSessionId && booking.stripeSessionId !== sid) || (booking.replacedSessionIds || []).includes(sid))) return { changed: false }
  await releasePlaces(booking.groupId, booking.id)
  await dropParentHold(booking.email, booking.id)
  await saveBooking({ ...booking, status: 'expired', expiredAt: new Date().toISOString() })
  return { changed: true }
}
