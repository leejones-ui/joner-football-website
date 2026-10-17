// Player reports (Lee, 18 Oct 2026): "the player reports needs to be on every
// coaches portal ... when we save the report, the report then goes into the
// players portal in a brand new player report tab ... coaches can only do
// reports for their players only".
//
// The report card is the one on /coach-report/ (16 ratings, feedback, next
// term, coach and date, two QR codes). Here it is a record:
//   jfp:report:<id>      JSON, the report (draft, sent or withdrawn)
//   jfp:reports          zset of ids, scored by last change (ms)
//   jfp:report-read      hash "<email>|<id>" -> ISO, when a family opened it
//
// Getting it to the right family is the whole point, so:
//   - a report is tied to ONE Term 4 row (rowId) when it is started, and the
//     player's name on the card always comes from that row, never typed;
//   - who it goes to is worked out on the server at the moment of sending,
//     from that row's own emails (and the player's own login, if they have
//     one), and saved on the report;
//   - a coach can start, save or send only for a player in one of their own
//     groups (the caller's access() decides, see jfp-portal-data.js);
//   - the family sees a report only when their sign-in email was one it was
//     sent to, or the row is theirs now; a player login sees only their own.
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, audit, newId, clean, sydneyToday, normName, rowEmails, coachById, coachLabel, locationFor, dateLabel } from './_jfp-store.js'

export const REPORT_ATTRS = [
  ['attendance', 'Attendance'], ['time_management', 'Time Management'], ['attitude', 'Attitude'], ['concentration', 'Concentration'],
  ['body_language', 'Body Language'], ['group_work', 'Working Within a Group'], ['communication', 'Communication'], ['conditioning', 'Conditioning'],
  ['passing', 'Passing'], ['first_touch', '1st Touch'], ['dribbling', 'Dribbling'], ['footwork', 'Footwork / Balance'],
  ['ball_striking', 'Ball Striking'], ['both_feet', 'Use of Both Feet'], ['awareness', 'Awareness'], ['1v1s', '1v1s'],
].map(([k, l]) => ({ k, l }))
export const REPORT_SCALE = ['Needs Work', 'Developing', 'Competent', 'Strong', 'Excellent']
export const REPORT_PROGRAMS = ['JFP Performance', 'Professional Training', 'Elite Camp']
export const FEEDBACK_MAX = 2500
export const REMINDER_MAX = 600
export const QR_DEFAULTS = {
  list: { url: 'https://www.jonerfootball.com/stay', label: 'Join the JFP list', sub: 'Scan for term dates' },
  app: { url: 'https://app.jonerfootball.com', label: 'Train on the app', sub: 'Scan to train at home' },
}

const K = { rec: (id) => `jfp:report:${id}`, index: 'jfp:reports', read: 'jfp:report-read' }
const KEEP = 60 * 60 * 24 * 365 * 3 // three years
const ID = /^RPT-\d{10,16}-[0-9A-F]{6}$/
const ISO = /^\d{4}-\d{2}-\d{2}$/

// "Term 4 2026" -> { termNo: '4', year: '2026' }
export function termParts(term) {
  const m = /Term\s*(\d)\D+(\d{4})/i.exec(String(term || ''))
  return m ? { termNo: m[1], year: m[2] } : { termNo: '', year: String(new Date().getFullYear()) }
}
const sessionOf = (config, row, group) => [group?.day || row.day, group?.time || row.time, locationFor(config, group?.location || row.location).name].filter(Boolean).join(' ')

// ---------- storage ----------
export async function getReport(id) {
  if (!ID.test(String(id || ''))) return null
  return kvGetJson(K.rec(id))
}
async function putReport(rec) {
  rec.updatedAt = new Date().toISOString()
  await kvSetJson(K.rec(rec.id), rec, KEEP)
  await kvCommand(['ZADD', K.index, String(Date.parse(rec.updatedAt)), rec.id])
  return rec
}
export async function listReports() {
  const ids = (await kvCommand(['ZREVRANGE', K.index, '0', '3999'])) || []
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const vals = (await kvCommand(['MGET', ...part.map(K.rec)])) || []
    vals.forEach((v) => { try { const r = v ? JSON.parse(v) : null; if (r?.id) out.push(r) } catch {} })
  }
  return out
}

