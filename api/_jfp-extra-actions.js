// Staff portal actions for extra sessions (see _jfp-extra.js). Coaches see and
// change only their own sessions; Lee and Ligia see every coach's, and set the
// prices coaches pick from.
import { saveConfig, listPayreqs, coachById, coachLabel, clean, sydneyToday, dateLabel, formatAud, audit, normName } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { telegramAlert } from './_jfp-notify.js'
import { createPlayerCharge, cancelCharge, listCharges } from './_jfp-charges.js'
import { profileKey } from './_jfp-profiles.js'
import { siteUrl } from './_holiday-store.js'
import {
  allSlots, getSlot, saveSlot, cancelSlot, reserveExtraPlace, setBookingCharge, liveBookings, removeBooking, markBooking, marksFor, staffView, extraMinutes, cleanExtraPrices, newExtraPrice,
} from './_jfp-extra.js'

export const EXTRA_ACTIONS = new Set(['extraList', 'extraSave', 'extraCancel', 'extraAttach', 'extraRemove', 'extraMark', 'extraSearch', 'extraPrices'])
const ok = (res, body) => res.status(200).json({ success: true, ...body })
const no = (res, status, error) => res.status(status).json({ success: false, error })

// Monday to Sunday of the week a date is in.
function weekOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - back)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
}

async function listFor(config, principal, isAdmin, body) {
  const coachId = isAdmin ? clean(body.coachId, 30) : principal.coachId
  const [slots, payreqs] = await Promise.all([allSlots(), listPayreqs()])
  const today = sydneyToday()
  const mine = slots.filter((s) => s.status === 'open' && (!coachId || s.coachId === coachId) && s.date >= (body.past ? '0000' : today))
  const views = []
  for (const s of mine.slice(0, 200)) views.push({ ...staffView(config, s, payreqs), marks: s.date <= today ? await marksFor(s) : {} })
  const [mon, sun] = weekOf(today)
  return {
    slots: views,
    prices: cleanExtraPrices(config.extraPrices).filter((p) => !p.archived).map((p) => ({ ...p, priceLabel: formatAud(p.cents) })),
    allPrices: isAdmin ? cleanExtraPrices(config.extraPrices).map((p) => ({ ...p, priceLabel: formatAud(p.cents) })) : undefined,
    venues: (config.locations || []).map((l) => l.name),
    coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : undefined,
    me: principal.coachId || '',
    weekMinutes: coachId ? extraMinutes(slots, coachId, mon, sun) : null,
    admin: isAdmin,
  }
}

// Take a booking's unpaid charge off the family's account. 'paid' when money came in.
async function dropCharge(b, principal) {
  if (!b.payreqId) return 'none'
  const id = b.chargeId || (await listCharges()).find((c) => c.payreqId === b.payreqId)?.id
  if (!id) return 'none'
  const r = await cancelCharge({ id, principal, why: 'Taken off the extra session' })
  return r.ok ? 'cancelled' : /paid|Money has come in/.test(r.error || '') ? 'paid' : 'none'
}

