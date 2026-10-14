// My account > Book extra sessions: the sessions a family can book now and
// booking one (money engineer, 14 Oct 2026). The sessions and places are the
// coach side's (api/_jfp-extra.js, not changed here); the payment is a player
// charge (api/_jfp-charges.js).
//
// Booking, in this order: the place is held (reserveExtraPlace; a full or
// closed session is said plainly), then the charge is made (createPlayerCharge,
// ref extra:<slotId>:<bookingId>, so a retry never makes two), then the
// booking is told its charge (setBookingCharge), then the family goes to the
// usual Stripe page. If the charge cannot be made the place stays held and
// the coach sees "Payment link to come".
//
// Families never see a coach's name or another family's details.
import { listExtraSlots, getExtraSlot, reserveExtraPlace, setBookingCharge } from './_jfp-extra.js'
import { createPlayerCharge } from './_jfp-charges.js'
import { getPayreq, clean } from './_jfp-store.js'
import { profileKey } from './_jfp-profiles.js'

// What a family may see of a session: no coach, no other bookings.
export function familySlot(s) {
  if (!s) return null
  const { coachId, coachName, ...rest } = s
  return rest
}
export async function bookableSlots(config) {
  return (await listExtraSlots({ config, publicOnly: true }).catch(() => [])).map(familySlot)
}
export async function privateSlot(config, { slotId, token }) {
  return familySlot(await getExtraSlot({ config, id: clean(slotId, 60), token: clean(token, 80) }))
}

// { ok, payreqId, paid? } or { ok: false, status, error, code? }. The caller
// then opens the Stripe page for payreqId (My account's own pay()).
export async function bookExtraPlace({ config, parent, fam, body, siteUrl }) {
  const slotId = clean(body.slotId, 60)
  // The session itself (and the coach it is with), read with its private key if it has one.
  const slot = await getExtraSlot({ config, id: slotId, token: clean(body.k, 80) })
  if (!slot) return { ok: false, status: 404, error: 'That session is not open to book, or the link is not right. Ask Ligia for a new one.' }
  const p = fam.players.find((x) => x.key === clean(body.playerKey, 80))
  if (!p) return { ok: false, status: 400, error: 'Choose the player.' }
  // The waiver first, as for every payment (nothing is held without it).
  if (!p.waiver) return { ok: false, status: 400, code: 'waiver', error: `Sign ${p.name}'s waiver first, then book.` }
  const row = p.term4.find((r) => r.holdsPlace) || p.term4[0] || null
  const pk = row ? '' : profileKey(p.name, parent.email)
  const held = await reserveExtraPlace({ slotId: slot.id, rowId: row?.id || '', profileKey: pk, name: p.name, email: parent.email, mobile: clean(body.mobile, 30) || fam.mobile || '', by: parent.email, from: 'family' })
  if (held.error) return { ok: false, status: 409, code: 'slot', error: held.error }
  const booking = held.booking
  let payreqId = booking.payreqId || ''
  if (!payreqId) {
    const c = await createPlayerCharge({
      config, principal: { email: parent.email, name: fam.parentName || parent.email },
      ...(row ? { rowId: row.id } : { profileKey: pk }), email: parent.email, playerName: p.name, parentName: fam.parentName || '',
      amountCents: slot.priceCents, label: `Extra session, ${slot.dateLabel} ${slot.time}`, kind: 'extra',
      sessionDate: slot.date, coachId: slot.coachId, ref: `extra:${slot.id}:${booking.id}`, siteUrl,
    })
    if (!c.ok) {
      console.error('jfp family extra charge failed', slot.id, booking.id, c.error)
      return { ok: false, status: 502, code: 'charge', error: `${p.name}'s place is held. We could not open the payment just now; we will send you the payment link.` }
    }
    payreqId = c.payreqId
    await setBookingCharge({ slotId: slot.id, bookingId: booking.id, payreqId })
  }
  const q = await getPayreq(payreqId)
  if (q?.status === 'paid') return { ok: true, payreqId, paid: true, already: true }
  return { ok: true, payreqId, already: Boolean(held.already) }
}