// ---------- cleaning what the form sends ----------
export function cleanFields(input = {}, { config } = {}) {
  const errors = []
  const ratings = {}
  for (const a of REPORT_ATTRS) {
    const v = Number(input.ratings?.[a.k] ?? 0)
    ratings[a.k] = Number.isInteger(v) && v >= 0 && v <= 5 ? v : 0
  }
  const program = REPORT_PROGRAMS.includes(input.program) ? input.program : REPORT_PROGRAMS[0]
  const tp = termParts(config?.term)
  const termNo = /^[1-4]$/.test(String(input.termNo || '')) ? String(input.termNo) : tp.termNo || '4'
  const year = /^\d{4}$/.test(String(input.year || '')) ? String(input.year) : tp.year
  const reportDate = ISO.test(String(input.reportDate || '')) ? String(input.reportDate) : sydneyToday()
  const keepLines = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  const feedback = keepLines(input.feedback, FEEDBACK_MAX)
  if (String(input.feedback ?? '').trim().length > FEEDBACK_MAX) errors.push(`The feedback is longer than ${FEEDBACK_MAX} characters. Shorten it a little.`)
  const reminder = keepLines(input.reminder, REMINDER_MAX)
  const location = clean(input.location, 60)
  const coachName = clean(input.coachName, 60)
  return { ok: !errors.length, errors, fields: { ratings, program, termNo, year, reportDate, feedback, reminder, location, coachName } }
}

export const scored = (rec) => REPORT_ATTRS.filter((a) => rec.ratings?.[a.k] > 0).length
export function overallOf(rec) {
  const xs = REPORT_ATTRS.map((a) => rec.ratings?.[a.k] || 0).filter((v) => v > 0)
  return xs.length ? Math.round((xs.reduce((t, v) => t + v, 0) / xs.length) * 10) / 10 : null
}
export const reportTitle = (rec) => `Term ${rec.termNo} ${rec.year} player report`

// ---------- new and saved drafts ----------
// What a fresh report starts with for this row: everything the card needs,
// filled from the player's row, group and coach.
export function prefill({ config, row, group, principal }) {
  const tp = termParts(config.term)
  const coach = coachById(config, group?.coachId) || null
  const me = principal.coachId ? coachById(config, principal.coachId) : null
  return {
    program: REPORT_PROGRAMS[0], termNo: tp.termNo || '4', year: tp.year, reportDate: sydneyToday(),
    location: locationFor(config, group?.location || row.location).name || 'Sydney, AUS',
    coachName: coachLabel(me || coach) || principal.name || '',
    ratings: Object.fromEntries(REPORT_ATTRS.map((a) => [a.k, 0])), feedback: '', reminder: '',
  }
}

// Save a draft (new or existing). access(rowId) -> { row, group } | null.
export async function saveDraft({ config, principal, isAdmin, access, body }) {
  const id = clean(body.id, 40)
  let rec = id ? await getReport(id) : null
  if (id && !rec) return { status: 404, error: 'That report is not here any more.' }
  if (rec && rec.status !== 'draft') return { status: 409, error: 'This report has been sent, so it cannot be changed. Start a new one if something needs to change.', code: 'sent' }
  const rowId = rec ? rec.rowId : clean(body.rowId, 30)
  const a = await access(rowId)
  if (!a) return { status: 404, error: 'That player is not in your groups.' }
  if (rec && !isAdmin && rec.createdBy !== principal.email) return { status: 403, error: 'Only the coach who started this report, or Lee and Ligia, can change it.' }
  const c = cleanFields(body.fields || {}, { config })
  if (!c.ok) return { status: 400, error: c.errors.join(' ') }
  const now = new Date().toISOString()
  if (!rec) {
    rec = { id: newId('RPT'), status: 'draft', rowId, createdBy: principal.email, createdByName: principal.name || '', createdAt: now, coachId: principal.coachId || a.group?.coachId || '' }
  }
  Object.assign(rec, c.fields, bindRow(config, a.row, a.group), { updatedBy: principal.email })
  await putReport(rec)
  return { ok: true, report: rec }
}

