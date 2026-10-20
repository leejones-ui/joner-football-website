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
// Fully editable (Lee, 20 Oct 2026: "the invoice needs to be fully editable
// as well please!"): before sending, a coach can change any line (what, where,
// hours, amount), take a line off or add one. After, Lee and Ligia can change
// or add any line. Every change keeps what the portal worked out, so a
// changed amount shows as "Changed: worked out A$X" for Lee and Ligia.
//
// Fees not paid (Lee, 20 Oct 2026: "if a player still hasnt paid either that
// needs flagging! ... we need to be ruthless here and message the player /
// parent for the fees immediately. we will do this internally"): a line whose
// players include one with fees not paid is flagged for Lee and Ligia with who
// to chase. The coach never sees a family's payments.
//
// Private: a coach only ever sees their own invoices, lines and amounts.
// Hermes never sees any of it.
import { isSessionType, kvCommand, clean, newId, audit, dateLabel, coachById, coachLabel, formatAud, listGroups, locationFor, sydneyToday } from './_jfp-store.js'
import { allHours, HOUR_KINDS, shortNames } from './_jfp-hours.js'
import { loadRoster } from './_jfp-airtable.js'
import { getCard, allCards, checkCard, saveCard, getDetails, saveDetails, registerFor, priceLine, isPathwayGroup, dueMonday, BAND_LABELS } from './_jfp-coach-pay.js'
const fmtMoney = (c) => `A$${(c / 100).toFixed(2)}`
import { coachInvoicePdf } from './_jfp-coach-invoice-pdf.js'
import { sendCoachInvoiceToStaff } from './_jfp-email.js'

const KEY = 'jfp:coach-invoices'
const HOURS = 'jfp:hours'
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const INVOICE_ACTIONS = new Set(['coachInvList', 'coachInvCreate', 'coachInvWithdraw', 'coachInvDecide', 'coachInvLineSet', 'coachInvLineAdd', 'coachInvLineRemove', 'coachInvPdf', 'coachPayCards', 'coachPayCardSave', 'coachPayDetails', 'coachPayDetailsSave'])
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

// Pure: one line with someone's changes. edit: { description, location, minutes, cents, date } (any of them).
// Keeps what the portal worked out (calcCents), and flags a changed amount for Lee and Ligia.
export function editLine(line, edit, { by, role }) {
  const next = { ...line }
  const changed = []
  const text = (k, n) => { if (edit[k] == null) return; const v = clean(edit[k], n); if (v !== (line[k] || '')) { next[k] = v; changed.push(k) } }
  text('description', 300); text('location', 80)
  if (edit.minutes != null && edit.minutes !== '') { const m = Math.round(Number(edit.minutes)); if (!(m > 0 && m <= 720)) return { error: 'Hours must be more than 0 and no more than 12.' }; if (m !== line.minutes) { next.minutes = m; changed.push('minutes') } }
  if (edit.date != null && edit.date !== '') { if (!ISO.test(edit.date)) return { error: 'That date is not right.' }; if (edit.date !== line.date) { next.date = edit.date; next.dateLabel = dateLabel(edit.date); changed.push('date') } }
  if (Object.hasOwn(edit, 'cents')) {
    const c = edit.cents === '' || edit.cents == null ? null : Math.round(Number(edit.cents))
    if (c != null && !(c >= 0 && c <= 500000)) return { error: 'That amount is not right.' }
    if (c !== line.cents) { next.cents = c; changed.push('cents') }
  }
  if (!changed.length) return next
  const calc = Object.hasOwn(line, 'calcCents') ? line.calcCents : line.cents
  next.calcCents = calc
  next.edits = [...(line.edits || []), { by, role, at: new Date().toISOString(), fields: changed }]
  let flags = (line.flags || []).filter((f) => f.code !== 'edited')
  if (next.cents !== calc && next.cents != null) {
    flags = flags.filter((f) => !['no-card', 'no-rate', 'camp', 'jj-role', 'register', 'no-players', 'no-group'].includes(f.code))
    flags.push({ code: 'edited', text: `Amount changed by ${role === 'coach' ? 'the coach' : 'Lee or Ligia'}${calc == null ? ' (was TBC)' : `: worked out ${fmtMoney(calc)}`}` })
  } else if (changed.some((k) => k !== 'cents')) flags.push({ code: 'edited', text: `Changed by ${role === 'coach' ? 'the coach' : 'Lee or Ligia'}: ${changed.filter((k) => k !== 'cents').join(', ')}` })
  next.flags = flags
  return next
}

