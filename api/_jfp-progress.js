// Progress over the terms (Lee, 20 Oct 2026): "A few skill ratings on each
// report, shown as a progress line on the family's page".
//
// Built only from SENT player reports (_jfp-reports.js). A draft or a report
// Lee or Ligia took out of the account never counts, so a family never sees
// a level the coach has not sent them.
//   progressFor(reports)   one player's line: the overall average per term,
//                          and per skill the levels and the change since the
//                          report before
//   progressByPlayer(list) the same for each player in a family's list
//   lastLevelsFor(...)     for a coach writing a new report: the levels on
//                          the player's last sent report
// One point per term: if a term had two reports (sent "again" on purpose),
// the later one is the term's level.
import { REPORT_ATTRS, REPORT_SCALE, termParts, overallOf } from './_jfp-reports.js'

const MAX_POINTS = 12 // three years of terms is plenty for a phone screen

// "Term 3 2026" sorts before "Term 4 2026", and 2026 before 2027.
export function termOrder(rec) {
  const { termNo, year } = termParts(`Term ${rec?.termNo} ${rec?.year}`)
  return Number(year) * 10 + (Number(termNo) || 0)
}
const level = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null)
const changeOf = (now, prev) => (now == null || prev == null ? null : now > prev ? 'up' : now < prev ? 'down' : 'same')
const isSent = (r) => r && r.status === 'sent'

// The latest sent report in each term, oldest term first.
export function termReports(reports = []) {
  const byTerm = new Map()
  for (const r of reports.filter(isSent)) {
    const k = termOrder(r)
    const had = byTerm.get(k)
    if (!had || String(r.sentAt || '') > String(had.sentAt || '')) byTerm.set(k, r)
  }
  return [...byTerm.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r).slice(-MAX_POINTS)
}

// reports: one player's reports, any status, any order.
export function progressFor(reports = []) {
  const reps = termReports(reports)
  const points = reps.map((r) => ({ id: r.id, termNo: String(r.termNo), year: String(r.year), label: `Term ${r.termNo} ${r.year}`, overall: overallOf(r), sentAt: r.sentAt || '' }))
  const last = reps.at(-1), before = reps.at(-2)
  const skills = REPORT_ATTRS.map((a) => {
    const history = reps.map((r) => level(r.ratings?.[a.k]))
    const now = last ? level(last.ratings?.[a.k]) : null
    const prev = before ? level(before.ratings?.[a.k]) : null
    return { k: a.k, l: a.l, history, now, word: now ? REPORT_SCALE[now - 1] : '', prev, change: changeOf(now, prev) }
  })
  const oNow = points.at(-1)?.overall ?? null
  const oPrev = points.at(-2)?.overall ?? null
  const counts = { up: 0, down: 0, same: 0 }
  for (const s of skills) if (s.change) counts[s.change] += 1
  return {
    count: points.length, points, skills, counts,
    overall: { now: oNow, prev: oPrev, change: changeOf(oNow, oPrev) },
    since: points.length > 1 ? points.at(-2).label : '',
  }
}

// A family's list (already only theirs) split by player, in list order.
export function progressByPlayer(list = []) {
  const by = new Map()
  for (const r of list.filter(isSent)) {
    const key = r.playerKey || String(r.player || '').toLowerCase()
    if (!by.has(key)) by.set(key, { player: r.player, reps: [] })
    by.get(key).reps.push(r)
  }
  return [...by.values()].map(({ player, reps }) => ({ player, ...progressFor(reps) })).filter((p) => p.count > 0)
}

// For the coach's report form. The same player is the same row, or the same
// name on a row with one of the same family emails (a new term's row).
// The caller has already checked this coach may report on the row.
export function lastLevelsFor(reports = [], { rowId, playerKey, emails = [], excludeId = '' } = {}) {
  const fam = new Set(emails.map((e) => String(e).toLowerCase()))
  const same = (r) => r.rowId === rowId || (playerKey && r.playerKey === playerKey && (r.rowEmails || []).some((e) => fam.has(String(e).toLowerCase())))
  const r = termReports(reports.filter((x) => isSent(x) && x.id !== excludeId && same(x))).at(-1)
  if (!r) return null
  return {
    termNo: String(r.termNo), year: String(r.year), label: `Term ${r.termNo} ${r.year}`, sentAt: r.sentAt || '', overall: overallOf(r),
    ratings: Object.fromEntries(REPORT_ATTRS.map((a) => [a.k, level(r.ratings?.[a.k])]).filter(([, v]) => v != null)),
  }
}
