// Extra sessions: the terms and a family cancelling (Lee, 5 Nov 2026).
//
// Lee's rule: cancel at least 24 hours before the session starts and the
// family gets back what they paid less A$5 (card processing). Under 24 hours,
// or a no show, nothing comes back. Families cancel in My account; the place
// opens again on the public page and the coach is emailed.
//
// The terms: every family ticks them once (TERMS_VERSION), and a family ticks
// the extra session terms again each time it books one, before it pays.
// Acceptances: KV hash jfp:terms-accepted, email -> { version, at, extraAt }.
//
// The refund itself is the Revenue agent's refundPayreq (api/_jfp-refund-actions.js):
// one refund path for the Money register and this button. Until it is on
// main, a cancel that needs a refund is refused and the button stays hidden.
import { kvCommand, clean, audit, formatAud, getPayreq, coachById, coachLabel, dateLabel } from './_jfp-store.js'
import { getSlot, liveBookings, removeBooking } from './_jfp-extra.js'
import { noticeFor } from './_jfp-cancel.js'
import { sendStaffNotice } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'

// 2026-11-05b: JFP term fee refunds added, so everyone ticks again.
export const TERMS_VERSION = '2026-11-05b'
export const CANCEL_FEE_CENTS = 500
export const CANCEL_NOTICE_MINUTES = 24 * 60
const ACCEPTED = 'jfp:terms-accepted'

const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
export async function termsAccepted(email) { return parse(await kvCommand(['HGET', ACCEPTED, String(email).toLowerCase()])) || null }
export async function needsTerms(email) { return (await termsAccepted(email))?.version !== TERMS_VERSION }
export async function acceptTerms(email, { extra = false, ua = '' } = {}) {
  const e = String(email).toLowerCase()
  const now = new Date().toISOString()
  const cur = (await termsAccepted(e)) || {}
  const next = extra ? { ...cur, extraVersion: TERMS_VERSION, extraAt: now } : { ...cur, version: TERMS_VERSION, at: now, ua: clean(ua, 200) }
  await kvCommand(['HSET', ACCEPTED, e, JSON.stringify(next)])
  await audit({ by: e, action: extra ? 'terms.accept.extra' : 'terms.accept', target: e, after: { version: TERMS_VERSION } })
  return next
}

export async function refundReady() {
  try { return typeof (await import('./_jfp-refund-actions.js')).refundPayreq === 'function' } catch { return false }
}

// What cancelling now would mean, for the family's own booking on a session.
// { refundCents, late, paidCents, minutesLeft } or { error }.
export function cancelQuote({ slot, paidCents, nowMs = Date.now() }) {
  const n = noticeFor({ date: slot.date, time: slot.time, nowMs })
  if (!n) return { error: 'That session has no start time. Contact Ligia.' }
  if (n.minutes <= 0) return { error: 'That session has already started.' }
  const late = n.minutes < CANCEL_NOTICE_MINUTES
  return { late, minutesLeft: n.minutes, paidCents, refundCents: late ? 0 : Math.max(0, paidCents - CANCEL_FEE_CENTS), feeCents: late ? paidCents : Math.min(paidCents, CANCEL_FEE_CENTS) }
}

// The family's booking on a slot, and what it paid. Only a booking the family
// made themselves can be cancelled here; one a coach or staff added is theirs to change.
async function familyBooking(slotId, email) {
  const s = await getSlot(clean(slotId, 60))
  if (!s || s.status !== 'open') return { error: 'That session is not on any more.' }
  const b = liveBookings(s).find((x) => x.email === email && x.from === 'family' && x.payreqId)
  if (!b) return { error: 'This session was booked for you by a coach or Ligia. Contact Ligia to change it.' }
  const q = await getPayreq(b.payreqId)
  const paid = q?.status === 'paid'
  const paidCents = paid ? Number(q.paidCents ?? q.amountCents ?? 0) - Number(q.refundedCents || 0) : 0
  return { s, b, q, paid, paidCents }
}

