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
// Families see the coach and what kind of session it is (Lee, 19 Oct 2026:
// "parents will want to know that"), never another family's details.
import { listExtraSlots, getExtraSlot, reserveExtraPlace, reserveWholeSession, setBookingCharge } from './_jfp-extra.js'
import { createPlayerCharge } from './_jfp-charges.js'
import { telegramAlert } from './_jfp-notify.js'
import { getPayreq, clean, formatAud } from './_jfp-store.js'
import { profileKey } from './_jfp-profiles.js'

// 1 on 1, shared or a small group, from how many players the session takes.
export function sessionKind(capacity) {
  const n = Number(capacity) || 1
  return n <= 1 ? '1 on 1' : n === 2 ? 'Shared session, 2 players' : `Group of ${n}`
}
// What a family may see of a session: the coach's name and the kind of
// session, never the coach's id or other bookings.
export function familySlot(s) {
  if (!s) return null
  const { coachId, coachName, ...rest } = s
  return { ...rest, coach: coachName ? `Coach ${coachName}` : '', kind: s.whole ? s.optionsLabel : sessionKind(s.capacity) }
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
  if (slot.whole) return bookWholeSession({ config, parent, fam, body, siteUrl, slot })
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
      await telegramAlert(`Extra session payment link failed to open: ${slot.dateLabel} ${slot.time} (${slot.id}), ${p.name}, ${parent.email}, ${formatAud(slot.priceCents)}. The place is held; send them a payment link.`).catch(() => {})
      return { ok: false, status: 502, code: 'charge', error: `${p.name}'s place is held. We could not open the payment just now; we will send you the payment link.` }
    }
    payreqId = c.payreqId
    await setBookingCharge({ slotId: slot.id, bookingId: booking.id, payreqId })
  }
  const q = await getPayreq(payreqId)
  if (q?.status === 'paid') return { ok: true, payreqId, paid: true, already: true }
  return { ok: true, payreqId, already: Boolean(held.already) }
}

// A whole session (Lee, 27 Oct 2026): the family picks 1 on 1 or a group, ticks
// their own players and names any friends coming with them. The first family
// to book takes the session. One charge on their first player: the per player
// price times the players. Their own players need a signed waiver; friends are
// named only, and the coach sees them as guests.
async function bookWholeSession({ config, parent, fam, body, siteUrl, slot }) {
  const opt = slot.options.find((o) => o.id === clean(body.optionId, 10))
  if (!opt) return { ok: false, status: 400, error: 'Choose 1 on 1 or a group.' }
  const keys = [...new Set((Array.isArray(body.playerKeys) ? body.playerKeys : [body.playerKey]).map((k) => clean(k, 80)).filter(Boolean))]
  const own = keys.map((k) => fam.players.find((x) => x.key === k))
  if (!own.length || own.some((x) => !x)) return { ok: false, status: 400, error: 'Choose your player.' }
  const unsigned = own.find((x) => !x.waiver)
  if (unsigned) return { ok: false, status: 400, code: 'waiver', error: `Sign ${unsigned.name}'s waiver first, then book.` }
  const guests = (Array.isArray(body.guests) ? body.guests : []).map((g) => clean(typeof g === 'string' ? g : g?.name, 80)).filter(Boolean).slice(0, 19)
  const players = [
    ...own.map((p) => { const row = p.term4.find((r) => r.holdsPlace) || p.term4[0] || null; return { name: p.name, rowId: row?.id || '', profileKey: row ? '' : profileKey(p.name, parent.email) } }),
    ...guests.map((name) => ({ name, guest: true })),
  ]
  const held = await reserveWholeSession({ slotId: slot.id, optionId: opt.id, players, email: parent.email, mobile: clean(body.mobile, 30) || fam.mobile || '', by: parent.email })
  if (held.error) return { ok: false, status: 409, code: 'slot', error: held.error }
  const lead = held.lead
  let payreqId = lead.payreqId || ''
  if (!payreqId) {
    const first = players[0]
    const n = held.bookings.length
    const others = n > 1 ? ` (${first.name} + ${n - 1})` : ''
    const c = await createPlayerCharge({
      config, principal: { email: parent.email, name: fam.parentName || parent.email },
      ...(first.rowId ? { rowId: first.rowId } : { profileKey: first.profileKey }), email: parent.email, playerName: first.name, parentName: fam.parentName || '',
      amountCents: opt.priceCents * n, label: `Extra session, ${slot.dateLabel} ${slot.time}, ${opt.type === 'one' ? '1 on 1' : `group of ${n}${others}`}`, kind: 'extra',
      sessionDate: slot.date, coachId: slot.coachId, ref: `extra:${slot.id}:${lead.id}`, siteUrl,
    })
    if (!c.ok) {
      console.error('jfp family extra charge failed', slot.id, lead.id, c.error)
      await telegramAlert(`Extra session payment link failed to open: ${slot.dateLabel} ${slot.time} (${slot.id}), whole session ${opt.label} for ${n} (${first.name}), ${parent.email}, ${formatAud(opt.priceCents * n)}. The session is held; send them a payment link.`).catch(() => {})
      return { ok: false, status: 502, code: 'charge', error: 'The session is held for you. We could not open the payment just now; we will send you the payment link.' }
    }
    payreqId = c.payreqId
    await setBookingCharge({ slotId: slot.id, bookingId: lead.id, payreqId })
  }
  const q = await getPayreq(payreqId)
  if (q?.status === 'paid') return { ok: true, payreqId, paid: true, already: true }
  return { ok: true, payreqId, already: Boolean(held.already) }
}