// The player on a report always comes from their row.
function bindRow(config, row, group) {
  return { player: row.player, playerKey: normName(row.player), groupId: group?.id || row.groupId || '', session: sessionOf(config, row, group), ownContact: row.ownContact === true }
}

export async function deleteDraft({ principal, isAdmin, id }) {
  const rec = await getReport(id)
  if (!rec) return { status: 404, error: 'That report is not here any more.' }
  if (rec.status !== 'draft') return { status: 409, error: 'A sent report cannot be deleted. Lee or Ligia can take it out of the family account.' }
  if (!isAdmin && rec.createdBy !== principal.email) return { status: 403, error: 'Only the coach who started it, or Lee and Ligia, can delete it.' }
  await kvPipeline([['DEL', K.rec(rec.id)], ['ZREM', K.index, rec.id]])
  await audit({ by: principal.email, action: 'report.delete', target: rec.id, after: { player: rec.player } })
  return { ok: true }
}

// ---------- who it goes to ----------
// The row's own emails are the family (a player who is their own contact has
// their own email on the row). A player login (12+) linked to the row's
// family gets their own copy. Never anyone else.
export async function recipientsFor(row) {
  const { loginsForRows } = await import('./_jfp-player-logins.js')
  const family = [...new Set(rowEmails(row).map((e) => e.toLowerCase()))]
  const logins = (await loginsForRows([row]).catch(() => [])).map((e) => e.toLowerCase()).filter((e) => !family.includes(e))
  const parentName = row.ownContact ? '' : String(row.parent || '').trim()
  return [
    ...family.map((email) => ({ role: row.ownContact ? 'player' : 'parent', email, name: row.ownContact ? row.player : parentName })),
    ...logins.map((email) => ({ role: 'player login', email, name: row.player })),
  ]
}
export function maskEmail(e) {
  const [u, d] = String(e || '').split('@')
  if (!d) return ''
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`
}
export function recipientView(list, { isAdmin }) {
  return list.map((r) => ({ role: r.role, name: r.name || '', email: isAdmin ? r.email : maskEmail(r.email) }))
}

// ---------- sending ----------
// confirm: the person pressed Send on the screen that showed who it goes to.
// expect: the emails that screen showed (hashed in the browser is not needed;
// it is the same list, checked again here so nothing changed in between).
export async function sendReport({ config, principal, isAdmin, access, body, siteUrl, sendEmail, pdfFor }) {
  const rec = await getReport(clean(body.id, 40))
  if (!rec) return { status: 404, error: 'That report is not here any more.' }
  if (rec.status === 'sent') return { status: 409, error: `This report was already sent on ${dateLabel(rec.sentAt.slice(0, 10))}.`, code: 'sent' }
  if (rec.status !== 'draft') return { status: 409, error: 'This report cannot be sent.' }
  if (!isAdmin && rec.createdBy !== principal.email) return { status: 403, error: 'Only the coach who started this report, or Lee and Ligia, can send it.' }
  if (body.confirm !== true) return { status: 400, error: 'Check who it goes to, then press Send.' }
  const a = await access(rec.rowId)
  if (!a) return { status: 404, error: 'That player is not in your groups any more, so the report was not sent.' }
  // The card says what the row says, at the moment it goes.
  Object.assign(rec, bindRow(config, a.row, a.group))
  if (!scored(rec) && !rec.feedback) return { status: 400, error: 'Add some ratings or feedback before sending.' }
  const to = await recipientsFor(a.row)
  if (!to.length) return { status: 409, error: `${rec.player} has no email on file, so the report cannot be sent. Lee or Ligia can add one in Players.`, code: 'no-email' }
  const shown = Array.isArray(body.expect) ? body.expect.map((x) => String(x?.role || '') + '|' + String(x?.name || '')).sort() : null
  const now = recipientView(to, { isAdmin }).map((x) => `${x.role}|${x.name}`).sort()
  if (!shown || JSON.stringify(shown) !== JSON.stringify(now)) return { status: 409, error: 'Who this report goes to has changed since you opened it. Check again before sending.', code: 'recipients', recipients: recipientView(to, { isAdmin }) }
  // A second report for the same player this term is fine, but only on purpose.
  const earlier = (await listReports()).find((x) => x.id !== rec.id && x.status === 'sent' && x.rowId === rec.rowId && x.termNo === rec.termNo && x.year === rec.year)
  if (earlier && body.again !== true) return { status: 409, error: `${rec.player} already had a Term ${rec.termNo} report, sent ${dateLabel(earlier.sentAt.slice(0, 10))}. Send this one as well?`, code: 'again' }
  // One send at a time for a report (a double tap, two devices).
  const lock = await kvCommand(['SET', `jfp:report-lock:${rec.id}`, '1', 'NX', 'EX', '60'])
  if (lock !== 'OK') return { status: 409, error: 'This report is sending already.' }
  try {
    // Read again under the lock: a send that finished a moment ago wins.
    const fresh = await getReport(rec.id)
    if (!fresh || fresh.status !== 'draft') return { status: 409, error: 'This report was already sent.', code: 'sent' }
    const pdf = await pdfFor(rec)
    const familyEmails = [...new Set(rowEmails(a.row).map((e) => e.toLowerCase()))]
    rec.status = 'sent'; rec.sentAt = new Date().toISOString(); rec.sentBy = principal.email; rec.sentByName = principal.name || ''
    rec.rowEmails = familyEmails
    rec.recipients = to
    rec.delivery = []
    // Saved as sent before any email goes, so the family can see it even if
    // an email fails, and a retry never sends it twice.
    await putReport(rec)
    const url = `${siteUrl}/jfp-account/#reports`
    const first = String(rec.player).split(' ')[0]
    const groups = [
      { list: to.filter((r) => r.role !== 'player login'), self: rec.ownContact },
      ...to.filter((r) => r.role === 'player login').map((r) => ({ list: [r], self: true })),
    ].filter((g) => g.list.length)
    for (const g of groups) {
      try {
        const out = await sendEmail({ to: g.list.map((r) => ({ email: r.email, name: r.name })), player: rec.player, first, self: g.self, greet: g.self ? first : String(g.list[0].name || '').split(' ')[0], term: `Term ${rec.termNo} ${rec.year}`, url, pdf })
        for (const r of g.list) rec.delivery.push({ email: r.email, status: out?.held ? 'held' : 'sent', messageId: out?.messageId || '', heldId: out?.heldId || '', at: new Date().toISOString() })
      } catch (error) {
        console.error('jfp report email failed', error)
        for (const r of g.list) rec.delivery.push({ email: r.email, status: 'failed', error: String(error.message || error).slice(0, 200), at: new Date().toISOString() })
      }
    }
    await putReport(rec)
    await audit({ by: principal.email, action: 'report.send', target: rec.id, after: { player: rec.player, rowId: rec.rowId, term: `${rec.termNo} ${rec.year}`, to: rec.delivery.map((d) => `${d.status}`).join(',') } })
    // A phone notification too, where the family has them on.
    try {
      const { pushTo } = await import('./_jfp-push.js')
      await pushTo(new Set(to.map((r) => r.email)), 'notes', { title: `${first}'s player report`, body: `${reportTitle(rec)} is in your JFP account.`, url: '/jfp-account/#reports', tag: `report-${rec.id}` }, `report-${rec.id}`)
    } catch (error) { console.error('jfp report push failed', error) }
    return { ok: true, report: rec }
  } finally {
    await kvCommand(['DEL', `jfp:report-lock:${rec.id}`]).catch(() => {})
  }
}

