// Extra sessions: the terms and a family cancelling (Lee, 5 Nov 2026).
//
// Lee's rule (7 Nov 2026, after Selma cancelled on Dean with 30 hours notice):
//   48 hours or more before   what they paid, less A$5 (card processing)
//   24 to 48 hours before     half what they paid
//   under 24 hours, no show   nothing
//   someone else books the place after a cancel under 48 hours: the family
//   gets the 48 hour refund (the rest is refunded automatically)
// Bookings made before RULE48_FROM keep the 24 hour terms they ticked (5 Nov):
// 24 hours or more, back less A$5; under 24 hours, nothing.
// Coach pay (Lee, 7 Nov): a paid booking cancelled under 48 hours and nobody
// takes the place: the coach is paid half. Someone takes it: as normal.
// Families cancel in My account; the place opens again on the public page
// and the coach is emailed.
//
// The terms: every family ticks them once (TERMS_VERSION), and a family ticks
// the extra session terms again each time it books one, before it pays.
// Acceptances: KV hash jfp:terms-accepted, email -> { version, at, extraAt }.
//
// The refund itself is the Revenue agent's refundPayreq (api/_jfp-refund-actions.js):
// one refund path for the Money register and this button. Until it is on
// main, a cancel that needs a refund is refused and the button stays hidden.
import { kvCommand, clean, audit, formatAud, getPayreq, coachById, coachLabel, dateLabel } from './_jfp-store.js'
import { getSlot, liveBookings, removeBooking, committedBookings, paidPayreqs, isWhole, setLateCancel, takeLateCancelPlace } from './_jfp-extra.js'
import { noticeFor } from './_jfp-cancel.js'
import { sendStaffNotice } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'

// 2026-11-05b: JFP term fee refunds added. 2026-11-07: extra sessions 48 hours.
export const TERMS_VERSION = '2026-11-07'
export const CANCEL_FEE_CENTS = 500
export const CANCEL_NOTICE_MINUTES = 24 * 60
export const HALF_NOTICE_MINUTES = 48 * 60
// Bookings made from here are on the 48 hour terms (booking.at, ISO).
export const RULE48_FROM = '2026-11-06T21:56:00.000Z'
export const ruleFor = (booking) => (String(booking?.at || '') >= RULE48_FROM ? '48h' : '24h')
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
// band: 'full' (back less A$5), 'half' (48 hour terms only) or 'late' (nothing).
// fullCents is the 48 hour refund, what a family gets if their place is taken.
// { band, late, refundCents, fullCents, paidCents, minutesLeft } or { error }.
export function cancelQuote({ slot, paidCents, rule = '48h', nowMs = Date.now() }) {
  const n = noticeFor({ date: slot.date, time: slot.time, nowMs })
  if (!n) return { error: 'That session has no start time. Contact Ligia.' }
  if (n.minutes <= 0) return { error: 'That session has already started.' }
  const fullCents = Math.max(0, paidCents - CANCEL_FEE_CENTS)
  const band = n.minutes < CANCEL_NOTICE_MINUTES ? 'late' : rule === '48h' && n.minutes < HALF_NOTICE_MINUTES ? 'half' : 'full'
  const refundCents = band === 'full' ? fullCents : band === 'half' ? Math.floor(paidCents / 2) : 0
  return { band, rule, late: band === 'late', minutesLeft: n.minutes, paidCents, fullCents, refundCents, feeCents: paidCents - refundCents }
}

// Whether someone booking after this family cancels takes their place: the
// session would be full without it (counting earlier late cancels still
// waiting). A group session with places free anyway: no.
function placeIsWanted(s, b, paid) {
  if (isWhole(s)) return true
  const held = committedBookings(s, paid).length
  const waiting = (s.bookings || []).filter((x) => x.status === 'removed' && x.lateCancel?.refill === 'pending').length
  return held + waiting >= Number(s.capacity || 1)
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
  const qt = cancelQuote({ slot, paidCents: f.paidCents, rule: ruleFor(f.b) })
  if (qt.error) return null
  // A paid booking with time to spare needs the refund path; hidden until it is live.
  if (f.paid && qt.refundCents > 0 && !ready) return null
  // 48 hour terms: under 48 hours, the rest comes back if someone takes the place.
  const refill = f.paid && qt.rule === '48h' && qt.band !== 'full' && qt.fullCents > qt.refundCents && placeIsWanted(f.s, f.b, await paidPayreqs([f.s]))
  return {
    paid: f.paid, band: qt.band, rule: qt.rule, late: qt.late, refundCents: qt.refundCents, refundLabel: formatAud(qt.refundCents), paidLabel: formatAud(f.paidCents),
    refill, fullLabel: formatAud(qt.fullCents),
  }
}

