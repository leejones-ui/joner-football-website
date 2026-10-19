// Emergency cancellations, free make-ups and credits (Lee, 19 Oct 2026).
//
// When we have to cancel one group's session for an emergency (a coach is sick
// or does not turn up), Lee or Ligia cancel that session for that date. Every
// player in the group is owed either:
//   makeup  a free make-up session, used inside the same term, or
//   credit  a credit that comes off next term (value in cents, set when made).
// Nothing is charged, refunded or emailed here. The family sees it in My
// account; staff book make-ups and apply credits by hand from the Make-ups page.
//
// KV:
//   jfp:session-off   hash "groupId|date" -> { groupId, date, reason, kind, by, at, count }
//   jfp:makeups       hash id -> { id, rowId, player, email, groupId, date, kind, status, ... }
// Status: owed, requested (family asked), booked (into another session), used,
// applied (credit used), expired (make-up not used in term), cancelled.
import { kvCommand, clean, newId, audit, dateLabel, sydneyToday, sessionDates, listGroups, locationFor, rowEmails } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { telegramAlert } from './_jfp-notify.js'

const MK = 'jfp:makeups'
const OFF = 'jfp:session-off'
export const MAKEUP_ADMIN_ACTIONS = new Set(['emergencyCancel', 'emergencyUncancel', 'makeupsList', 'makeupUpdate'])
export const REASONS = ['Coach sick', 'Coach did not turn up', 'Other emergency']
export const KINDS = ['makeup', 'credit', 'none']
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const offKey = (g, d) => `${g}|${d}`

async function hashList(key) {
  const raw = (await kvCommand(['HGETALL', key])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const v = parse(raw[i]); if (v) out.push(v) } }
  else for (const v of Object.values(raw)) { const x = parse(v); if (x) out.push(x) }
  return out
}
export const listMakeups = () => hashList(MK)
export const listSessionOff = () => hashList(OFF)
const saveMakeup = (m) => kvCommand(['HSET', MK, m.id, JSON.stringify(m)])

// groupId|date -> record, for the register and the family's account.
export async function sessionOffMap() {
  try { return new Map((await listSessionOff()).map((o) => [offKey(o.groupId, o.date), o])) } catch (error) { console.error('jfp session-off read failed', error); return new Map() }
}