export async function cancelView(slot, email, ready) {
  const f = await familyBooking(slot.id, email).catch(() => ({ error: 'x' }))
  if (f.error) return null
  const qt = cancelQuote({ slot, paidCents: f.paidCents })
  if (qt.error) return null
  // A paid booking with time to spare needs the refund path; hidden until it is live.
  if (f.paid && !qt.late && qt.refundCents > 0 && !ready) return null
  return { paid: f.paid, late: qt.late, refundCents: qt.refundCents, refundLabel: formatAud(qt.refundCents), paidLabel: formatAud(f.paidCents) }
}

// Cancel: confirm false gives the quote only. Then: the refund (if any), the
// booking off (the place shows again), the unpaid charge off, the coach and
// Lee told. { ok, refundCents, late } or { error, status }.
export async function cancelExtraBooking({ config, parent, body }) {
  const email = parent.email.toLowerCase()
  const f = await familyBooking(body.slotId, email)
  if (f.error) return { error: f.error, status: 404 }
  const qt = cancelQuote({ slot: f.s, paidCents: f.paidCents })
  if (qt.error) return { error: qt.error, status: 409 }
  if (body.confirm !== true) return { ok: true, quote: { ...qt, paid: f.paid, refundLabel: formatAud(qt.refundCents) } }
  let refundId = ''
  if (f.paid && qt.refundCents > 0) {
    if (!(await refundReady())) return { error: 'Cancelling with a refund opens very soon. For now, contact Ligia and she will sort it.', status: 503 }
    const { refundPayreq } = await import('./_jfp-refund-actions.js')
    const r = await refundPayreq({ payreqId: f.q.id, amountCents: qt.refundCents, by: email, reason: `Family cancelled the extra session ${dateLabel(f.s.date)} ${f.s.time} with ${Math.floor(qt.minutesLeft / 60)} hours notice` })
    if (!r?.ok) return { error: r?.error || 'The refund did not go through. Nothing has changed. Try again, or contact Ligia.', status: 502 }
    refundId = r.refundId || ''
  }
  // The refund frees the place itself (releaseExtraForPayreq); otherwise take it off here.
  const still = liveBookings((await getSlot(f.s.id)) || { bookings: [] }).some((x) => x.id === f.b.id)
  if (still) await removeBooking({ principal: { email }, isAdmin: true, slotId: f.s.id, bookingId: f.b.id })
  if (!f.paid) {
    const { listCharges, cancelCharge } = await import('./_jfp-charges.js')
    const id = f.b.chargeId || (await listCharges()).find((c) => c.payreqId === f.b.payreqId)?.id
    if (id) await cancelCharge({ id, principal: { email, name: email }, why: 'Family cancelled the extra session' }).catch(() => {})
  }
  await audit({ by: email, action: 'extra.family.cancel', target: f.s.id, after: { booking: f.b.id, player: f.b.name, paid: f.paid, late: qt.late, refundCents: qt.refundCents, refundId } })
  await tellCancelled({ config, slot: f.s, booking: f.b, qt, paid: f.paid }).catch((e) => console.error('jfp extra cancel notice failed', e))
  return { ok: true, refundCents: qt.refundCents, refundLabel: formatAud(qt.refundCents), late: qt.late, paid: f.paid }
}

async function tellCancelled({ config, slot, booking, qt, paid }) {
  const when = `${dateLabel(slot.date)} at ${slot.time}`
  const money = !paid ? 'It was not paid yet.' : qt.late ? 'Under 24 hours notice, so no refund.' : `Refunded ${formatAud(qt.refundCents)} (A$5 kept).`
  const c = coachById(config, slot.coachId)
  const jobs = [telegramAlert(`Extra session cancelled by the family: ${booking.name}, ${when}, ${slot.location}${c ? `, Coach ${coachLabel(c)}` : ''}. ${money} The place is open again.`)]
  if (c?.email) jobs.push(sendStaffNotice({
    to: [{ email: c.email, name: `Coach ${c.name}` }], subject: `Extra session cancelled: ${booking.name}, ${when}`,
    heading: 'Extra session cancelled', paras: [`Hi ${c.name}. ${booking.name} has cancelled the extra session on ${when} at ${slot.location}.`, 'The place is open again for another family to book.'],
    list: [['Session', `${when}, ${slot.location}`], ['Player', booking.name]], cta: { label: 'Open the portal', url: 'https://jonerfootball.com/jfp-portal/' }, kind: 'extra cancelled to coach',
  }))
  await Promise.allSettled(jobs)
}
