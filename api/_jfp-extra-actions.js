// Staff portal actions for extra sessions (see _jfp-extra.js). Coaches see and
// change only their own sessions; Lee and Ligia see every coach's, and set the
// prices coaches pick from.
import { saveConfig, listPayreqs, coachById, coachLabel, clean, sydneyToday, dateLabel, formatAud, audit, normName } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { telegramAlert } from './_jfp-notify.js'
import { createPlayerCharge, cancelCharge, listCharges } from './_jfp-charges.js'
import { profileKey } from './_jfp-profiles.js'
import { siteUrl } from './_holiday-store.js'
import { queueAnnounce, announceSettings } from './_jfp-extra-announce.js'
import { coachAsks, replyExtra, coachAskView } from './_jfp-extras.js'
import {
  allSlots, getSlot, saveSlot, weeklyDates, KIND_LABEL, kindOf, cancelSlot, reserveExtraPlace, setBookingCharge, liveBookings, removeBooking, markBooking, marksFor, staffView, extraMinutes, cleanExtraPrices, newExtraPrice,
} from './_jfp-extra.js'

export const EXTRA_ACTIONS = new Set(['extraList', 'extraSave', 'extraSaveMany', 'extraCancel', 'extraAttach', 'extraRemove', 'extraMark', 'extraSearch', 'extraPrices', 'extraAnnounce', 'extraAsks', 'extraAskReply'])
const ok = (res, body) => res.status(200).json({ success: true, ...body })

// Prices stay with Lee and Ligia (Lee, 19 Oct 2026): a coach sees the kind of
// session and its length, never what it costs or what it is worth.
function forCoach(v, isAdmin) {
  if (isAdmin || !v) return v
  const { priceCents, priceLabel, ...rest } = v
  return rest
}
const priceForCoach = (p, isAdmin) => (isAdmin ? { ...p, priceLabel: formatAud(p.cents) } : { id: p.id, label: p.label, durationMin: p.durationMin })
const no = (res, status, error) => res.status(status).json({ success: false, error })

const MANY_MAX = 24

