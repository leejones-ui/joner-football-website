// Player reports in the staff portal (Lee, 18 Oct 2026). Coaches reach these
// (they sit above the admin-only line in jfp-portal-data.js); a coach only
// ever sees, writes and sends reports for players in their own groups. Lee
// and Ligia can report on any JFP player.
//   reportHome        the players this person can report on, and their reports
//   reportStart       { rowId } a draft to carry on with, or a new card filled in,
//                     plus last: the levels on the player's last sent report
//   reportSave        { id?, rowId, fields } save a draft
//   reportGet         { id }
//   reportPdf         { id } the PDF, to save on this device
//   reportRecipients  { id } who it would go to, right now
//   reportSend        { id, confirm: true, expect: [{ role, name }], again? }
//   reportDelete      { id } a draft only
//   reportWithdraw    { id, on } Lee and Ligia: out of (or back into) the family account
import { clean, ageOn, sydneyToday, coachById, coachLabel, locationFor, normName, rowEmails } from './_jfp-store.js'
import { REPORT_ATTRS, REPORT_SCALE, REPORT_PROGRAMS, FEEDBACK_MAX, REMINDER_MAX, getReport, listReports, saveDraft, deleteDraft, sendReport, withdrawReport, recipientsFor, recipientView, staffView, prefill, termParts } from './_jfp-reports.js'
import { renderReportPdf, reportFilename } from './_jfp-report-pdf.js'
import { sendPlayerReport } from './_jfp-email.js'
import { siteUrl } from './_holiday-store.js'
import { lastLevelsFor } from './_jfp-progress.js'

export const REPORT_ACTIONS = new Set(['reportHome', 'reportStart', 'reportSave', 'reportGet', 'reportPdf', 'reportRecipients', 'reportSend', 'reportDelete', 'reportWithdraw'])

const ok = (res, data) => res.status(200).json({ success: true, ...data })
const no = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })

