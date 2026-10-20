// Coach hours (Lee, 18 Oct 2026: "coaches entering their own hours").
// Each coach logs the hours they worked: a date, start and finish, and what
// it was (a JFP session, cover, holiday training, a camp, an event, admin or
// other). Their own term sessions and covers are offered as one tap adds.
// Lee and Ligia see everyone's, approve them or send one back with a note,
// and download a CSV. Hours only: no pay rates or amounts here.
//
//   jfp:hours   hash id -> JSON {id, coachId, date, start, end, minutes, kind,
//               groupId, note, status: submitted|approved|queried, createdAt,
//               by, editedAt, decidedBy, decidedAt, decisionNote,
//               players: [{ rowId, name }]}
//
// Players (Lee, 20 Oct 2026: "it needs to be able to add the players they
// had... click that hour, then the players names get entered into the
// invoice"): a coach ticks who they coached on each session. The list is the
// group's players with the register's marks; Present and paid-upfront players
// come ticked. The ticked names go on the invoice line.
import { kvCommand, newId, clean, audit, listGroups, coachById, coachLabel, locationFor, sessionDates, to24h, dateLabel, sydneyToday } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { registerFor, paidUpfront } from './_jfp-coach-pay.js'

const KEY = 'jfp:hours'
export const HOURS_ACTIONS = new Set(['hoursList', 'hoursSave', 'hoursDelete', 'hoursDecide', 'hoursPlayers', 'hoursOptions'])
export const HOUR_KINDS = { session: 'JFP session', cover: 'Cover', devsesh: 'Dev Sesh', holiday: 'Holiday training', camp: 'Camp', juniors: 'Joners Juniors', event: 'Event or trial day', admin: 'Admin or planning', other: 'Other' }
const MAX_PLAYERS = 40

// First names, with a last initial when two share a first name.
export function shortNames(rows) {
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'Player'
  const count = {}
  for (const r of rows) count[first(r.player).toLowerCase()] = (count[first(r.player).toLowerCase()] || 0) + 1
  return new Map(rows.map((r) => { const parts = String(r.player || '').trim().split(/\s+/); const f = first(r.player); return [r.id, count[f.toLowerCase()] > 1 && parts[1] ? `${f} ${parts[parts.length - 1][0]}` : f] }))
}

// The players for one session: the group's players and anyone on its
// register that day, with the mark, and whether they come ticked.
export async function sessionPlayers(groupId, date) {
  const roster = await loadRoster().catch(() => ({ players: [] }))
  const byId = new Map(roster.players.map((r) => [r.id, r]))
  const names = shortNames(roster.players)
  const rowOf = (id) => { const r = byId.get(id); return r ? { name: names.get(id), paymentType: r.paymentType, paymentStatus: r.paymentStatus } : null }
  const reg = await registerFor(groupId, date, rowOf)
  const ids = [...new Set([...roster.players.filter((r) => r.groupId === groupId && r.holdsPlace).map((r) => r.id), ...Object.keys(reg.marks)])]
  const counted = new Set(reg.counted.map((p) => p.rowId))
  return {
    marked: reg.marked,
    players: ids.map((id) => ({ rowId: id, name: names.get(id) || 'Player', full: String(byId.get(id)?.player || '').trim() || 'Player on the register', mark: reg.marks[id] || '', paidUpfront: paidUpfront(byId.get(id)), ticked: counted.has(id) }))
      .sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.full.localeCompare(b.full)),
  }
}

// Pure: the ticked players, checked against the session's list. Typed names (no rowId) are allowed.
export function checkPlayers(list, allowed) {
  if (!Array.isArray(list)) return []
  const out = [], seen = new Set()
  for (const p of list.slice(0, MAX_PLAYERS)) {
    const rowId = clean(p?.rowId, 40)
    if (rowId) { const a = allowed.get(rowId); if (a && !seen.has(rowId)) { seen.add(rowId); out.push({ rowId, name: a }) } continue }
    const name = clean(p?.name, 40)
    if (name) out.push({ rowId: '', name })
  }
  return out
}