// Cancel: confirm false gives the quote only. Then: the refund (if any), the
// booking off (the place shows again), the unpaid charge off, the coach and
// Lee told. { ok, refundCents, late } or { error, status }.
export async function cancelExtraBooking({ config, parent, body }) {
  const email = parent.email.toLowerCase()
  const f = await familyBooking(body.slotId, email)
  if (f.error) return { error: f.error, status: 404 }
  const qt = cancelQuote({ slot: f.s, paidCents: f.paidCents, rule: ruleFor(f.b) })
  if (qt.error) return { error: qt.error, status: 409 }
  if (body.confirm !== true) return { ok: true, quote: { ...qt, paid: f.paid, refundLabel: formatAud(qt.refundCents) } }
  // Before the booking comes off: would a new booking take this family's place?
  const lateCancel = f.paid && qt.band !== 'full'
  const wanted = lateCancel && placeIsWanted(f.s, f.b, await paidPayreqs([f.s]))
  let refundId = ''
  if (f.paid && qt.refundCents > 0) {
    if (!(await refundReady())) return { error: 'Cancelling with a refund opens very soon. For now, contact Ligia and she will sort it.', status: 503 }
    const { refundPayreq } = await import('./_jfp-refund-actions.js')
    const r = await refundPayreq({ payreqId: f.q.id, amountCents: qt.refundCents, by: email, reason: `Family cancelled the extra session ${dateLabel(f.s.date)} ${f.s.time} with ${Math.floor(qt.minutesLeft / 60)} hours notice${qt.band === 'half' ? ', half refunded' : ''}` })
    if (!r?.ok) return { error: r?.error || 'The refund did not go through. Nothing has changed. Try again, or contact Ligia.', status: 502 }
    refundId = r.refundId || ''
  }
  // The refund frees the place itself (releaseExtraForPayreq); otherwise take it off here.
  const still = liveBookings((await getSlot(f.s.id)) || { bookings: [] }).some((x) => x.id === f.b.id)
  if (still) await removeBooking({ principal: { email }, isAdmin: true, slotId: f.s.id, bookingId: f.b.id })
  // Under 48 hours with money kept: the coach is paid half unless someone takes
  // the place; on the 48 hour terms the family then gets the rest back too.
  if (lateCancel) {
    await setLateCancel(f.s.id, f.b.id, {
      at: new Date().toISOString(), band: qt.band, rule: qt.rule, payreqId: f.q.id, paidCents: f.paidCents, refundCents: qt.refundCents,
      fullCents: qt.rule === '48h' ? qt.fullCents : qt.refundCents, refill: wanted ? 'pending' : 'open',
    }).catch((e) => console.error('jfp extra late cancel note failed', e))
  }
  if (!f.paid) {
    const { listCharges, cancelCharge } = await import('./_jfp-charges.js')
    const id = f.b.chargeId || (await listCharges()).find((c) => c.payreqId === f.b.payreqId)?.id
    if (id) await cancelCharge({ id, principal: { email, name: email }, why: 'Family cancelled the extra session' }).catch(() => {})
  }
  await audit({ by: email, action: 'extra.family.cancel', target: f.s.id, after: { booking: f.b.id, player: f.b.name, paid: f.paid, band: qt.band, rule: qt.rule, refundCents: qt.refundCents, refundId } })
  await tellCancelled({ config, slot: f.s, booking: f.b, qt, paid: f.paid }).catch((e) => console.error('jfp extra cancel notice failed', e))
  return { ok: true, refundCents: qt.refundCents, refundLabel: formatAud(qt.refundCents), band: qt.band, late: qt.late, paid: f.paid }
}