// deps: { isAdmin, groups, roster, isJuniorsGroup } from the portal.
export async function reportAction(req, res, principal, config, body, action, deps) {
  const { isAdmin, groups, roster, isJuniorsGroup } = deps
  const me = principal.email
  const myCoachId = principal.coachId || config.coaches.find((c) => c.email && c.email === principal.email)?.id || ''
  // A coach's own groups: theirs or ones they help on. Not a one-off cover.
  const mine = (g) => g && !isJuniorsGroup(g) && (isAdmin || (myCoachId && (g.coachId === myCoachId || (g.extraCoachIds || []).includes(myCoachId))))
  const access = async (rowId) => {
    const r = roster.players.find((x) => x.id === rowId && x.holdsPlace)
    const g = r && groups.find((x) => x.id === r.groupId)
    return r && g && mine(g) ? { row: r, group: g } : null
  }
  const canSee = async (rec) => isAdmin || rec.createdBy === me || Boolean(await access(rec.rowId))
  const view = (rec) => staffView(rec, { isAdmin, me })
  const p = { ...principal, coachId: myCoachId }

  if (action === 'reportHome') {
    const tp = termParts(config.term)
    const all = await listReports()
    const visible = []
    for (const r of all) if (await canSee(r)) visible.push(r)
    const byRow = new Map()
    for (const r of visible) if (r.termNo === tp.termNo && r.year === tp.year && r.status !== 'withdrawn') (byRow.get(r.rowId) || byRow.set(r.rowId, []).get(r.rowId)).push(r)
    const players = roster.players.filter((r) => r.holdsPlace).map((r) => ({ r, g: groups.find((x) => x.id === r.groupId) })).filter(({ g }) => mine(g)).map(({ r, g }) => {
      const reps = byRow.get(r.id) || []
      const sent = reps.filter((x) => x.status === 'sent').sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0]
      const draft = reps.find((x) => x.status === 'draft' && (x.createdBy === me || isAdmin))
      const coach = coachById(config, g.coachId)
      return {
        rowId: r.id, name: r.player, age: r.dob ? ageOn(r.dob, sydneyToday()) : null, session: `${g.day} ${g.time}, ${locationFor(config, g.location).name}`,
        groupId: g.id, coach: coachLabel(coach), trial: /trial/i.test(r.paymentType || ''),
        sentAt: sent?.sentAt || '', sentId: sent?.id || '', draftId: draft?.id || '', draftBy: draft && draft.createdBy !== me ? draft.createdByName || 'another coach' : '',
      }
    }).sort((a, b) => a.session.localeCompare(b.session) || a.name.localeCompare(b.name))
    return ok(res, {
      isAdmin, term: config.term, termNo: tp.termNo, year: tp.year, players, reports: visible.slice(0, 400).map(view),
      form: { attrs: REPORT_ATTRS, scale: REPORT_SCALE, programs: REPORT_PROGRAMS, feedbackMax: FEEDBACK_MAX, reminderMax: REMINDER_MAX },
    })
  }

  if (action === 'reportStart') {
    const a = await access(clean(body.rowId, 30))
    if (!a) return no(res, 404, 'That player is not in your groups.')
    const tp = termParts(config.term)
    const all = await listReports()
    const drafts = all.filter((x) => x.status === 'draft' && x.rowId === a.row.id && x.termNo === tp.termNo && x.year === tp.year)
    const own = drafts.find((x) => x.createdBy === me) || (isAdmin ? drafts[0] : null)
    // Progress (Lee, 20 Oct 2026): the levels on this player's last sent
    // report, shown next to each rating. Only after access() said yes.
    const last = lastLevelsFor(all, { rowId: a.row.id, playerKey: normName(a.row.player), emails: rowEmails(a.row), excludeId: own?.id || '' })
    if (own) return ok(res, { report: view(own), resumed: true, last })
    const fill = prefill({ config, row: a.row, group: a.group, principal: p })
    return ok(res, { report: { id: '', status: 'new', rowId: a.row.id, player: a.row.player, session: `${a.group.day} ${a.group.time}, ${locationFor(config, a.group.location).name}`, ...fill }, resumed: false, last })
  }

  if (action === 'reportSave') {
    const out = await saveDraft({ config, principal: p, isAdmin, access, body })
    if (!out.ok) return no(res, out.status, out.error, out.code ? { code: out.code } : {})
    return ok(res, { report: view(out.report) })
  }

  const rec = REPORT_ACTIONS.has(action) && body.id ? await getReport(clean(body.id, 40)) : null
  if (!rec || !(await canSee(rec))) return no(res, 404, 'That report is not here, or it is not one of yours.')

  if (action === 'reportGet') return ok(res, { report: view(rec) })

  if (action === 'reportPdf') {
    try {
      const bytes = await renderReportPdf(rec)
      return ok(res, { filename: reportFilename(rec), pdf: Buffer.from(bytes).toString('base64') })
    } catch (error) {
      console.error('jfp report pdf failed', error)
      return no(res, 500, 'The PDF could not be made just now. Try again in a moment.')
    }
  }

  if (action === 'reportRecipients') {
    const a = await access(rec.rowId)
    if (!a) return no(res, 404, 'That player is not in your groups any more.')
    return ok(res, { recipients: recipientView(await recipientsFor(a.row), { isAdmin }), player: a.row.player })
  }

  if (action === 'reportSend') {
    const out = await sendReport({
      config, principal: p, isAdmin, access, body, siteUrl: siteUrl(req),
      sendEmail: sendPlayerReport,
      pdfFor: async (r) => ({ filename: reportFilename(r), base64: Buffer.from(await renderReportPdf(r)).toString('base64') }),
    })
    if (!out.ok) return no(res, out.status, out.error, { ...(out.code ? { code: out.code } : {}), ...(out.recipients ? { recipients: out.recipients } : {}) })
    return ok(res, { report: view(out.report) })
  }

  if (action === 'reportDelete') {
    const out = await deleteDraft({ principal: p, isAdmin, id: rec.id })
    return out.ok ? ok(res, {}) : no(res, out.status, out.error)
  }

  if (action === 'reportWithdraw') {
    if (!isAdmin) return no(res, 403, 'Only Lee or Ligia can take a report out of a family account.')
    const out = await withdrawReport({ principal: p, id: rec.id, on: body.on !== false })
    return out.ok ? ok(res, { report: view(out.report) }) : no(res, out.status, out.error)
  }
  return no(res, 400, 'Unknown report action.')
}