// The quick picks for logging hours: the coach's own sessions (to tap) and
// the players in them (for a Dev Sesh or anything not on a register).
async function coachOptions(config, coachId) {
  const [groups, roster] = await Promise.all([listGroups(), loadRoster().catch(() => ({ players: [] }))])
  const mine = groups.filter((g) => (g.mode !== 'closed' || g.label === 'Joners Juniors') && (g.coachId === coachId || (g.extraCoachIds || []).includes(coachId)))
  const ids = new Set(mine.map((g) => g.id))
  const rows = roster.players.filter((r) => ids.has(r.groupId) && r.holdsPlace)
  const names = shortNames(roster.players)
  return {
    groups: mine.map((g) => { const s = to24h(g.time); return { id: g.id, day: g.day, time: g.time, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}`, kind: g.label === 'Joners Juniors' ? 'juniors' : 'session', start: s || '', end: s ? hm(mins(s) + Number(g.durationMin || 60)) : '' } }),
    players: rows.map((r) => ({ rowId: r.id, name: names.get(r.id), full: String(r.player || '').trim() })).sort((a, b) => a.full.localeCompare(b.full)),
  }
}

// May this login see a session's players: Lee, Ligia, the group's coaches, or the cover that day.
async function canSeeSession(groupId, date, { isAdmin, myCoachId, listCovers }) {
  if (isAdmin) return true
  if (!myCoachId) return false
  const g = (await listGroups()).find((x) => x.id === groupId)
  if (!g) return false
  if (g.coachId === myCoachId || (g.extraCoachIds || []).includes(myCoachId)) return true
  return (await listCovers()).some((c) => c.status === 'active' && c.groupId === groupId && c.date === date && c.coverCoachId === myCoachId)
}
const ISO = /^\d{4}-\d{2}-\d{2}$/
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
const BACK_DAYS = 62
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

export async function allHours() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out.push(x) } }
  else for (const v of Object.values(raw)) { const x = parse(v); if (x) out.push(x) }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.start.localeCompare(b.start))
}

// Pure: check one entry. Returns { error } or the clean fields.
export function checkEntry(body, { today, others = [] }) {
  const date = clean(body.date, 10)
  if (!ISO.test(date)) return { error: 'Choose the date.' }
  if (date > today) return { error: 'Log hours on or after the day you worked them.' }
  if (date < addDays(today, -BACK_DAYS)) return { error: 'That date is too far back. Ask Lee or Ligia to add it.' }
  const start = clean(body.start, 5), end = clean(body.end, 5)
  if (!HM.test(start) || !HM.test(end)) return { error: 'Add the start and finish times.' }
  const minutes = mins(end) - mins(start)
  if (minutes <= 0) return { error: 'The finish time must be after the start.' }
  if (minutes > 12 * 60) return { error: 'That is more than 12 hours. Split it into two entries.' }
  const kind = HOUR_KINDS[body.kind] ? body.kind : ''
  if (!kind) return { error: 'Choose what the hours were for.' }
  const clash = others.find((o) => o.date === date && mins(o.start) < mins(end) && mins(start) < mins(o.end))
  if (clash) return { error: `That overlaps ${clash.start} to ${clash.end} on the same day.` }
  return { date, start, end, minutes, kind, groupId: clean(body.groupId, 80), note: clean(body.note, 300) }
}

// The coach's own term sessions and covers in [from, to] not logged yet.
function suggestions({ config, groups, covers, coachId, from, to, logged }) {
  const out = []
  const groupLabel = (g) => `${g.day} ${g.time}, ${locationFor(config, g.location).name}`
  const coveredAway = new Set(covers.filter((c) => c.status === 'active' && c.coachId === coachId).map((c) => `${c.groupId}|${c.date}`))
  const add = (g, date, kind) => {
    const s = to24h(g.time)
    if (!s) return
    const key = `${g.id}|${date}`
    if (logged.has(key)) return
    out.push({ key, date, dateLabel: dateLabel(date), start: s, end: hm(mins(s) + Number(g.durationMin || 60)), kind, groupId: g.id, label: groupLabel(g) })
  }
  for (const g of groups) {
    if (g.mode === 'closed' && g.label !== 'Joners Juniors') continue
    if (g.coachId !== coachId && !(g.extraCoachIds || []).includes(coachId)) continue
    for (const d of sessionDates(config, g.day)) if (d >= from && d <= to && !coveredAway.has(`${g.id}|${d}`)) add(g, d, g.label === 'Joners Juniors' ? 'juniors' : 'session')
  }
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  for (const c of covers) if (c.status === 'active' && c.coverCoachId === coachId && c.date >= from && c.date <= to && byId[c.groupId]) add(byId[c.groupId], c.date, 'cover')
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}

export async function hoursAction(res, principal, config, body, action, { isAdmin, myCoachId, listCovers }) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const today = sydneyToday()
  const view = (h) => ({ ...h, coach: coachLabel(coachById(config, h.coachId)), kindLabel: HOUR_KINDS[h.kind] || h.kind, dateLabel: dateLabel(h.date), canEdit: isAdmin || (h.coachId === myCoachId && h.status !== 'approved') })

  if (action === 'hoursList') {
    const to = ISO.test(body.to || '') ? body.to : today
    const from = ISO.test(body.from || '') ? body.from : addDays(to, -13)
    const coachId = isAdmin ? clean(body.coachId, 30) : myCoachId
    if (!isAdmin && !coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const all = await allHours()
    const entries = all.filter((h) => h.date >= from && h.date <= to && (!coachId || h.coachId === coachId))
    let suggest = []
    const suggestFor = coachId || myCoachId
    if (suggestFor) {
      const [groups, covers] = await Promise.all([listGroups(), listCovers()])
      const logged = new Set(all.filter((h) => h.coachId === suggestFor && h.groupId).map((h) => `${h.groupId}|${h.date}`))
      suggest = suggestions({ config, groups, covers, coachId: suggestFor, from, to: to > today ? today : to, logged })
    }
    const totals = {}
    for (const h of entries) { const t = (totals[h.coachId] ||= { coachId: h.coachId, coach: coachLabel(coachById(config, h.coachId)), minutes: 0, approved: 0, waiting: 0, queried: 0 }); t.minutes += h.minutes; t[h.status === 'approved' ? 'approved' : h.status === 'queried' ? 'queried' : 'waiting'] += h.minutes }
    return ok({ from, to, today, entries: entries.map(view), suggest, suggestFor, totals: Object.values(totals).sort((a, b) => a.coach.localeCompare(b.coach)), kinds: HOUR_KINDS, coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : [], myCoachId })
  }

  if (action === 'hoursPlayers') {
    const groupId = clean(body.groupId, 80), date = clean(body.date, 10)
    if (!groupId || !ISO.test(date)) return no(400, 'Choose the session.')
    if (!(await canSeeSession(groupId, date, { isAdmin, myCoachId, listCovers }))) return no(403, 'Not your session.')
    return ok(await sessionPlayers(groupId, date))
  }

  if (action === 'hoursOptions') {
    const coachId = isAdmin ? clean(body.coachId, 30) || myCoachId : myCoachId
    if (!coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    return ok(await coachOptions(config, coachId))
  }

  if (action === 'hoursSave') {
    const id = clean(body.id, 40)
    const was = id ? parse(await kvCommand(['HGET', KEY, id])) : null
    if (id && !was) return no(404, 'That entry is gone. Refresh the page.')
    if (was && !isAdmin && (was.coachId !== myCoachId || was.status === 'approved')) return no(403, was?.status === 'approved' ? 'Approved hours can only be changed by Lee or Ligia.' : 'Not your hours.')
    // On an invoice: the invoice and the hours must match (Lee, 19 Oct 2026).
    if (was?.invoiceId && !isAdmin) return no(409, 'These hours are on an invoice. Withdraw the invoice first, then change them.')
    const coachId = was ? was.coachId : isAdmin ? clean(body.coachId, 30) || myCoachId : myCoachId
    if (!coachById(config, coachId)) return no(400, isAdmin ? 'Choose the coach.' : 'Your login is not linked to a coach yet. Ask Lee.')
    const others = (await allHours()).filter((h) => h.coachId === coachId && h.id !== id)
    const e = checkEntry(body, { today: isAdmin ? addDays(today, 0) : today, others })
    if (e.error) return no(400, e.error)
    // The players they coached: names come from the session's list, never from the browser.
    if (Array.isArray(body.players)) {
      const gid = e.groupId || was?.groupId || ''
      let allowed = new Map()
      if (gid && await canSeeSession(gid, e.date, { isAdmin, myCoachId: isAdmin ? myCoachId : coachId, listCovers })) allowed = new Map((await sessionPlayers(gid, e.date)).players.map((p) => [p.rowId, p.name]))
      // Not a register session (a Dev Sesh, an event): any player in the coach's own groups.
      if (!gid) allowed = new Map((await coachOptions(config, coachId)).players.map((p) => [p.rowId, p.name]))
      e.players = checkPlayers(body.players, allowed)
    }
    const now = new Date().toISOString()
    // A coach changing hours sends them back for approval; Lee or Ligia editing keeps the status.
    const rec = was
      ? { ...was, ...e, editedAt: now, editedBy: principal.email, status: isAdmin ? was.status : 'submitted' }
      : { id: newId('HRS'), coachId, ...e, status: isAdmin && body.approve ? 'approved' : 'submitted', createdAt: now, by: principal.email, ...(isAdmin && body.approve ? { decidedBy: principal.email, decidedAt: now } : {}) }
    await kvCommand(['HSET', KEY, rec.id, JSON.stringify(rec)])
    await audit({ by: principal.email, action: was ? 'hours.edit' : 'hours.add', target: rec.id, after: { coachId, date: rec.date, start: rec.start, end: rec.end, kind: rec.kind, players: rec.players?.length ?? null } })
    return ok({ entry: view(rec) })
  }

  if (action === 'hoursDelete') {
    const id = clean(body.id, 40)
    const was = parse(await kvCommand(['HGET', KEY, id]))
    if (!was) return no(404, 'That entry is already gone.')
    if (!isAdmin && (was.coachId !== myCoachId || was.status === 'approved')) return no(403, 'Approved hours can only be removed by Lee or Ligia.')
    if (was.invoiceId) return no(409, 'These hours are on an invoice. Withdraw or send back the invoice first.')
    await kvCommand(['HDEL', KEY, id])
    await audit({ by: principal.email, action: 'hours.delete', target: id, before: { coachId: was.coachId, date: was.date, start: was.start, end: was.end } })
    return ok({ deleted: id })
  }

  if (action === 'hoursDecide') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia approve hours.')
    const status = ['approved', 'queried', 'submitted'].includes(body.status) ? body.status : ''
    if (!status) return no(400, 'Approve or send back.')
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map((x) => clean(x, 40)).filter(Boolean).slice(0, 300)
    if (!ids.length) return no(400, 'Choose the hours.')
    if (status === 'queried' && !clean(body.note, 300)) return no(400, 'Say what needs checking.')
    const now = new Date().toISOString()
    const done = []
    for (const id of ids) {
      const was = parse(await kvCommand(['HGET', KEY, id]))
      if (!was) continue
      const rec = { ...was, status, decidedBy: principal.email, decidedAt: now, decisionNote: status === 'queried' ? clean(body.note, 300) : '' }
      await kvCommand(['HSET', KEY, id, JSON.stringify(rec)])
      done.push(view(rec))
    }
    await audit({ by: principal.email, action: `hours.${status}`, target: ids.join(','), after: { count: done.length } })
    return ok({ entries: done })
  }
  return no(400, 'Unknown action.')
}
