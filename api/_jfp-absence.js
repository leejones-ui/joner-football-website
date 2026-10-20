// Absence alerts (Lee, 20 Oct 2026): "A player who misses 2 weeks in a row
// gets flagged to Ligia. That's usually the first sign a family is leaving."
//
// For each player holding a place in a weekly group we read the register for
// their own session dates up to today (Sydney) and flag anyone whose last 2
// MARKED sessions were both not Present:
//   - an unmarked session is skipped (the coach did not mark it), not counted
//   - a session we cancelled (jfp:session-off) is skipped
//   - Notified (the family said they could not come) counts, labelled told us
//   - Absent counts as did not tell us
//   - Present, Trial and Make-up are came
// Trials, Joners Juniors and test players are left out. A player who started
// mid term only has their own dates (rowSessionDates).
//
// Staff only (Lee and Ligia): the Missing players page, its red count and a
// Followed up button. Nothing here messages a family or a coach.
//
// KV:
//   jfp:absence-followup  hash "rowId|latestMissedDate" -> { by, at, note, player }
//                         a new missed session makes a new key, so the player
//                         comes back to To follow up
//   jfp:absence-digest    hash "week|<monday>" -> sent at (once a week)
//   jfp:absence-digested  hash "rowId|latestMissedDate" -> when it went in a digest
// The Monday digest to Ligia only runs while config.absenceDigest is true
// (off until Lee switches it on).
import { kvCommand, kvPipeline, clean, audit, listGroups, coachById, coachLabel, locationFor, sydneyToday, dateLabel } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { rowSessionDates } from './_jfp-cancel.js'
import { sessionOffMap } from './_jfp-makeups.js'

export const IN_A_ROW = 2
export const FOLLOWUP = 'jfp:absence-followup'
export const DIGEST = 'jfp:absence-digest'
export const DIGESTED = 'jfp:absence-digested'
export const ABSENCE_ACTIONS = new Set(['absenceList', 'absenceAlerts', 'absenceFollowUp', 'absenceUndo', 'absenceDigest'])
export const PORTAL_URL = 'https://jonerfootball.com/jfp-portal/#absence'

const isJuniors = (g) => g?.label === 'Joners Juniors'
const isTrialRow = (r) => /trial/i.test(r?.paymentType || '')
const isTest = (n) => /test/i.test(n || '')
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null } }
// An HGETALL reply as an object, whether it came back flat or as an object.
export function hashOf(x) {
  const a = x?.result ?? x
  if (!a) return {}
  if (!Array.isArray(a)) return { ...a }
  const o = {}
  for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]
  return o
}

// What a register mark means here.
export function markKind(v) {
  if (v === 'Present' || v === 'Trial' || v === 'Make-up') return 'came'
  if (v === 'Notified') return 'told'
  if (v === 'Absent') return 'away'
  return ''
}

// Pure: one player's dates (ascending, already only real sessions up to
// today) and their marks (date -> mark). The run of not-present marked
// sessions at the end, and the last time they came.
export function streakFor(dates, marks) {
  const marked = dates.filter((d) => markKind(marks[d]))
  const missed = []
  for (let i = marked.length - 1; i >= 0; i--) {
    const k = markKind(marks[marked[i]])
    if (k === 'came') break
    missed.unshift({ date: marked[i], told: k === 'told' })
  }
  const lastCame = [...marked].reverse().find((d) => markKind(marks[d]) === 'came') || ''
  return { inRow: missed.length, missed, lastCame }
}

const groupLine = (config, g) => `${g.day} ${g.time}, ${locationFor(config, g.location).name}`
// Groups at the same day, time and place: a player moved between them keeps the marks taken there.
const siblingsOf = (g, groups) => groups.filter((x) => x.id !== g.id && x.day === g.day && x.time === g.time && x.location === g.location).map((x) => x.id)

// The rows we look at, each with its group and the dates that count.
export function eligible({ config, groups, players, off, today }) {
  const out = []
  for (const r of players || []) {
    if (!r.holdsPlace || !r.groupId || isTrialRow(r) || isTest(r.player)) continue
    const g = groups.find((x) => x.id === r.groupId)
    if (!g || isJuniors(g) || g.label === 'Trial') continue
    const dates = rowSessionDates(config, r, g).filter((d) => d <= today && !off.has(`${g.id}|${d}`))
    if (dates.length < IN_A_ROW) continue
    out.push({ row: r, group: g, dates, ids: [g.id, ...siblingsOf(g, groups)] })
  }
  return out
}