export async function extraAction(req, res, principal, config, body, action, isAdmin) {
  // A coach needs a coach id; staff without one manage every coach.
  if (!isAdmin && !principal.coachId) return no(res, 403, 'Not allowed.')
  if (action === 'extraList') return ok(res, await listFor(config, principal, isAdmin, body))

  if (action === 'extraSave') {
    const out = await saveSlot({ config, principal, isAdmin, input: body.slot || {} })
    if (out.error) return no(res, 400, out.error)
    // Lee and Ligia hear when a coach opens a session themselves.
    if (out.created && !isAdmin) await telegramAlert(`Extra session opened by Coach ${coachLabel(coachById(config, out.slot.coachId))}: ${dateLabel(out.slot.date)} ${out.slot.time}, ${out.slot.location}, ${out.slot.capacity} place${out.slot.capacity === 1 ? '' : 's'}, ${formatAud(out.slot.priceCents)} (${out.slot.visibility}).`).catch(() => {})
    return ok(res, { slot: staffView(config, out.slot, await listPayreqs()) })
  }
  if (action === 'extraCancel') {
    const out = await cancelSlot({ principal, isAdmin, id: clean(body.id, 60) })
    if (out.error) return no(res, 400, out.error)
    // Unpaid charges come off families' accounts; paid ones stay for Lee or Ligia to refund.
    const paid = []
    for (const b of liveBookings(out.slot)) { const r = await dropCharge(b, principal); if (r === 'paid') paid.push(b.name) }
    return ok(res, { paid })
  }
  if (action === 'extraRemove') {
    const out = await removeBooking({ principal, isAdmin, slotId: clean(body.slotId, 60), bookingId: clean(body.bookingId, 60) })
    if (out.error) return no(res, 400, out.error)
    return ok(res, { charged: (await dropCharge(out.booking, principal)) === 'paid' })
  }
  if (action === 'extraMark') {
    const out = await markBooking({ config, principal, isAdmin, slotId: clean(body.slotId, 60), bookingId: clean(body.bookingId, 60), status: body.status ?? '' })
    return out.error ? no(res, 400, out.error) : ok(res, { status: out.status })
  }

  // Players a coach can put on a session: Term 4 players by name (no contacts shown).
  if (action === 'extraSearch') {
    const q = normName(body.q || '')
    if (q.length < 2) return ok(res, { results: [] })
    const roster = await loadRoster()
    const results = roster.players.filter((r) => !/test/i.test(r.player) && normName(r.player).includes(q)).slice(0, 12)
      .map((r) => ({ rowId: r.id, name: r.player, group: [r.day, r.time, r.location].filter(Boolean).join(' ') || 'No group', hasEmail: Boolean(r.email), hasMobile: Boolean(r.phone) }))
    return ok(res, { results })
  }

  // A coach puts a player on their session: a Term 4 player, or someone new
  // (name and email, like a player who booked with the coach directly).
  if (action === 'extraAttach') {
    const s = await getSlot(clean(body.slotId, 60))
    if (!s) return no(res, 404, 'That session is gone.')
    if (!isAdmin && s.coachId !== principal.coachId) return no(res, 403, 'Not your session.')
    let name = clean(body.name, 80), email = clean(body.email, 120), mobile = clean(body.mobile, 30), rowId = ''
    if (body.rowId) {
      const r = (await loadRoster({ fresh: true })).players.find((x) => x.id === clean(body.rowId, 30))
      if (!r) return no(res, 404, 'That player is not in Term 4 Players.')
      rowId = r.id; name = r.player; email = r.email || email; mobile = r.phone || mobile
    }
    if (!email) return no(res, 400, 'Add their email, so the session shows in their account to pay.')
    const out = await reserveExtraPlace({ slotId: s.id, rowId, name, email, mobile, by: principal.email, from: isAdmin ? 'staff' : 'coach' })
    if (out.error) return no(res, 409, out.error)
    // The payment, tied to the player and coach from the start (the Revenue
    // session's player charges): it shows in their account to pay.
    let chargeError = ''
    if (!out.booking.payreqId) {
      const c = await createPlayerCharge({
        config, principal, ...(rowId ? { rowId } : { profileKey: profileKey(name, email) }), email, playerName: name,
        amountCents: s.priceCents, label: `Extra session, ${dateLabel(s.date)} ${s.time}`, kind: 'extra',
        sessionDate: s.date, coachId: s.coachId, ref: `extra:${s.id}:${out.booking.id}`, siteUrl: siteUrl(req),
        notifyFamily: true, // "You have a payment to make" (claude/card-on-file)
      }).catch((e) => ({ ok: false, error: e.message }))
      if (c.ok && c.payreqId) { await setBookingCharge({ slotId: s.id, bookingId: out.booking.id, payreqId: c.payreqId, chargeId: c.charge?.id || '' }); out.booking.payreqId = c.payreqId }
      else { chargeError = c.error || 'The payment could not be made.'; console.error('jfp extra charge failed', chargeError) }
    }
    const fresh = await getSlot(s.id)
    return ok(res, { booking: out.booking, already: Boolean(out.already), chargeError, slot: staffView(config, fresh || out.slot, await listPayreqs()) })
  }

  // The prices coaches pick from: Lee and Ligia only.
  if (action === 'extraPrices') {
    if (!isAdmin) return no(res, 403, 'Only Lee or Ligia set prices.')
    const list = cleanExtraPrices(config.extraPrices)
    let next = list
    if (body.add) {
      const p = newExtraPrice({ label: body.add.label, cents: Math.round(Number(body.add.dollars) * 100), durationMin: Number(body.add.durationMin) || 60 })
      if (!p) return no(res, 400, 'Give the price a name, an amount from A$1 and a length from 15 minutes.')
      next = [...list, p]
    } else if (body.archive) next = list.map((p) => (p.id === body.archive ? { ...p, archived: body.on !== false } : p))
    else return no(res, 400, 'Nothing to change.')
    const saved = await saveConfig({ extraPrices: next })
    await audit({ by: principal.email, action: 'extra.prices', target: 'config', after: { count: next.length } })
    return ok(res, { prices: cleanExtraPrices(saved.extraPrices).map((p) => ({ ...p, priceLabel: formatAud(p.cents) })) })
  }
  return no(res, 400, 'Unknown action')
}