// Lee or Ligia: take a sent report out of the family account (it stays on file).
export async function withdrawReport({ principal, id, on = true }) {
  const rec = await getReport(id)
  if (!rec) return { status: 404, error: 'That report is not here any more.' }
  if (on && rec.status !== 'sent') return { status: 409, error: 'Only a sent report can be taken out of the family account.' }
  if (!on && rec.status !== 'withdrawn') return { status: 409, error: 'That report is not withdrawn.' }
  rec.status = on ? 'withdrawn' : 'sent'
  if (on) { rec.withdrawnBy = principal.email; rec.withdrawnAt = new Date().toISOString() } else { delete rec.withdrawnBy; delete rec.withdrawnAt }
  await putReport(rec)
  await audit({ by: principal.email, action: on ? 'report.withdraw' : 'report.restore', target: rec.id, after: { player: rec.player } })
  return { ok: true, report: rec }
}

// ---------- views ----------
export function staffView(rec, { isAdmin, me }) {
  const base = {
    id: rec.id, status: rec.status, rowId: rec.rowId, player: rec.player, session: rec.session, program: rec.program, termNo: rec.termNo, year: rec.year,
    reportDate: rec.reportDate, location: rec.location, coachName: rec.coachName, ratings: rec.ratings, feedback: rec.feedback, reminder: rec.reminder,
    overall: overallOf(rec), scored: scored(rec), createdByName: rec.createdByName || '', createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    sentAt: rec.sentAt || '', sentByName: rec.sentByName || '', mine: rec.createdBy === me, withdrawnAt: rec.withdrawnAt || '',
  }
  if (rec.status !== 'draft') {
    const byEmail = Object.fromEntries((rec.delivery || []).map((d) => [d.email, d]))
    base.recipients = (rec.recipients || []).map((r) => ({ role: r.role, name: r.name || '', email: isAdmin ? r.email : maskEmail(r.email), status: byEmail[r.email]?.status || '', error: isAdmin ? byEmail[r.email]?.error || '' : '' }))
  }
  return base
}
export function familyView(rec, readSet) {
  return {
    id: rec.id, player: rec.player, title: reportTitle(rec), program: rec.program, termNo: rec.termNo, year: rec.year, reportDate: rec.reportDate,
    location: rec.location, coachName: rec.coachName, ratings: rec.ratings, feedback: rec.feedback, reminder: rec.reminder, overall: overallOf(rec),
    sentAt: rec.sentAt, read: Boolean(readSet?.has(rec.id)),
  }
}