// Pure: a line someone added by hand.
export function newLine(body, { by, role, from, to }) {
  const date = clean(body.date, 10)
  if (!ISO.test(date) || (from && date < from) || (to && date > to)) return { error: 'Choose a date inside the invoice dates.' }
  const description = clean(body.description, 300)
  if (!description) return { error: 'Say what the line is for.' }
  const minutes = Math.round(Number(body.minutes || 0))
  if (!(minutes >= 0 && minutes <= 720)) return { error: 'Hours must be no more than 12.' }
  const cents = body.cents === '' || body.cents == null ? null : Math.round(Number(body.cents))
  if (cents != null && !(cents >= 0 && cents <= 500000)) return { error: 'That amount is not right.' }
  return { hoursId: '', date, dateLabel: dateLabel(date), start: '', end: '', minutes, kind: 'other', kindLabel: 'Added', groupId: '', note: '', what: '', location: clean(body.location, 80), status: 'approved', description, players: null, cents, calcCents: null, basis: `Added by ${role === 'coach' ? 'the coach' : 'Lee or Ligia'}`, flags: [{ code: 'added', text: `Line added by ${role === 'coach' ? 'the coach' : 'Lee or Ligia'}` }], edits: [{ by, role, at: new Date().toISOString(), fields: ['added'] }] }
}

// Fees not paid. A term fee: Unpaid, Partly paid or not set, or a balance
// still owing. Session by session, Pro sessions or an agency's players: they
// are billed after the sessions, so "Unpaid" with nothing billed is normal;
// flagged only when a billed amount is still owing.
export const feesOwed = (r) => isSessionType(r.paymentType)
  ? Number(r.balanceAud || 0) > 0
  : /^(unpaid|partially paid|not set)$/i.test(String(r.paymentStatus || 'Not set')) || Number(r.balanceAud || 0) > 0
// What a coach may see of a line: never a family's payments.
const forCoach = (l) => { const { unpaid, ...rest } = l; return { ...rest, flags: (l.flags || []).filter((f) => f.code !== 'unpaid') } }

const pendingOf = (inv) => inv.lines.filter((l) => l.cents == null).length
const totalOf = (lines) => lines.reduce((t, l) => t + (l.cents || 0), 0)
const withTotals = (inv, lines) => ({ ...inv, lines, amountCents: totalOf(lines), totalMinutes: lines.reduce((t, l) => t + (l.minutes || 0), 0) })

function view(inv, config, isAdmin) {
  const pending = pendingOf(inv)
  return {
    ...inv, lines: isAdmin ? inv.lines : inv.lines.map(forCoach), unpaidCount: isAdmin ? inv.lines.reduce((t, l) => t + (l.unpaid?.length || 0), 0) : 0, coach: coachLabel(coachById(config, inv.coachId)), statusLabel: INV_STATUS[inv.status] || inv.status,
    amountLabel: `${formatAud(inv.amountCents || 0)}${pending ? ` + ${pending} TBC` : ''}`, pending,
    fromLabel: dateLabel(inv.from), toLabel: dateLabel(inv.to), dueLabel: inv.dueDate ? dateLabel(inv.dueDate) : '',
    flagCount: inv.lines.reduce((t, l) => t + l.flags.filter((f) => f.code !== 'waiting' && (isAdmin || f.code !== 'unpaid')).length, 0),
    canWithdraw: !isAdmin && ['submitted', 'queried'].includes(inv.status),
  }
}

