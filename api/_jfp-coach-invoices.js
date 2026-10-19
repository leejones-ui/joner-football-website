// Coach invoices (Lee, 19 Oct 2026: "so invoices match up, especially when
// coaches cover"; 20 Oct: "we pay hourly rates based on how many players they
// have! match to register 100%"). A coach makes an invoice for a period from
// the hours they logged (My hours, api/_jfp-hours.js), so the invoice and the
// hours are the same thing and nothing is typed twice. Each session line takes
// its players from the register (marked Present) and its price from the
// coach's own rate card (api/_jfp-coach-pay.js): the coach never types an
// amount or a player count. Each line is also checked against the cover
// records: a session someone else covered, a cover with no record, or a
// session two coaches both claimed is flagged for Lee and Ligia. An hours
// entry sits on one invoice only. Sent: emailed to Lee and Ligia with the PDF
// (laid out like the coaches' own invoices), due by Monday 9am.
//
// Private: a coach only ever sees their own invoices, lines and amounts.
// Hermes never sees any of it.
import { kvCommand, clean, newId, audit, dateLabel, coachById, coachLabel, formatAud, listGroups, locationFor, sydneyToday } from './_jfp-store.js'
import { allHours, HOUR_KINDS } from './_jfp-hours.js'
import { loadRoster } from './_jfp-airtable.js'
import { getCard, allCards, checkCard, saveCard, getDetails, saveDetails, registerFor, priceLine, isPathwayGroup, dueMonday, BAND_LABELS } from './_jfp-coach-pay.js'
import { coachInvoicePdf } from './_jfp-coach-invoice-pdf.js'
import { sendCoachInvoiceToStaff } from './_jfp-email.js'

const KEY = 'jfp:coach-invoices'
const HOURS = 'jfp:hours'
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const INVOICE_ACTIONS = new Set(['coachInvList', 'coachInvCreate', 'coachInvWithdraw', 'coachInvDecide', 'coachInvLineSet', 'coachInvPdf', 'coachPayCards', 'coachPayCardSave', 'coachPayDetails', 'coachPayDetailsSave'])
export const INV_STATUS = { submitted: 'Waiting', approved: 'Approved', paid: 'Paid', queried: 'Sent back', withdrawn: 'Withdrawn' }
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