async function tellCancelled({ config, slot, booking, qt, paid }) {
  const when = `${dateLabel(slot.date)} at ${slot.time}`
  const notice = qt.band === 'late' ? 'Under 24 hours notice' : qt.band === 'half' ? 'Under 48 hours notice' : 'Good notice'
  const money = !paid ? 'It was not paid yet.' : qt.band === 'late' ? `${notice}, so no refund.` : qt.band === 'half' ? `${notice}, so half refunded (${formatAud(qt.refundCents)}).` : `Refunded ${formatAud(qt.refundCents)} (A$5 kept).`
  // Lee, 7 Nov 2026: nobody takes the place, the coach is paid half; someone does, as normal.
  const coachPay = paid && qt.band !== 'full' ? 'If nobody books the place, you are paid half for this session. If someone books it, it is as normal.' : ''
  const c = coachById(config, slot.coachId)
  const jobs = [telegramAlert(`Extra session cancelled by the family: ${booking.name}, ${when}, ${slot.location}${c ? `, Coach ${coachLabel(c)}` : ''}. ${money} The place is open again.${coachPay ? ' If nobody takes it, the coach is paid half.' : ''}`)]
  if (c?.email) jobs.push(sendStaffNotice({
    to: [{ email: c.email, name: `Coach ${c.name}` }], subject: `Extra session cancelled: ${booking.name}, ${when}`,
    heading: 'Extra session cancelled', paras: [`Hi ${c.name}. ${booking.name} has cancelled the extra session on ${when} at ${slot.location}.`, 'The place is open again for another family to book.', ...(coachPay ? [coachPay] : [])],
    list: [['Session', `${when}, ${slot.location}`], ['Player', booking.name]], cta: { label: 'Open the portal', url: 'https://jonerfootball.com/jfp-portal/' }, kind: 'extra cancelled to coach',
  }))
  await Promise.allSettled(jobs)
}

// Someone new now holds a place on a session (a family paid, or a coach or
// Ligia put a player on). They take the place of the earliest late cancel
// still waiting: the coach is paid as normal, and on the 48 hour terms that
// family gets the rest of the 48 hour refund back. Once per new booking.
// Never throws: the booking that triggered it must always finish.
export async function fillLateCancel({ slotId, filler }) {
  try {
    if (!slotId || !filler?.id) return null
    if (Number(await kvCommand(['HSETNX', 'jfp:extra-refill', filler.id, new Date().toISOString()])) !== 1) return null
    const got = await takeLateCancelPlace(slotId, filler)
    if (!got) return null
    const { booking: b, slot: s } = got
    const lc = b.lateCancel
    const when = `${dateLabel(s.date)} ${s.time}`
    let line = `Extra session ${when}, ${s.location}: ${filler.name} took the place ${b.name} cancelled late, so the coach is paid as normal.`
    if (lc.rule === '48h' && lc.payreqId) {
      const q = await getPayreq(lc.payreqId)
      const back = Number(q?.refundedCents || 0)
      const more = Math.max(0, Number(lc.fullCents || 0) - back)
      if (more > 0) {
        const { refundPayreq } = await import('./_jfp-refund-actions.js')
        const r = await refundPayreq({ payreqId: lc.payreqId, amountCents: more, by: 'system: place taken', reason: `${filler.name} booked the place ${b.name} cancelled (${when}), so the 48 hour refund applies` }).catch((e) => ({ ok: false, error: e.message }))
        await setLateCancel(s.id, b.id, r?.ok ? { topUpCents: more, topUpRefundId: r.refundId || '', topUpAt: new Date().toISOString() } : { topUpError: r?.error || 'failed' })
        line += r?.ok ? ` ${b.name}'s family is refunded ${formatAud(more)} more (${formatAud(back + more)} back in all, A$5 kept).` : ` The extra ${formatAud(more)} refund to ${b.name}'s family DID NOT go through (${r?.error || 'error'}). Refund it in Money.`
      }
    }
    await telegramAlert(line).catch(() => {})
    return { booking: b.id }
  } catch (error) {
    console.error('jfp extra fill late cancel failed', error)
    return null
  }
}