// What a session line says (the way coaches already write it: "7on1: first names"). who:
// the players ticked in My hours, or else the register (Present, then paid
// upfront but away).
function describe(l, group, who) {
  const names = who.map((p) => (p.mark ? `${p.name} (paid, away)` : p.name)).join(', ')
  if (['session', 'cover'].includes(l.kind) && group) {
    const what = group.label === 'Joners Juniors' ? 'Joners Juniors' : isPathwayGroup(group) ? 'Pathway class' : who.length ? `${who.length}on1` : 'Session'
    return `${l.kind === 'cover' ? 'Cover, ' : ''}${what}${names ? `: ${names}` : ''}`
  }
  if (l.kind === 'admin') return `Office hours${l.note ? `: ${l.note}` : ''}`
  return `${HOUR_KINDS[l.kind] || l.kind}${names ? `: ${names}` : ''}${l.note ? `${names ? '. ' : ': '}${l.note}` : ''}`
}

// The lines a coach would invoice for [from, to]: their hours not on another
// invoice, with the register's players and the price from their rate card.
async function linesFor(config, coachId, from, to, { listCovers }) {
  const [hours, covers, groups, roster, card] = await Promise.all([allHours(), listCovers(), listGroups(), loadRoster().catch(() => ({ players: [] })), getCard(coachId)])
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]))
  const short = shortNames(roster.players)
  const rows = new Map(roster.players.map((r) => [r.id, { name: short.get(r.id), full: String(r.player || '').trim(), paymentType: r.paymentType, paymentStatus: r.paymentStatus, balanceAud: r.balanceAud }]))
  const name = (id) => coachLabel(coachById(config, id))
  const mine = hours.filter((h) => h.coachId === coachId && h.date >= from && h.date <= to && !h.invoiceId).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  const out = []
  for (const h of mine) {
    const g = byId[h.groupId]
    const register = g ? await registerFor(g.id, h.date, (id) => rows.get(id) || null) : null
    const picked = Array.isArray(h.players) && h.players.length ? h.players : null
    const base = { players: picked, hoursId: h.id, date: h.date, dateLabel: dateLabel(h.date), start: h.start, end: h.end, minutes: h.minutes, kind: h.kind, kindLabel: HOUR_KINDS[h.kind] || h.kind, groupId: h.groupId || '', note: h.note || '', what: g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : h.note || '', location: g ? locationFor(config, g.location).name : '', status: h.status }
    const price = priceLine(base, { card, group: g, register })
    const who = (picked || register?.counted || []).filter((p) => p.rowId)
    const unpaid = who.map((p) => ({ p, r: rows.get(p.rowId) })).filter(({ r }) => r && feesOwed(r)).map(({ p, r }) => ({ rowId: p.rowId, name: r.full || p.name, status: r.paymentStatus || 'Not set', owedCents: Math.max(0, Math.round(Number(r.balanceAud || 0) * 100)) }))
    if (unpaid.length) price.flags = [...price.flags, { code: 'unpaid', text: `Fees not paid: ${unpaid.map((u) => u.name.split(' ')[0]).join(', ')}. Chase the family` }]
    out.push({ ...base, unpaid, description: describe(base, g, picked || register?.counted || []), playerNames: (picked || register?.counted || []).map((p) => p.name), players: price.players, calcCents: price.cents, cents: price.cents, basis: price.basis, flags: [...flagsFor(base, coachId, { covers, hours, name }), ...price.flags] })
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
    const groups = (await listGroups()).map((g) => ({ id: g.id, coachId: g.coachId, label: `${g.day} ${g.time}, ${locationFor(config, g.location).name}${g.label ? ` (${g.label})` : ''}` }))
    return ok({ cards: await allCards(), coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })), bands: BAND_LABELS, groups })
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
    // Lee's own invoice (he is a coach too): body.mine shows the coach view of his own.
    const asCoach = !isAdmin || Boolean(body.mine)
    const coachId = asCoach ? myCoachId : clean(body.coachId, 30)
    if (asCoach && !coachId) return no(403, 'Your login is not linked to a coach yet. Ask Lee.')
    const list = (await allInvoices()).filter((x) => !coachId || x.coachId === coachId)
    const from = ISO.test(body.from || '') ? body.from : ''
    const to = ISO.test(body.to || '') ? body.to : today
    const draft = asCoach && from ? (await linesFor(config, coachId, from, to, { listCovers })).map((l) => (isAdmin ? l : forCoach(l))) : null
    return ok({
      invoices: list.map((x) => ({ ...view(x, config, isAdmin), canWithdraw: asCoach && ['submitted', 'queried'].includes(x.status) })), draft, dueLabel: dateLabel(dueMonday(today)),
      hasCard: asCoach && coachId ? Boolean(await getCard(coachId)) : undefined,
      details: asCoach && coachId ? await getDetails(coachId) : undefined,
      coaches: isAdmin ? config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })) : undefined, status: INV_STATUS, admin: isAdmin && !asCoach, myCoachId: isAdmin ? myCoachId : undefined,
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
    const worked = await linesFor(config, coachId, from, to, { listCovers })
    // The coach's changes: { hoursId, remove, description, location, minutes, cents } per line, plus added lines.
    const edits = new Map((Array.isArray(body.lines) ? body.lines : []).slice(0, 200).map((e) => [clean(e?.hoursId, 40), e || {}]))
    const lines = []
    for (const l of worked) {
      const e = edits.get(l.hoursId)
      if (e?.remove) continue
      const x = e ? editLine(l, e, { by: principal.email, role: 'coach' }) : l
      if (x.error) return no(400, x.error)
      lines.push(x)
    }
    for (const a of (Array.isArray(body.added) ? body.added : []).slice(0, 30)) {
      const x = newLine(a || {}, { by: principal.email, role: 'coach', from, to })
      if (x.error) return no(400, x.error)
      lines.push(x)
    }
    if (!lines.length) return no(400, 'No hours to invoice in those dates. Log them in My hours first.')
    // Claim each hours entry for this invoice, so it can never be on two.
    const id = newId('CINV')
    const claimed = []
    for (const l of lines) {
      if (!l.hoursId) { claimed.push(l); continue }
      const got = await kvCommand(['SET', `jfp:hours-invoiced:${l.hoursId}`, id, 'NX'])
      if (got === 'OK') claimed.push(l)
    }
    if (!claimed.some((l) => l.hoursId) && lines.some((l) => l.hoursId)) return no(409, 'Those hours are already on an invoice.')
    const seq = Number(await kvCommand(['HINCRBY', 'jfp:coach-invoice-seq', coachId, '1']))
    const inv = {
      id, number: `${coachId.toUpperCase()}-${String(seq).padStart(3, '0')}`, coachId, from, to, lines: claimed,
      totalMinutes: claimed.reduce((t, l) => t + l.minutes, 0), amountCents: totalOf(claimed),
      issueDate: today, dueDate: dueMonday(today), details, note: clean(body.note, 400),
      status: 'submitted', createdAt: new Date().toISOString(), by: principal.email,
    }
    await kvCommand(['HSET', KEY, id, JSON.stringify(inv)])
    for (const l of claimed.filter((x) => x.hoursId)) { const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h) await kvCommand(['HSET', HOURS, h.id, JSON.stringify({ ...h, invoiceId: id })]) }
    await audit({ by: principal.email, action: 'coach-invoice.create', target: id, after: { coachId, from, to, minutes: inv.totalMinutes, lines: claimed.length } })
    // To Lee and Ligia, with the PDF. A failed email never loses the invoice.
    let emailed = false
    try {
      const coach = coachLabel(coachById(config, coachId))
      const pending = pendingOf(inv), flagged = claimed.filter((l) => l.flags.some((f) => f.code !== 'waiting')).length
      const chase = [...new Map(claimed.flatMap((l) => l.unpaid || []).map((u) => [u.rowId, u])).values()]
      await sendCoachInvoiceToStaff({
        subject: `Coach invoice ${inv.number} from ${details.fullName || coach}`, heading: `Invoice ${inv.number}`,
        paras: [`${details.fullName || coach} sent an invoice for ${dateLabel(from)} to ${dateLabel(to)}. Every session line is priced from the register and their rate card.`, ...(pending || flagged ? [`To check: ${[pending ? `${pending} line${pending > 1 ? 's' : ''} TBC` : '', flagged ? `${flagged} line${flagged > 1 ? 's' : ''} flagged` : ''].filter(Boolean).join(', ')}.`] : [])],
        list: [['Lines', String(claimed.length)], ...(chase.length ? [['Fees not paid, chase', chase.map((u) => u.name).join(', ')]] : []), ['Total', `${formatAud(inv.amountCents)}${pending ? ' + TBC' : ''}`], ['Due', dateLabel(inv.dueDate)]],
        cta: { label: 'Open Coach invoices', url: 'https://jonerfootball.com/jfp-portal/#cinvoices' },
        attachment: await pdfOf(inv, config), replyTo: details.email || '',
      })
      emailed = true
    } catch (error) { console.error('jfp coach invoice email failed', inv.id, error.message) }
    return ok({ invoice: view(inv, config, isAdmin), emailed })
  }

  const inv = parse(await kvCommand(['HGET', KEY, clean(body.id, 40)]))
  const releaseLine = async (l) => { if (!l.hoursId) return; await kvCommand(['DEL', `jfp:hours-invoiced:${l.hoursId}`]); const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h?.invoiceId === inv.id) { const { invoiceId, ...rest } = h; await kvCommand(['HSET', HOURS, h.id, JSON.stringify(rest)]) } }
  const release = async () => { for (const l of inv.lines.filter((x) => x.hoursId)) { await kvCommand(['DEL', `jfp:hours-invoiced:${l.hoursId}`]); const h = parse(await kvCommand(['HGET', HOURS, l.hoursId])); if (h?.invoiceId === inv.id) { const { invoiceId, ...rest } = h; await kvCommand(['HSET', HOURS, h.id, JSON.stringify(rest)]) } } }

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

  // Lee or Ligia change any line, add one or take one off (the hours come free).
  if (['coachInvLineSet', 'coachInvLineAdd', 'coachInvLineRemove'].includes(action)) {
    if (!isAdmin) return no(403, 'Only Lee or Ligia change a sent invoice. Withdraw it to change it yourself.')
    if (!inv) return no(404, 'That invoice is gone.')
    if (!['submitted', 'queried', 'approved'].includes(inv.status)) return no(400, 'That invoice is closed.')
    let lines = inv.lines
    const i = Number(body.index)
    if (action === 'coachInvLineAdd') {
      const x = newLine(body.line || {}, { by: principal.email, role: 'admin', from: inv.from, to: inv.to })
      if (x.error) return no(400, x.error)
      lines = [...lines, x].sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)))
    } else {
      const l = lines[i]
      if (!l || !Number.isInteger(i)) return no(400, 'Choose the line.')
      if (action === 'coachInvLineRemove') {
        if (lines.length === 1) return no(400, 'That is the only line. Send the invoice back instead.')
        await releaseLine(l)
        lines = lines.filter((_, j) => j !== i)
      } else {
        const x = editLine(l, { ...(body.line || {}), ...(Object.hasOwn(body, 'cents') ? { cents: body.cents } : {}) }, { by: principal.email, role: 'admin' })
        if (x.error) return no(400, x.error)
        const why = clean(body.note, 200)
        lines = lines.map((y, j) => (j === i ? { ...x, ...(why ? { basis: `Set by Lee or Ligia: ${why}`, setBy: principal.email } : {}) } : y))
      }
    }
    const next = withTotals(inv, lines)
    await kvCommand(['HSET', KEY, inv.id, JSON.stringify(next)])
    await audit({ by: principal.email, action: `coach-invoice.${action === 'coachInvLineAdd' ? 'line-add' : action === 'coachInvLineRemove' ? 'line-remove' : 'line'}`, target: inv.id, after: { index: Number.isInteger(i) ? i : null } })
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