// The last day of the term, which is how long a free make-up lasts.
export function termEnd(config) {
  const d = new Date(`${config.termStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (Number(config.weeks) || 10) * 7 - 1)
  return d.toISOString().slice(0, 10)
}

// What a status really is today: an unused make-up is expired once the term is over.
export function liveStatus(m, config, today = sydneyToday()) {
  if (m.kind === 'makeup' && ['owed', 'requested'].includes(m.status) && termEnd(config) < today) return 'expired'
  return m.status
}

const groupLine = (config, g) => `${g.day} ${g.time}, ${locationFor(config, g.location).name}`
const isTrial = (r) => /trial/i.test(r.paymentType || '')

function creditValue(r, g, config) {
  if (r.perSessionCents) return r.perSessionCents
  const n = sessionDates(config, g.day).length
  return r.feeAud && n ? Math.round((r.feeAud * 100) / n) : 0
}

// The words Ligia can paste into a message. Nothing is sent by this code.
function familyWords(config, g, date, kind, reason) {
  const what = kind === 'makeup' ? 'a free make-up session, which you can use any time before the end of this term. Open My account and tap "Ask for my make-up", and Ligia will find you a spot.' : kind === 'credit' ? 'a credit for the missed session, which comes off next term.' : 'no charge for it.'
  return `Hi, we had to cancel the ${g.day} ${g.time} session on ${dateLabel(date)} (${reason.toLowerCase()}). Sorry for the change. You have ${what}`
}

export async function emergencyCancel({ principal, config, body }) {
  const groups = await listGroups()
  const g = groups.find((x) => x.id === clean(body.groupId, 80))
  if (!g) return { status: 404, error: 'Group not found.' }
  const date = clean(body.date, 10)
  if (!sessionDates(config, g.day).includes(date)) return { status: 400, error: 'That is not a session date for this group.' }
  const reason = REASONS.includes(body.reason) ? body.reason : 'Other emergency'
  const kind = KINDS.includes(body.kind) ? body.kind : 'makeup'
  const key = offKey(g.id, date)
  if (await kvCommand(['HGET', OFF, key])) return { status: 409, error: 'That session is already cancelled.' }
  const roster = await loadRoster({ fresh: true })
  const rows = roster.players.filter((r) => r.groupId === g.id && r.holdsPlace && !isTrial(r) && !(r.startsFrom && date < r.startsFrom))
  const now = new Date().toISOString()
  const off = { groupId: g.id, date, reason, kind, by: principal.email, at: now, count: rows.length }
  await kvCommand(['HSET', OFF, key, JSON.stringify(off)])
  if (kind !== 'none') {
    for (const r of rows) {
      await saveMakeup({ id: newId('MK'), rowId: r.id, player: r.player, email: rowEmails(r)[0] || '', groupId: g.id, date, kind, status: 'owed', reason, cents: kind === 'credit' ? creditValue(r, g, config) : 0, createdBy: principal.email, createdAt: now, expiresOn: kind === 'makeup' ? termEnd(config) : '' })
    }
  }
  await audit({ by: principal.email, action: 'session.emergencyCancel', target: key, after: { reason, kind, players: rows.length } })
  await telegramAlert(`JFP session cancelled: ${groupLine(config, g)}, ${dateLabel(date)}\n${reason}. ${rows.length} player${rows.length === 1 ? '' : 's'}, ${kind === 'makeup' ? 'free make-ups' : kind === 'credit' ? 'credits' : 'no make-up or credit'}.`).catch(() => {})
  return { status: 200, off, players: rows.length, words: familyWords(config, g, date, kind, reason) }
}

export async function emergencyUncancel({ principal, body }) {
  const key = offKey(clean(body.groupId, 80), clean(body.date, 10))
  const off = parse(await kvCommand(['HGET', OFF, key]))
  if (!off) return { status: 404, error: 'That cancellation is already gone.' }
  const mine = (await listMakeups()).filter((m) => m.groupId === off.groupId && m.date === off.date)
  if (mine.some((m) => !['owed', 'cancelled'].includes(m.status))) return { status: 409, error: 'A family has already asked for or been given a make-up or credit. Change those first.' }
  for (const m of mine) await kvCommand(['HDEL', MK, m.id])
  await kvCommand(['HDEL', OFF, key])
  await audit({ by: principal.email, action: 'session.emergencyUncancel', target: key })
  return { status: 200 }
}

export async function makeupsList({ config }) {
  const [list, offs, groups] = await Promise.all([listMakeups(), listSessionOff(), listGroups()])
  const byId = new Map(groups.map((g) => [g.id, g]))
  const today = sydneyToday()
  const view = (m) => {
    const g = byId.get(m.groupId)
    const b = m.booked && byId.get(m.booked.groupId)
    return { ...m, status: liveStatus(m, config, today), group: g ? groupLine(config, g) : m.groupId, dateLabel: dateLabel(m.date), expiresLabel: m.expiresOn ? dateLabel(m.expiresOn) : '', bookedLabel: b ? `${groupLine(config, b)}, ${dateLabel(m.booked.date)}` : '' }
  }
  return {
    makeups: list.map(view).sort((a, c) => String(c.createdAt).localeCompare(String(a.createdAt))),
    cancelled: offs.map((o) => ({ ...o, group: byId.get(o.groupId) ? groupLine(config, byId.get(o.groupId)) : o.groupId, dateLabel: dateLabel(o.date) })).sort((a, c) => String(c.date).localeCompare(String(a.date))),
    groups: groups.filter((g) => g.mode !== 'closed' && g.label !== 'Joners Juniors').map((g) => ({ id: g.id, label: groupLine(config, g), dates: sessionDates(config, g.day).map((d) => ({ iso: d, label: dateLabel(d) })) })),
    reasons: REASONS, termEnd: termEnd(config), termEndLabel: dateLabel(termEnd(config)),
  }
}

export async function makeupUpdate({ principal, config, body }) {
  const m = parse(await kvCommand(['HGET', MK, clean(body.id, 40)]))
  if (!m) return { status: 404, error: 'Not found.' }
  const op = clean(body.op, 20)
  const now = new Date().toISOString()
  const by = principal.email
  const keep = { ...m, updatedBy: by, updatedAt: now }
  if (op === 'book') {
    if (m.kind !== 'makeup') return { status: 400, error: 'Only a make-up is booked into a session.' }
    const groups = await listGroups()
    const g = groups.find((x) => x.id === clean(body.groupId, 80))
    const date = clean(body.date, 10)
    if (!g || !sessionDates(config, g.day).includes(date)) return { status: 400, error: 'Choose a session and one of its dates.' }
    if (date < sydneyToday()) return { status: 400, error: 'Choose a date that has not happened yet.' }
    if (date > termEnd(config)) return { status: 400, error: 'A make-up has to be inside this term.' }
    if ((await kvCommand(['HGET', OFF, offKey(g.id, date)]))) return { status: 400, error: 'That session is cancelled.' }
    await saveMakeup({ ...keep, status: 'booked', booked: { groupId: g.id, date, by, at: now }, note: clean(body.note, 300) || m.note || '' })
  } else if (op === 'unbook') {
    await saveMakeup({ ...keep, status: 'owed', booked: null })
  } else if (op === 'used') {
    await saveMakeup({ ...keep, status: 'used', usedAt: now })
  } else if (op === 'applied') {
    if (m.kind !== 'credit') return { status: 400, error: 'Only a credit is applied.' }
    await saveMakeup({ ...keep, status: 'applied', appliedAt: now, note: clean(body.note, 300) || m.note || '' })
  } else if (op === 'convert') {
    // An unused make-up becomes a credit for next term (staff decision).
    const cents = Number(body.cents) >= 0 ? Math.round(Number(body.cents)) : m.cents || 0
    await saveMakeup({ ...keep, kind: 'credit', status: 'owed', cents, expiresOn: '', note: clean(body.note, 300) || `Changed from a make-up to a credit by ${principal.name || by}.` })
  } else if (op === 'value') {
    const cents = Math.round(Number(body.cents))
    if (!(cents >= 0 && cents < 100000)) return { status: 400, error: 'Enter the credit in dollars.' }
    await saveMakeup({ ...keep, cents })
  } else if (op === 'cancel') {
    await saveMakeup({ ...keep, status: 'cancelled' })
  } else if (op === 'reopen') {
    await saveMakeup({ ...keep, status: 'owed' })
  } else return { status: 400, error: 'Unknown change.' }
  await audit({ by, action: `makeup.${op}`, target: m.id, after: { player: m.player } })
  return { status: 200 }
}

// ---- families ----

// What a family sees for its own rows.
export async function familyMakeups(rowIds, config) {
  const want = new Set(rowIds)
  if (!want.size) return []
  let list = []
  try { list = (await listMakeups()).filter((m) => want.has(m.rowId) && m.status !== 'cancelled') } catch (error) { console.error('jfp makeups read failed', error); return [] }
  const groups = await listGroups()
  const byId = new Map(groups.map((g) => [g.id, g]))
  const today = sydneyToday()
  return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((m) => {
    const status = liveStatus(m, config, today)
    const b = m.booked && byId.get(m.booked.groupId)
    return { id: m.id, rowId: m.rowId, player: m.player, kind: m.kind, status, dateLabel: dateLabel(m.date), reason: m.reason, cents: m.cents || 0, expiresLabel: m.expiresOn ? dateLabel(m.expiresOn) : '', bookedLabel: b ? `${b.day} ${b.time}, ${locationFor(config, b.location).name}, ${dateLabel(m.booked.date)}` : '', canAsk: m.kind === 'makeup' && status === 'owed' }
  })
}

export async function makeupRequest({ rowIds, body, config }) {
  const m = parse(await kvCommand(['HGET', MK, clean(body.id, 40)]))
  if (!m || !rowIds.includes(m.rowId)) return { status: 404, error: 'We could not find that make-up.' }
  if (liveStatus(m, config) !== 'owed' || m.kind !== 'makeup') return { status: 400, error: 'That one cannot be requested.' }
  await saveMakeup({ ...m, status: 'requested', requestedAt: new Date().toISOString(), requestNote: clean(body.note, 300) })
  await audit({ by: m.email || 'family', action: 'makeup.request', target: m.id, after: { player: m.player } })
  await telegramAlert(`JFP make-up requested: ${m.player}\n${clean(body.note, 300) || 'No note'}\nBook it in the portal: Make-ups.`).catch(() => {})
  return { status: 200 }
}

// A booked make-up appears in the host session's register on that date.
export async function guestsFor(groupId, dates = []) {
  try {
    const set = new Set(dates)
    return (await listMakeups()).filter((m) => m.status === 'booked' && m.booked?.groupId === groupId && set.has(m.booked.date)).map((m) => ({ makeupId: m.id, rowId: m.rowId, name: m.player, date: m.booked.date }))
  } catch { return [] }
}
export async function guestAllowed(groupId, date, rowId) {
  try { return (await listMakeups()).find((m) => m.status === 'booked' && m.booked?.groupId === groupId && m.booked.date === date && m.rowId === rowId) || null } catch { return null }
}
export async function markGuestUsed(m, status) {
  if (!m) return
  if (status === 'Present' || status === 'Make-up') await saveMakeup({ ...m, status: 'used', usedAt: new Date().toISOString() })
  else if (status === '') await saveMakeup({ ...m, status: 'booked', usedAt: '' })
}