// Pure: who is missing. registers: Map "groupId|date" -> { rowId: mark }.
export function findAbsences({ config, groups, players, registers, off = new Set(), today }) {
  const list = []
  for (const { row: r, group: g, dates, ids } of eligible({ config, groups, players, off, today })) {
    const marks = {}
    for (const d of dates) for (const id of ids) { const v = registers.get(`${id}|${d}`)?.[r.id]; if (v && !(d in marks)) marks[d] = v }
    const s = streakFor(dates, marks)
    if (s.inRow < IN_A_ROW) continue
    const latest = s.missed.at(-1).date
    const toldCount = s.missed.filter((m) => m.told).length
    list.push({
      key: `${r.id}|${latest}`,
      rowId: r.id,
      name: r.player,
      groupId: g.id,
      group: groupLine(config, g),
      coach: coachLabel(coachById(config, g.coachId)) || '',
      inRow: s.inRow,
      missed: s.missed.map((m) => ({ ...m, label: shortDate(m.date) })),
      latest,
      // all: every one of these they told us about; some: a few; none: just did not come.
      told: toldCount === s.missed.length ? 'all' : toldCount ? 'some' : 'none',
      toldCount,
      lastCame: s.lastCame,
      lastCameLabel: s.lastCame ? shortDate(s.lastCame) : '',
    })
  }
  return list.sort((a, b) => b.inRow - a.inRow || b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name))
}

// "13 Oct"
export function shortDate(iso) { return dateLabel(iso).replace(/^\w+\s+/, '') }
// "2 in a row: 13 Oct, 20 Oct"
export function missedLine(a) { return `${a.inRow} in a row: ${a.missed.map((m) => m.label).join(', ')}` }
export function toldLine(a) { return a.told === 'all' ? 'Told us' : a.told === 'some' ? `Told us ${a.toldCount} of ${a.inRow}` : "Didn't tell us" }

// Reads the registers it needs from KV and works out the list.
export async function loadAbsences(config, { today = sydneyToday() } = {}) {
  const [groups, roster, offMap] = await Promise.all([listGroups(), loadRoster(), sessionOffMap()])
  const off = new Set(offMap.keys())
  const asks = [...new Set(eligible({ config, groups, players: roster.players, off, today }).flatMap((e) => e.dates.flatMap((d) => e.ids.map((id) => `${id}|${d}`))))]
  const raws = asks.length ? await kvPipeline(asks.map((k) => { const i = k.lastIndexOf('|'); return ['HGETALL', `jfp:att:${k.slice(0, i)}:${k.slice(i + 1)}`] })) : []
  const registers = new Map(asks.map((k, i) => [k, hashOf(raws[i])]))
  return findAbsences({ config, groups, players: roster.players, registers, off, today })
}

async function readHash(key) {
  const h = hashOf(await kvCommand(['HGETALL', key]))
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, parse(v) ?? v]))
}
export const followUps = () => readHash(FOLLOWUP)

// Each player with their follow up (this run of missed sessions) and the one
// before, if staff followed up an earlier run.
export function withFollowUps(list, fu) {
  return list.map((a) => {
    const earlier = Object.entries(fu).filter(([k]) => k.startsWith(`${a.rowId}|`) && k !== a.key).map(([k, v]) => ({ ...v, date: k.split('|')[1] })).sort((x, y) => String(y.at).localeCompare(String(x.at)))[0] || null
    return { ...a, followedUp: fu[a.key] || null, earlier }
  })
}

// The red count on Missing players.
export async function absenceAlerts(config) {
  const [list, fu] = await Promise.all([loadAbsences(config), followUps()])
  return { count: list.filter((a) => !fu[a.key]).length }
}

// ---------- the Monday digest to Ligia ----------

// The words, shown on the page above the switch so Lee sees them first.
export function digestWords(fresh, olderOpen = 0) {
  const n = fresh.length
  return {
    subject: `Missing players: ${n} to follow up`,
    heading: 'Players who have missed 2 weeks in a row',
    paras: [
      `${n === 1 ? 'This player has' : `These ${n} players have`} missed their last 2 or more sessions in a row. That is often the first sign a family is leaving, so it is worth a friendly check in.`,
      ...(olderOpen ? [`${olderOpen} more from earlier weeks ${olderOpen === 1 ? 'is' : 'are'} still to follow up in the portal.`] : []),
      'When you have spoken to a family, tap Followed up on Missing players in the portal.',
    ],
    list: fresh.slice(0, 40).map((a) => [a.name, `${a.group}${a.coach ? `, coach ${a.coach}` : ''}. Missed ${missedLine(a)}. ${toldLine(a)}. ${a.lastCameLabel ? `Last came ${a.lastCameLabel}` : 'Not seen this term'}.`]),
    cta: { label: 'Open Missing players', url: PORTAL_URL },
  }
}