// ---------- finding a player ----------
const blank = (r) => /test/i.test(r.player || r.name || '')
async function people() {
  const roster = await loadRoster()
  const out = [], seen = new Set()
  const add = (x) => { const k = `${normName(x.name)}|${(x.email || '').toLowerCase()}`; if (!x.name || seen.has(k)) return; seen.add(k); out.push(x) }
  for (const r of roster.players) if (!blank(r)) add({ pick: `t4:${r.id}`, rowId: r.id, name: r.player, email: r.email || '', mobile: r.phone || '', where: [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Term 4, no group' })
  for (const r of roster.term3 || []) if (!blank(r)) add({ pick: `t3:${r.id}`, name: r.player, email: r.emails?.[0] || '', mobile: r.phone || '', where: 'Term 3 player' })
  for (const s of await allSlots()) for (const b of s.bookings || []) if (b.status !== 'removed' && !b.rowId && b.email) add({ pick: `xb:${s.id}:${b.id}`, name: b.name, email: b.email, mobile: b.mobile || '', where: `Extra session ${dateLabel(s.date)}` })
  return out
}
async function searchPeople(q) {
  const words = q.split(' ').filter(Boolean)
  return (await people()).filter((x) => { const n = normName(x.name); return words.every((w) => n.includes(w)) })
    .sort((a, b) => Number(normName(b.name).startsWith(q)) - Number(normName(a.name).startsWith(q)))
    .slice(0, 12).map((x) => ({ pick: x.pick, rowId: x.rowId || '', name: x.name, group: x.where, hasEmail: Boolean(x.email), hasMobile: Boolean(x.mobile) }))
}
async function resolvePick(pick) {
  return (await people()).find((x) => x.pick === pick) || null
}

// A new public session: the JFP family email (built off until Lee says yes to
// the wording, see _jfp-extra-announce.js).
async function announcePublic(config, slots) {
  const pub = slots.filter((x) => x.visibility === 'public')
  if (!pub.length) return
  await queueAnnounce(config, pub).catch((e) => console.error('jfp extra announce failed', e.message))
}

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
  // The last two weeks' sessions with a player on them stay, so a 1 on 1 can be
  // marked the day after (Lee, 26 Oct 2026).
  const back = new Date(Date.parse(`${today}T12:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10)
  const mine = slots.filter((s) => s.status === 'open' && (!coachId || s.coachId === coachId) && (s.date >= (body.past ? '0000' : today) || (s.date >= back && liveBookings(s).length)))
  const views = []
  for (const s of mine.slice(0, 200)) views.push(forCoach({ ...staffView(config, s, payreqs), marks: s.date <= today ? await marksFor(s) : {} }, isAdmin))
  const [mon, sun] = weekOf(today)
  return {
    slots: views,
    prices: cleanExtraPrices(config.extraPrices).filter((p) => !p.archived).map((p) => priceForCoach(p, isAdmin)),
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

  // A new weekly slot is a series: made the many-sessions way, one each week.
  if (action === 'extraSave' && body.slot?.kind === 'weekly' && !body.slot?.id) {
    body = { ...body, dates: [body.slot.date], times: [body.slot.time] }
    action = 'extraSaveMany'
  }
  if (action === 'extraSave') {
    const out = await saveSlot({ config, principal, isAdmin, input: body.slot || {} })
    if (out.error) return no(res, 400, out.error)
    // Lee and Ligia hear when a coach opens a session themselves.
    if (out.created && !isAdmin) await telegramAlert(`Extra session opened by Coach ${coachLabel(coachById(config, out.slot.coachId))}: ${dateLabel(out.slot.date)} ${out.slot.time}, ${out.slot.location}, ${out.slot.capacity} place${out.slot.capacity === 1 ? '' : 's'}, ${formatAud(out.slot.priceCents)} (${KIND_LABEL[kindOf(out.slot)]}).`).catch(() => {})
    if (out.created) await announcePublic(config, [out.slot])
    return ok(res, { slot: forCoach(staffView(config, out.slot, await listPayreqs()), isAdmin) })
  }
  // Several sessions in one go (Lee, 19 Oct 2026): the same session on each
  // picked date, at each picked start time. All are checked before any is made.
  if (action === 'extraSaveMany') {
    let base = body.slot || {}
    let dates = [...new Set((Array.isArray(body.dates) ? body.dates : []).map((d) => clean(d, 10)))].sort()
    // Weekly slot: the first date picked, then the same day every week to the end of term.
    if (base.kind === 'weekly') {
      dates = weeklyDates(config, dates[0])
      base = { ...base, seriesId: `XW-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }
    }
    if (base.kind === 'weekly' && !dates.length) return no(res, 400, 'Pick the first date, before the end of term. A weekly slot runs each week to the end of term.')
    const times = [...new Set((Array.isArray(body.times) ? body.times : [base.time]).map((t) => clean(t, 10)).filter(Boolean))]
    if (!dates.length) return no(res, 400, 'Pick at least one date.')
    if (!times.length) return no(res, 400, 'Pick a start time, like 4:30pm.')
    if (dates.length * times.length > MANY_MAX) return no(res, 400, `That is ${dates.length * times.length} sessions. Make up to ${MANY_MAX} at a time.`)
    const made = []
    for (const date of dates) for (const time of times) {
      const out = await saveSlot({ config, principal, isAdmin, input: { ...base, id: '', date, time } })
      if (out.error) return no(res, 400, made.length ? `${dateLabel(date)} ${time}: ${out.error} The ${made.length} before it were made.` : `${dateLabel(date)} ${time}: ${out.error}`)
      made.push(out.slot)
    }
    const s0 = made[0]
    if (!isAdmin) await telegramAlert(`${made.length} extra sessions opened by Coach ${coachLabel(coachById(config, s0.coachId))} (${KIND_LABEL[kindOf(s0)]}): ${made.map((x) => `${dateLabel(x.date)} ${x.time}`).join(', ')}, ${s0.location}.`).catch(() => {})
    await announcePublic(config, made)
    const payreqs = await listPayreqs()
    return ok(res, { slots: made.map((x) => forCoach(staffView(config, x, payreqs), isAdmin)) })
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

  // Players a coach can put on a session (no contacts shown). Term 4 players,
  // then Term 3 players and anyone booked on an extra session before, so
  // Dean's private players come up by name (Lee, 19 Oct 2026). A pick other
  // than a Term 4 row is a reference the server turns back into the details.
  if (action === 'extraSearch') {
    const q = normName(body.q || '')
    if (q.length < 2) return ok(res, { results: [] })
    return ok(res, { results: await searchPeople(q) })
  }

  // A coach puts a player on their session: a Term 4 player, or someone new
  // (name and email, like a player who booked with the coach directly).
  if (action === 'extraAttach') {
    const s = await getSlot(clean(body.slotId, 60))
    if (!s) return no(res, 404, 'That session is gone.')
    if (!isAdmin && s.coachId !== principal.coachId) return no(res, 403, 'Not your session.')
    let name = clean(body.name, 80), email = clean(body.email, 120), mobile = clean(body.mobile, 30), rowId = ''
    if (body.pick && !body.rowId) {
      const who = await resolvePick(clean(body.pick, 120))
      if (!who) return no(res, 404, 'That player could not be found. Search again.')
      if (who.rowId) body.rowId = who.rowId
      else { name = who.name; email = who.email || email; mobile = who.mobile || mobile }
    }
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
    return ok(res, { booking: out.booking, already: Boolean(out.already), chargeError, slot: forCoach(staffView(config, fresh || out.slot, await listPayreqs()), isAdmin) })
  }

  // Families' extra session requests, for every coach to take or pass (Lee, 19 Oct 2026).
  const nameOf = (id) => coachLabel(coachById(config, id))
  if (action === 'extraAsks') {
    if (!principal.coachId) return ok(res, { asks: [] })
    return ok(res, { asks: await coachAsks(principal.coachId, nameOf) })
  }
  if (action === 'extraAskReply') {
    if (!principal.coachId) return no(res, 403, 'Your login is not linked to a coach yet. Ask Lee.')
    const answer = ['take', 'pass'].includes(body.answer) ? body.answer : ''
    const out = await replyExtra({ id: body.id, coachId: principal.coachId, answer, by: principal.email })
    if (!out.ok) return no(res, out.status, out.error)
    const r = out.record
    if (out.changed) await telegramAlert(r.takenBy ? `Coach ${nameOf(principal.coachId)} will take the extra session request for ${r.player} (${r.type}${r.days?.length ? `, ${r.days.join(', ')}` : ''}). Book it in with them.` : `Coach ${nameOf(principal.coachId)} let go of the extra session request for ${r.player}. It is open again.`)
    return ok(res, { ask: coachAskView(r, principal.coachId, nameOf) })
  }

  // The JFP family email on a new public session: Lee and Ligia only.
  if (action === 'extraAnnounce') {
    if (!isAdmin) return no(res, 403, 'Only Lee or Ligia can change this.')
    return ok(res, await announceSettings({ config, principal, body }))
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