// Reports a family may see: sent (not withdrawn), and either sent to this
// email or on one of the family's rows now. A player login: their own only.
export async function reportsForFamily({ email, rowIds = [], playerKey = '', parentEmail = '' }) {
  const e = String(email || '').toLowerCase()
  const pe = String(parentEmail || '').toLowerCase()
  const rows = new Set(rowIds)
  const all = (await listReports()).filter((r) => r.status === 'sent')
  const mine = all.filter((r) => {
    const sentTo = (r.recipients || []).map((x) => x.email)
    const family = r.rowEmails || []
    if (playerKey) return r.playerKey === playerKey && (rows.has(r.rowId) || sentTo.includes(e) || family.includes(pe))
    return rows.has(r.rowId) || sentTo.includes(e) || family.includes(e)
  })
  return mine.sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
}
export async function readSetFor(email, ids) {
  if (!ids.length) return new Set()
  const vals = (await kvCommand(['HMGET', K.read, ...ids.map((id) => `${String(email).toLowerCase()}|${id}`)])) || []
  return new Set(ids.filter((id, i) => vals[i]))
}
export async function markReportsRead(email, ids, allowed) {
  const ok = (Array.isArray(ids) ? ids : []).filter((id) => allowed.has(id)).slice(0, 100)
  if (!ok.length) return 0
  const at = new Date().toISOString()
  await kvCommand(['HSET', K.read, ...ok.flatMap((id) => [`${String(email).toLowerCase()}|${id}`, at])])
  return ok.length
}
