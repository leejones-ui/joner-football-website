// Player reports are due in week 9 (Lee, 20 Oct 2026).
//
// - From the start of week 9 the coach portal shows each coach how many of
//   their players' reports are sent (always on, nothing is sent).
// - Messages, only while config.reportReminders is true (off until Lee says
//   yes to the wording):
//     start  the first day of week 9: each coach with reports to do, email
//            and text
//     end    the last day of week 9 (Sunday), evening: each coach still
//            missing some, email and text; Lee on Telegram and Ligia by
//            email, who is still missing what
//   Each goes once per term (KV hash jfp:report-remind).
// A coach's players: those holding a place in groups they run (the group's
// own coach), not trials, not Joners Juniors. Sent this term counts.
import { kvCommand, getConfig, listGroups, coachById, coachLabel, locationFor, sydneyToday, dateLabel } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { listReports, termParts } from './_jfp-reports.js'

export const DUE_WEEK = 9
const DONE = 'jfp:report-remind'
const isJuniors = (g) => g?.label === 'Joners Juniors'
const isTest = (n) => /test/i.test(n || '')
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const mondayOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)) }

// Week 9 of the term: its Monday to Sunday, and where today sits.
export function dueWindow(config, today = sydneyToday()) {
  const start = addDays(mondayOf(config.termStart), (DUE_WEEK - 1) * 7)
  const end = addDays(start, 6)
  const termEnd = addDays(mondayOf(config.termStart), (Number(config.weeks) || 10) * 7 + 13)
  const week = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${mondayOf(config.termStart)}T00:00:00Z`)) / (7 * 86400000)) + 1
  const phase = today < start || today > termEnd ? 'none' : today <= end ? 'due' : 'overdue'
  return { start, end, endLabel: dateLabel(end), week, phase }
}

// Per coach: how many of their players have a report sent this term.
export function progress({ config, groups, roster, reports }) {
  const tp = termParts(config.term)
  const sent = new Set(reports.filter((r) => r.termNo === tp.termNo && r.year === tp.year && r.status === 'sent').map((r) => r.rowId))
  const byCoach = new Map()
  for (const r of roster.players) {
    if (!r.holdsPlace || /trial/i.test(r.paymentType || '') || isTest(r.player)) continue
    const g = groups.find((x) => x.id === r.groupId)
    if (!g || isJuniors(g) || !g.coachId) continue
    const c = byCoach.get(g.coachId) || byCoach.set(g.coachId, { coachId: g.coachId, total: 0, sent: 0, missing: [] }).get(g.coachId)
    c.total += 1
    if (sent.has(r.id)) c.sent += 1
    else c.missing.push({ rowId: r.id, name: r.player, session: `${g.day} ${g.time}, ${locationFor(config, g.location).name}` })
  }
  return [...byCoach.values()].map((c) => ({ ...c, name: coachLabel(coachById(config, c.coachId)), left: c.total - c.sent })).sort((a, b) => b.left - a.left || a.name.localeCompare(b.name))
}

export async function dueStatus(config) {
  const win = dueWindow(config)
  if (win.phase === 'none') return { ...win, coaches: [] }
  const [groups, roster, reports] = await Promise.all([listGroups(), loadRoster(), listReports()])
  return { ...win, coaches: progress({ config, groups, roster, reports }) }
}

// The words. Shown to Lee before anything is switched on.
export function words(stage, { coach, c, win }) {
  const first = coach.name
  const missingList = c.missing.slice(0, 30).map((m) => [m.name, m.session])
  if (stage === 'start') return {
    subject: 'Player reports due this week',
    heading: 'Player reports are due this week',
    paras: [`Hi ${first}, it is week ${DUE_WEEK}, so player reports are due by ${win.endLabel}.`, `You have sent ${c.sent} of ${c.total}. Still to do:`],
    list: missingList,
    text: `Joner Football: player reports are due by ${win.endLabel}. You have ${c.left} still to do. jonerfootball.com/jfp-portal`,
  }
  return {
    subject: 'Player reports overdue',
    heading: 'Player reports are overdue',
    paras: [`Hi ${first}, week ${DUE_WEEK} has finished and ${c.left} of your ${c.total} player reports are not sent yet. Please send them today.`, 'Lee and Ligia have been told. Still to do:'],
    list: missingList,
    text: `Joner Football: ${c.left} of your player reports are still not sent. Please send them today. jonerfootball.com/jfp-portal`,
  }
}
export function staffSummary(status) {
  const behind = status.coaches.filter((c) => c.left > 0)
  return {
    subject: behind.length ? `Player reports: ${behind.length} coach${behind.length === 1 ? '' : 'es'} still to finish` : 'Player reports: all sent',
    lines: status.coaches.map((c) => `${c.name}: ${c.sent} of ${c.total} sent${c.left ? `, ${c.left} to do` : ''}`),
  }
}

// Daily, from the evening push tick. Never sends unless Lee has switched it on.
export async function reportTick({ today = sydneyToday(), send } = {}) {
  const config = await getConfig()
  if (config.reportReminders !== true) return { off: true }
  const status = await dueStatus(config)
  if (status.phase === 'none') return { phase: 'none' }
  const stage = today >= status.end ? 'end' : today >= status.start ? 'start' : ''
  if (!stage) return { phase: status.phase }
  const out = { stage, coaches: 0, staff: false }
  const owner = (coach) => (config.superAdmins || []).includes(coach.email)
  for (const c of status.coaches) {
    const coach = coachById(config, c.coachId)
    if (!coach || !c.left || owner(coach)) continue
    const key = `${config.term}|${stage}|${c.coachId}`
    if (Number(await kvCommand(['HSETNX', DONE, key, new Date().toISOString()])) !== 1) continue
    await send.coach({ coach, ...words(stage, { coach, c, win: status }), kind: `report ${stage}` })
    out.coaches += 1
  }
  if (stage === 'end' && Number(await kvCommand(['HSETNX', DONE, `${config.term}|end|staff`, new Date().toISOString()])) === 1) {
    const s = staffSummary(status)
    await send.staff(s)
    out.staff = true
  }
  return out
}