async function allInvoices() {
  const raw = (await kvCommand(['HGETALL', KEY])) || []
  const out = []
  if (Array.isArray(raw)) { for (let i = 1; i < raw.length; i += 2) { const x = parse(raw[i]); if (x) out.push(x) } }
  else for (const v of Object.values(raw)) { const x = parse(v); if (x) out.push(x) }
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

const pendingOf = (inv) => inv.lines.filter((l) => l.cents == null).length
const totalOf = (lines) => lines.reduce((t, l) => t + (l.cents || 0), 0)

function view(inv, config, isAdmin) {
  const pending = pendingOf(inv)
  return {
    ...inv, coach: coachLabel(coachById(config, inv.coachId)), statusLabel: INV_STATUS[inv.status] || inv.status,
    amountLabel: `${formatAud(inv.amountCents || 0)}${pending ? ` + ${pending} TBC` : ''}`, pending,
    fromLabel: dateLabel(inv.from), toLabel: dateLabel(inv.to), dueLabel: inv.dueDate ? dateLabel(inv.dueDate) : '',
    flagCount: inv.lines.reduce((t, l) => t + l.flags.filter((f) => f.code !== 'waiting').length, 0),
    canWithdraw: !isAdmin && ['submitted', 'queried'].includes(inv.status),
  }
}

// What a session line says (Luke's way: "7on1: Reyansh, Antonio, ...").
function describe(l, group, present) {
  const names = present.map((p) => p.name).join(', ')
  if (['session', 'cover'].includes(l.kind) && group) {
    const what = group.label === 'Joners Juniors' ? 'Joners Juniors' : isPathwayGroup(group) ? 'Pathway class' : present.length ? `${present.length}on1` : 'Session'
    return `${l.kind === 'cover' ? 'Cover, ' : ''}${what}${names ? `: ${names}` : ''}`
  }
  if (l.kind === 'admin') return `Office hours${l.note ? `: ${l.note}` : ''}`
  return `${HOUR_KINDS[l.kind] || l.kind}${l.note ? `: ${l.note}` : ''}`
}

// The lines a coach would invoice for [from, to]: their hours not on another
// invoice, with the register's players and the price from their rate card.
async function linesFor(config, coachId, from, to, { listCovers }) {
  const [hours, covers, groups, roster, card] = await Promise.all([allHours(), listCovers(), listGroups(), loadRoster().catch(() => ({ players: [] })), getCard(coachId)])
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const names = new Map(roster.players.map((r) => [r.id, String(r.player || '').trim().split(/\s+/)[0] || 'Player']))
  const name = (id) => coachLabel(coachById(config, id))
  const mine = hours.filter((h) => h.coachId === coachId && h.date >= from && h.date <= to && !h.invoiceId).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  const out = []
  for (const h of mine) {
    const g = byId[h.groupId]
    const register = g ? await registerFor(g.id, h.date, (id) => names.get(id) || 'Player') : null
    const base = { hoursId: h.id, date: h.date, dateLabel: dateLabel(h.date), start: h.start, end: h.end, minutes: h.minutes, kind: h.kind, kindLabel: HOUR_KINDS[h.kind] || h.kind, groupId: h.groupId || '', note: h.note || '', what: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : h.note || '', location: g ? locationFor(config, g.location).name : '', status: h.status }
    const price = priceLine(base, { card, group: g, register })
    out.push({ ...base, description: describe(base, g, register?.present || []), players: price.players, cents: price.cents, basis: price.basis, flags: [...flagsFor(base, coachId, { covers, hours, name }), ...price.flags] })
  }
  return out
}

function biz(config) {
  const inv = config.invoice || {}
  const abn = String(inv.abn || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')
  return { abn, email: 'leejones@jonerfootball.com' }
}

async function pdfOf(inv, config) {
  const bytes = await coachInvoicePdf({ ...inv, coach: coachLabel(coachById(config, inv.coachId)) }, biz(config))
  return { name: `Invoice-${inv.number}.pdf`, content: Buffer.from(bytes).toString('base64') }
}

// Coach-filled details needed on every invoice.
const NEEDED = [['fullName', 'your full name'], ['accountName', 'the account name'], ['bsb', 'the BSB'], ['accountNumber', 'the account number']]

export async function invoiceAction(res, principal, config, body, action, { isAdmin, myCoachId, listCovers }) {
  const ok = (x) => res.status(200).json({ success: true, ...x })
  const no = (status, error) => res.status(status).json({ success: false, error })
  const today = sydneyToday()
  // Wages and invoices are for Lee, Ligia and each coach themselves. Never Hermes.
  if (principal?.via === 'hermes') return no(403, 'Coach pay is only for Lee, Ligia and each coach, in the portal.')

  // ---------- rate cards: Lee and Ligia only ----------
  if (action === 'coachPayCards') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia see rates.')
    return ok({ cards: await allCards(), coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })), bands: BAND_LABELS })
  }
  if (action === 'coachPayCardSave') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia set rates.')
    const coachId = clean(body.coachId, 30)
    if (!coachById(config, coachId)) return no(400, 'Choose the coach.')
    const card = checkCard(body.card || {})
    if (card.error) return no(400, card.error)
    return ok({ card: await saveCard(principal, coachId, card) })
  }

  // ---------- the coach's own invoice details ----------
  if (action === 'coachPayDetails') {
    const coachId = isAdmin && body.coachId ? clean(body.coachId, 30) : myCoachId
    if (!coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    return ok({ details: await getDetails(coachId) })
  }
  if (action === 'coachPayDetailsSave') {
    if (!myCoachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const out = await saveDetails(principal, myCoachId, body.details || {})
    return out.error ? no(400, out.error) : ok(out)
  }

  if (action === 'coachInvList') {
    const coachId = isAdmin ? clean(body.coachId, 30) : myCoachId
    if (!isAdmin && !coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const list = (await allInvoices()).filter((x) => !coachId || x.coachId === coachId)
    const from = ISO.test(body.from || '') ? body.from : ''
    const to = ISO.test(body.to || '') ? body.to : today
    const draft = !isAdmin && from ? await linesFor(config, coachId, from, to, { listCovers }) : null
    return ok({
      invoices: list.map((x) => view(x, config, isAdmin)), draft, dueLabel: dateLabel(dueMonday(today)),
      hasCard: !isAdmin && coachId ? Boolean(await getCard(coachId)) : undefined,
      details: !isAdmin && coachId ? await getDetails(coachId) : undefined,
      coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : undefined, status: INV_STATUS, admin: isAdmin,
    })
  }

  if (action === 'coachInvCreate') {
    const coachId = myCoachId
    if (!coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const from = clean(body.from, 10), to = clean(body.to, 10)
    if (!ISO.test(from) || !ISO.test(to) || to < from) return no(400, 'Choose the first and last day of the invoice.')
    if (to > today) return no(400, 'An invoice can only cover days already worked.')
    const details = await getDetails(coachId)
    const missing = NEEDED.filter(([k]) => !details[k]).map(([, l]) => l)
    if (missing.length) return no(400, `Add ${missing.join(', ')} in Your invoice details first.`)
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
    const inv = {
      id, number: `${coachId.toUpperCase()}-${String(seq).padStart(3, '0')}`, coachId, from, to, lines: claimed,
      totalMinutes: claimed.reduce((t, l) => t + l.minutes, 0), amountCents: totalOf(claimed),
      issueDate: today, dueDate: dueMonday(today), details, note: clean(body.note, 400),
      status: 'submitted', createdAt: new Date().toISOString(), by: principal.email,
    }
    await kvCommand(['HSET', KEY, id, JSON.stringify(inv)])
    for (const l of claimed) { const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h) await kvCommand(['HSET', HOURS, h.id, JSON.stringify({ ...h, invoiceId: id })]) }
    await audit({ by: principal.email, action: 'coach-invoice.create', target: id, after: { coachId, from, to, minutes: inv.totalMinutes, lines: claimed.length } })
    // To Lee and Ligia, with the PDF. A failed email never loses the invoice.
    let emailed = false
    try {
      const coach = coachLabel(coachById(config, coachId))
      const pending = pendingOf(inv), flagged = claimed.filter((l) => l.flags.some((f) => f.code !== 'waiting')).length
      await sendCoachInvoiceToStaff({
        subject: `Coach invoice ${inv.number} from ${details.fullName || coach}`, heading: `Invoice ${inv.number}`,
        paras: [`${details.fullName || coach} sent an invoice for ${dateLabel(from)} to ${dateLabel(to)}. Every session line is priced from the register and their rate card.`, ...(pending || flagged ? [`To check: ${[pending ? `${pending} line${pending > 1 ? 's' : ''} TBC` : '', flagged ? `${flagged} line${flagged > 1 ? 's' : ''} flagged` : ''].filter(Boolean).join(', ')}.`] : [])],
        list: [['Lines', String(claimed.length)], ['Total', `${formatAud(inv.amountCents)}${pending ? ' + TBC' : ''}`], ['Due', dateLabel(inv.dueDate)]],
        cta: { label: 'Open Coach invoices', url: 'https://jonerfootball.com/jfp-portal/#cinvoices' },
        attachment: await pdfOf(inv, config), replyTo: details.email || '',
      })
      emailed = true
    } catch (error) { console.error('jfp coach invoice email failed', inv.id, error.message) }
    return ok({ invoice: view(inv, config, isAdmin), emailed })
  }

  const inv = parse(await kvCommand(['HGET', KEY, clean(body.id, 40)]))
  const release = async () => { for (const l of inv.lines) { await kvCommand(['DEL', `jfp:hours-invoiced:${l.hoursId}`]); const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h?.invoiceId === inv.id) { const { invoiceId, ...rest } = h; await kvCommand(['HSET', HOURS, h.id, JSON.stringify(rest)]) } } }

  if (action === 'coachInvPdf') {
    if (!inv) return no(404, 'That invoice is gone.')
    if (!isAdmin && inv.coachId !== myCoachId) return no(403, 'Not your invoice.')
    const a = await pdfOf(inv, config)
    return ok({ filename: a.name, base64: a.content })
  }

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

  // Lee or Ligia set the amount on a TBC line (a camp, a Joners Juniors role, no agreed rate).
  if (action === 'coachInvLineSet') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia set amounts.')
    if (!inv) return no(404, 'That invoice is gone.')
    if (!['submitted', 'queried', 'approved'].includes(inv.status)) return no(400, 'That invoice is closed.')
    const i = Number(body.index)
    const l = inv.lines[i]
    if (!l) return no(400, 'Choose the line.')
    const cents = Math.round(Number(body.cents))
    if (!(cents >= 0 && cents <= 500000)) return no(400, 'Enter the amount in dollars.')
    const why = clean(body.note, 200)
    if (!why) return no(400, 'Say why (for example, the camp rate agreed).')
    const lines = inv.lines.map((x, j) => (j === i ? { ...x, cents, basis: `Set by Lee or Ligia: ${why}`, setBy: principal.email, flags: x.flags.filter((f) => ['covered', 'no-cover', 'double', 'waiting'].includes(f.code)) } : x))
    const next = { ...inv, lines, amountCents: totalOf(lines) }
    await kvCommand(['HSET', KEY, inv.id, JSON.stringify(next)])
    await audit({ by: principal.email, action: 'coach-invoice.line', target: inv.id, after: { index: i } })
    return ok({ invoice: view(next, config, isAdmin) })
  }

  if (action === 'coachInvDecide') {
    if (!isAdmin) return no(403, 'Only Lee or Ligia approve invoices.')
    if (!inv) return no(404, 'That invoice is gone.')
    const status = ['approved', 'paid', 'queried'].includes(body.status) ? body.status : ''
    if (!status) return no(400, 'Approve, mark paid or send back.')
    if (status === 'queried' && !clean(body.note, 300)) return no(400, 'Say what needs checking.')
    if (['approved', 'paid'].includes(status) && pendingOf(inv)) return no(400, 'Set the amount on each TBC line first.')
    // Sent back: the hours come free so the coach can fix them and invoice again.
    if (status === 'queried') await release()
    const next = { ...inv, status, decidedBy: principal.email, decidedAt: new Date().toISOString(), decisionNote: clean(body.note, 300), ...(status === 'paid' ? { paidAt: new Date().toISOString() } : {}) }
    await kvCommand(['HSET', KEY, inv.id, JSON.stringify(next)])
    await audit({ by: principal.email, action: `coach-invoice.${status}`, target: inv.id })
    return ok({ invoice: view(next, config, isAdmin) })
  }
  return no(400, 'Unknown action.')
}