// Sydney weekday (0 Sunday .. 6 Saturday) and hour.
function sydneyClock(nowMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]))
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), hour: Number(parts.hour) % 24 }
}
export const DIGEST_FROM_HOUR = 7

// Once a week, Monday from 7am Sydney: the players newly flagged since the
// last digest and not followed up yet. Nothing new, nothing sent. Never runs
// unless Lee has switched it on. send(words) emails Ligia.
export async function absenceDigestTick({ config, nowMs = Date.now(), send }) {
  if (config.absenceDigest !== true) return { off: true }
  const clock = sydneyClock(nowMs)
  if (clock.day !== 1 || clock.hour < DIGEST_FROM_HOUR) return { notNow: true }
  const today = sydneyToday(nowMs)
  const week = `week|${today}`
  if (await kvCommand(['HGET', DIGEST, week])) return { already: true }
  const [list, fu, done] = await Promise.all([loadAbsences(config, { today }), followUps(), readHash(DIGESTED)])
  const open = list.filter((a) => !fu[a.key])
  const fresh = open.filter((a) => !done[a.key])
  if (Number(await kvCommand(['HSETNX', DIGEST, week, new Date(nowMs).toISOString()])) !== 1) return { already: true }
  if (!fresh.length) return { sent: false, fresh: 0, open: open.length }
  try { await send(digestWords(fresh, open.length - fresh.length)) } catch (error) { await kvCommand(['HDEL', DIGEST, week]); throw error }
  await kvCommand(['HSET', DIGESTED, ...fresh.flatMap((a) => [a.key, new Date(nowMs).toISOString()])])
  return { sent: true, fresh: fresh.length, open: open.length }
}

// ---------- the portal actions (Lee and Ligia; the dispatcher checks admin) ----------

const SHOWS = ['todo', 'done', 'all']
export async function absenceAction({ principal, config, body, action, agent = false, saveConfig }) {
  if (action === 'absenceAlerts') return { status: 200, ...(await absenceAlerts(config)) }
  if (action === 'absenceDigest') {
    if (typeof body.on !== 'boolean') return { status: 400, error: 'Say on or off.' }
    // Emails to Ligia start only when Lee or Ligia switch them on in the portal.
    if (agent) return { status: 403, error: 'Only Lee or Ligia switch this on, in the portal.' }
    await saveConfig({ absenceDigest: body.on })
    await audit({ by: principal.email, action: 'absence.digest', target: 'config', after: { on: body.on } })
    return { status: 200, digest: body.on }
  }
  const list = withFollowUps(await loadAbsences(config), await followUps())
  if (action === 'absenceFollowUp' || action === 'absenceUndo') {
    const key = `${clean(body.rowId, 30)}|${clean(body.date, 10)}`
    const a = list.find((x) => x.key === key)
    if (!a) return { status: 404, error: 'That player is not on the missing list any more.' }
    if (action === 'absenceUndo') {
      await kvCommand(['HDEL', FOLLOWUP, key])
      await audit({ by: principal.email, action: 'absence.followup.undo', target: a.rowId, after: { date: a.latest } })
      return { status: 200, key }
    }
    const rec = { by: principal.email, at: new Date().toISOString(), note: clean(body.note, 300), player: a.name }
    await kvCommand(['HSET', FOLLOWUP, key, JSON.stringify(rec)])
    await audit({ by: principal.email, action: 'absence.followup', target: a.rowId, after: { date: a.latest, player: a.name } })
    return { status: 200, key, followedUp: rec }
  }
  // absenceList
  const show = SHOWS.includes(body.show) ? body.show : 'todo'
  const todo = list.filter((a) => !a.followedUp)
  const players = show === 'all' ? list : show === 'done' ? list.filter((a) => a.followedUp) : todo
  const sample = todo.length ? todo : list
  return {
    status: 200,
    show,
    today: sydneyToday(),
    inARow: IN_A_ROW,
    players,
    totals: { todo: todo.length, done: list.length - todo.length, all: list.length, told: list.filter((a) => a.told === 'all').length },
    digest: config.absenceDigest === true,
    // What the Monday email would say, from today's list (or a made up one when nobody is missing).
    digestWords: digestWords(sample.length ? sample : [{ name: 'Player name', group: 'Monday 5:25pm, Belrose HQ', coach: 'Coach name', inRow: 2, missed: [{ label: '13 Oct' }, { label: '20 Oct' }], told: 'none', toldCount: 0, lastCameLabel: '6 Oct' }]),
  }
}
