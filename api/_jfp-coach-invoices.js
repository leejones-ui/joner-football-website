// Coach invoices (Lee, 19 Oct 2026: "so invoices match up, especially when
// coaches cover"). A coach makes an invoice for a period from the hours they
// logged (My hours, api/_jfp-hours.js), so the invoice and the hours are the
// same thing and nothing is typed twice. Each line is checked against the
// cover records: a session someone else covered, a cover with no record, or a
// session two coaches both claimed is flagged for Lee and Ligia. An hours entry
// sits on one invoice only.
//
// Rates: an hourly rate per coach that Lee or Ligia set (config.coachRates,
// cents). No rate yet: the invoice is hours only and says Lee sets the rate.
import { kvCommand, clean, newId, audit, dateLabel, coachById, coachLabel, formatAud, saveConfig, listGroups, locationFor, sydneyToday } from './_jfp-store.js'
import { allHours, HOUR_KINDS } from './_jfp-hours.js'

const KEY = 'jfp:coach-invoices'
const HOURS = 'jfp:hours'
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const INVOICE_ACTIONS = new Set(['coachInvList', 'coachInvCreate', 'coachInvWithdraw', 'coachInvDecide', 'coachInvRate'])
export const INV_STATUS = { submitted: 'Waiting', approved: 'Approved', paid: 'Paid', queried: 'Sent back', withdrawn: 'Withdrawn' }
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

async function allInvoices() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out.push(x) }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

// Pure: the checks on one coach's lines. covers: every cover record; hours: every hours entry.
export function flagsFor(line, coachId, { covers, hours, name }) {
  const flags = []
  if (line.status !== 'approved') flags.push({ code: 'waiting', text: line.status === 'queried' ? 'Sent back in My hours' : 'Not approved in My hours yet' })
  if (line.groupId) {
    const active = covers.filter((c) => c.status === 'active' && c.groupId === line.groupId && c.date === line.date)
    if (line.kind === 'session') { const c = active.find((x) => x.coachId === coachId); if (c) flags.push({ code: 'covered', text: `Covered by ${name(c.coverCoachId)} that day` }) }
    if (line.kind === 'cover' && !active.some((x) => x.coverCoachId === coachId)) flags.push({ code: 'no-cover', text: 'No cover on record for this session' })
    const other = hours.find((h) => h.coachId !== coachId && h.groupId === line.groupId && h.date === line.date && ['session', 'cover'].includes(h.kind) && h.kind === line.kind)
    if (other) flags.push({ code: 'double', text: `${name(other.coachId)} also logged this session` })
  }
  return flags
}

function view(inv, config, isAdmin) {
  return { ...inv, coach: coachLabel(coachById(config, inv.coachId)), statusLabel: INV_STATUS[inv.status] || inv.status, amountLabel: inv.amountCents ? formatAud(inv.amountCents) : '', rateLabel: inv.rateCents ? `${formatAud(inv.rateCents)} an hour` : '', fromLabel: dateLabel(inv.from), toLabel: dateLabel(inv.to), flagCount: inv.lines.reduce((t, l) => t + l.flags.length, 0), canWithdraw: !isAdmin && inv.status === 'submitted' }
}

// The lines a coach would invoice for [from, to]: their hours not on another invoice.
async function linesFor(config, coachId, from, to, { listCovers }) {
  const [hours, covers, groups] = await Promise.all([allHours(), listCovers(), listGroups()])
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const name = (id) => coachLabel(coachById(config, id))
  return hours.filter((h) => h.coachId === coachId && h.date >= from && h.date <= to && !h.invoiceId).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)).map((h) => {
    const g = byId[h.groupId]
    const line = { hoursId: h.id, date: h.date, dateLabel: dateLabel(h.date), start: h.start, end: h.end, minutes: h.minutes, kind: h.kind, kindLabel: HOUR_KINDS[h.kind] || h.kind, groupId: h.groupId || '', what: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : h.note || '', status: h.status }
    return { ...line, flags: flagsFor(line, coachId, { covers, hours, name }) }
  })
}