// Monday 9am (Lee, 20 Oct 2026): invoices for last week are due. Sunday 6pm
// each coach with hours not on an invoice gets a reminder; Monday 9am Lee and
// Ligia get who has not sent one. Called hourly; each runs once a week.
export async function invoiceReminders(config, { nowMs = Date.now(), sendCoach, claimOnce }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]))
  const hour = Number(parts.hour), day = parts.weekday
  const today = sydneyToday(nowMs)
  const hours = await allHours()
  const open = (coachId) => hours.filter((h) => h.coachId === coachId && !h.invoiceId && h.date < today)
  const coaches = config.coaches.filter((c) => c.email && open(c.id).length)
  const out = { coaches: 0, staff: false }
  if (day === 'Sun' && hour === 18 && await claimOnce(`jfp:coach-inv-remind:${today}`, 8 * 86400)) {
    for (const c of coaches) {
      try {
        await sendCoach({ coach: c, subject: 'Your invoice is due Monday 9am', heading: 'Invoice due Monday 9am', paras: ['You have hours from this week that are not on an invoice yet. Open My invoices, check the lines, and press Send to Lee and Ligia before 9am Monday.'], cta: { label: 'Open My invoices', url: 'https://jonerfootball.com/jfp-portal/#cinvoices' }, kind: 'coach invoice reminder' })
        out.coaches += 1
      } catch (error) { console.error('jfp invoice reminder failed', c.id, error.message) }
    }
  }
  if (day === 'Mon' && hour === 9 && coaches.length && await claimOnce(`jfp:coach-inv-late:${today}`, 8 * 86400)) {
    await sendCoachInvoiceToStaff({ subject: 'Coach invoices not in by 9am', heading: 'Not in by 9am', paras: ['These coaches have hours not on an invoice yet:'], list: coaches.map((c) => [coachLabel(c), `${open(c.id).length} entr${open(c.id).length === 1 ? 'y' : 'ies'}`]), cta: { label: 'Open Coach invoices', url: 'https://jonerfootball.com/jfp-portal/#cinvoices' }, kind: 'coach invoice late' }).catch((error) => console.error('jfp invoice late email failed', error.message))
    out.staff = true
  }
  return out
}