export async function invoiceAction(res, principal, config, body, action, { isAdmin, myCoachId, listCovers }) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const today = sydneyToday()

  if (action === 'coachInvList') {
    const coachId = isAdmin ? clean(body.coachId, 30) : myCoachId
    if (!isAdmin && !coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const list = (await allInvoices()).filter((x) => !coachId || x.coachId === coachId)
    const from = ISO.test(body.from || '') ? body.from : ''
    const to = ISO.test(body.to || '') ? body.to : today
    const draft = !isAdmin && from ? await linesFor(config, coachId, from, to, { listCovers }) : null
    const rate = coachId ? config.coachRates?.[coachId] || 0 : 0
    return ok({ invoices: list.map((x) => view(x, config, isAdmin)), draft, rateCents: isAdmin ? undefined : rate, rateLabel: rate ? `${formatAud(rate)} an hour` : '', rates: isAdmin ? Object.fromEntries(config.coaches.map((c) => [c.id, config.coachRates?.[c.id] || 0])) : undefined, coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : undefined, status: INV_STATUS, admin: isAdmin })
  }

  if (action === 'coachInvCreate') {
    const coachId = myCoachId
    if (!coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const from = clean(body.from, 10), to = clean(body.to, 10)
    if (!ISO.test(from) || !ISO.test(to) || to < from) return no(400, 'Choose the first and last day of the invoice.')
    if (to > today) return no(400, 'An invoice can only cover days already worked.')
    const lines = await linesFor(config, coachId, from, to, { listCovers })
    if (!lines.length) return no(400, 'No hours to invoice in those dates. Log them in My hours first.')
    // Claim each hours entry for this invoice, so it can never be on two.
    const id = newId('CINV')
    const claimed = []
    for (const l of lines) {
      const got = await kvCommand(['SET', `jfp:hours-invoiced:${l.hoursId}`, id, 'NX'])
      if (got === 'OK') claimed.push(l)
    }
    if (!claimed.length) return no(409, 'Those hours are already on an invoice.')
    const seq = Number(await kvCommand(['HINCRBY', 'jfp:coach-invoice-seq', coachId, '1']))
    const rate = config.coachRates?.[coachId] || 0
    const totalMinutes = claimed.reduce((t, l) => t + l.minutes, 0)
    const inv = {
      id, number: `${coachId.toUpperCase()}-${String(seq).padStart(3, '0')}`, coachId, from, to, lines: claimed, totalMinutes,
      rateCents: rate, amountCents: rate ? Math.round((rate * totalMinutes) / 60) : 0,
      abn: clean(body.abn, 20), payTo: clean(body.payTo, 200), note: clean(body.note, 400),
      status: 'submitted', createdAt: new Date().toISOString(), by: principal.email,
    }
    await kvCommand(['HSET', KEY, id, JSON.stringify(inv)])
    for (const l of claimed) { const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h) await kvCommand(['HSET', HOURS, h.id, JSON.stringify({ ...h, invoiceId: id })]) }
    await audit({ by: principal.email, action: 'coach-invoice.create', target: id, after: { coachId, from, to, minutes: totalMinutes, lines: claimed.length } })
    return ok({ invoice: view(inv, config, isAdmin) })
  }

  const inv = parse(await kvCommand(['HGET', KEY, clean(body.id, 40)]))
  const release = async () => { for (const l of inv.lines) { await kvCommand(['DEL', `jfp:hours-invoiced:${l.hoursId}`]); const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h?.invoiceId === inv.id) { const { invoiceId, ...rest } = h; await kvCommand(['HSET', HOURS, h.id, JSON.stringify(rest)]) } } }

  if (action === 'coachInvWithdraw') {
    if (!inv) return no(404, 'That invoice is gone.')
    if (!isAdmin && inv.coachId !== myCoachId) return no(403, 'Not your invoice.')
    if (!['submitted', 'queried'].includes(inv.status)) return no(400, 'Only a waiting or sent back invoice can be withdrawn.')
    await release()
    const next = { ...inv, status: 'withdrawn', withdrawnAt: new Date().toISOString() }
    await kvCommand(['HSET', KEY, inv.id, JSON.stringify(next)])
    await audit({ by: principal.email, action: 'coach-invoice.withdraw', target: inv.id })
    return ok({ invoice: view(next, config, isAdmin) })
  }

  if (action === 'coachInvDecide') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia approve invoices.')
    if (!inv) return no(404, 'That invoice is gone.')
    const status = ['approved', 'paid', 'queried'].includes(body.status) ? body.status : ''
    if (!status) return no(400, 'Approve, mark paid or send back.')
    if (status === 'queried' && !clean(body.note, 300)) return no(400, 'Say what needs checking.')
    // Sent back: the hours come free so the coach can fix them and invoice again.
    if (status === 'queried') await release()
    const next = { ...inv, status, decidedBy: principal.email, decidedAt: new Date().toISOString(), decisionNote: clean(body.note, 300), ...(status === 'paid' ? { paidAt: new Date().toISOString() } : {}) }
    await kvCommand(['HSET', KEY, inv.id, JSON.stringify(next)])
    await audit({ by: principal.email, action: `coach-invoice.${status}`, target: inv.id })
    return ok({ invoice: view(next, config, isAdmin) })
  }

  if (action === 'coachInvRate') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia set rates.')
    const coachId = clean(body.coachId, 30)
    if (!coachById(config, coachId)) return no(400, 'Choose the coach.')
    const cents = Math.round(Number(body.dollars) * 100)
    const rates = { ...(config.coachRates || {}) }
    if (cents > 0 && cents <= 100000) rates[coachId] = cents; else if (!body.dollars) delete rates[coachId]; else return no(400, 'An hourly rate from A$1 to A$1,000.')
    await saveConfig({ coachRates: rates })
    await audit({ by: principal.email, action: 'coach-invoice.rate', target: coachId })
    return ok({ rates })
  }
  return no(400, 'Unknown action.')
}
