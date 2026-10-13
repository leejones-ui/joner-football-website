// Joners Juniors in the staff portal (Lee, 13 Oct 2026): Dashboard, Players,
// Money and Settings, the same way the JFP pages work. Lee and Ligia only:
// jfp-portal-data.js sends a jj* action here after its admin check. Coaches
// get only what JFP coaches get (the Juniors class on the Program, their
// sessions and registers), which jfp-portal-data.js already serves.
//
// Every change writes the term's Juniors table in Airtable (through
// _jj-data.js) and is recorded in the audit log. Cash and bank transfers go
// into the Juniors payment ledger (KV jj:ledger), never the JFP Payment
// Ledger, so Juniors money is never in JFP income.
import crypto from 'node:crypto'
import { saveConfig, audit, clean, validEmail, coachById, coachLabel, sydneyToday, ageOn, normName, kvCommand, formatAud, cleanPhone, rowEmails, dateLabel } from './_jfp-store.js'
import { loadRoster, waiverFor } from './_jfp-airtable.js'
import { readJJTable, getJJRow, writeJJRow, tableFor, termTables, isEnrolled, dobText, REC, plain, bustJJ } from './_jj-data.js'
import { validateJuniors, juniorsPublic, juniorsDates, capacityOf, classLabelOf, datesLabelOf, classForRow, classById, classLabelFor } from './_jj-config.js'
import { classesView, saveClasses, moveChild, syncTimetable } from './_jj-classes.js'
import { attendanceSummary } from './_jj-registers.js'
import { juniorsMoneyData, readJJLedger, saveJJLedger, dropJJLedger, JUNIORS_TABLES, METHODS } from './_jfp-juniors-money.js'
import { jfpStripePayments } from './_jfp-stripe.js'
import { siteUrl } from './_holiday-store.js'
import { KINDS, invitePlan, invitePreviews, sendInvites, readInvites } from './_jj-invites.js'
import { listJJRequests, getJJRequest, saveJJRequest, requestsView } from './_jj-requests.js'
import { listJJPayreqs, getJJPayreq, saveJJPayreq, cancelJJPayreq, repairJJPayreq, jjViews, jjPayreqUrl, jjNextStatuses, isOpen, JJ_PAY_EFFECTS } from './_jj-pay.js'
import { nextTermOf } from './_jj-config.js'

export const JJ_ACTIONS = new Set(['jjSettings', 'jjSaveSettings', 'jjPlayers', 'jjDashboard', 'jjAddPlayer', 'jjEditPlayer', 'jjAddNote', 'jjRemovePlayer', 'jjRestorePlayer', 'jjRecordPayment', 'jjVoidPayment',
  // Stage 2: Invites, Requests & waitlist, and the online payments behind them.
  'jjInvites', 'jjRequests', 'jjDecideRequest', 'jjPayments', 'jjRepairPayment', 'jjCancelPayreq', 'jjPaymentChecked',
  // Stage 3: Classes (and moving a child between them). Registers are in _jj-registers.js (coaches too).
  'jjClasses', 'jjSaveClasses', 'jjSyncClasses', 'jjMoveChild'])
export const JJ_LEAVE_REASONS = ['Cost', 'Time or schedule clash', 'Moved up to JFP', 'Not ready yet', 'Moved away', 'Taking a break', 'Joined another program', 'No reply from the family', 'Other']
const ISO = /^\d{4}-\d{2}-\d{2}$/
// Classes are saved on the Classes page (jjSaveClasses), which keeps the timetable in step.
const SETTINGS_KEYS = ['term', 'termStart', 'weeks', 'skipDates', 'datesLabel', 'classLabel', 'location', 'priceCents', 'siblingPriceCents', 'registrationOpen', 'waiverVersion', 'ageLabel', 'tables', 'nextTerm']
const out = (res, data) => res.status(200).json({ success: true, ...data })
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })

// Every Juniors table: the settings', plus any older one named in JFP_JUNIORS_TABLES.
export function jjTableList(config) {
  const list = termTables(config)
  for (const t of JUNIORS_TABLES) if (!list.some((x) => x.table === t)) list.push({ table: t, term: '' })
  return list
}

// The Juniors money figures (Stripe, the ledger, Airtable), for the term the
// settings say is running. Read only.
export async function jjMoneyData(config, { fresh = false, quick = false } = {}) {
  const j = await juniorsMoneyData({ fresh, quick }, {
    tables: jjTableList(config),
    jfpSessionIds: async () => { try { const x = await jfpStripePayments({ since: config.moneySince, term: config.term }); return [...x.payments, ...x.next].map((p) => p.id) } catch { return [] } },
  })
  const current = j.terms.includes(config.juniors.term) ? config.juniors.term : j.terms.includes(config.term) ? config.term : j.terms[0] || ''
  return { ...j, currentTerm: current }
}

// ---------- players ----------

// paid / part / unpaid / no price, from the money status.
const PAY = { paid: 'paid', stripe: 'paid', credit: 'paid', unverified: 'paid', part: 'part', unpaid: 'unpaid', refunded: 'unpaid', nofee: 'noprice', na: 'noprice' }
const PAY_DETAIL = { paid: 'Paid', stripe: 'Paid in Stripe, Airtable not updated', credit: 'Paid with last term\'s credit', unverified: 'Airtable says Paid, no payment found', part: 'Part paid', unpaid: 'Unpaid', refunded: 'Refunded', nofee: 'Fee not set', na: 'No fee (N/A)' }
function payFromAirtable(r) {
  if (/credit/i.test(r.paidVia)) return 'credit'
  if (/^n\/?a$/i.test(r.status)) return 'na'
  if (/^paid$/i.test(r.status)) return 'unverified'
  if (/partial/i.test(r.status)) return 'part'
  if (r.feeCents == null) return 'nofee'
  return 'unpaid'
}

function termOf(config, asked) {
  const jj = config.juniors
  return asked && jj.tables[asked] ? asked : jj.term
}

// One term's children with everything staff need, and the term's figures.
export async function jjOverview(config, { term = '', fresh = false } = {}) {
  const jj = config.juniors
  const t = termOf(config, term)
  const table = tableFor(config, t)
  const others = jjTableList(config).filter((x) => x.table !== table)
  const [rows, otherRows, roster, money] = await Promise.all([
    readJJTable(table, { term: t, fresh }),
    Promise.all(others.map((x) => readJJTable(x.table, { term: x.term }).catch(() => []))).then((l) => l.flat()),
    loadRoster().catch((error) => { console.error('jj roster read failed', error.message); return null }),
    jjMoneyData(config, { quick: !fresh }).catch((error) => ({ error: error.message })),
  ])
  const byRow = new Map((money.players || []).map((p) => [p.rowId, p]))
  const cls = jj.classes[0]
  const current = t === jj.term
  const players = rows.map((r) => {
    const m = byRow.get(r.id)
    const status = m?.status || payFromAirtable(r)
    // The date of birth: this row, the same child in another Juniors term, or their waiver.
    const elsewhere = otherRows.find((o) => o.dob && normName(o.player) === normName(r.player) && o.emails.some((e) => r.emails.includes(e)))
    const w = roster ? waiverFor(r.player, { emails: r.emails, phones: [r.mobile, r.mobile2], dob: r.dob || elsewhere?.dob || '' }, roster.waivers) : null
    const dob = r.dob || elsewhere?.dob || w?.dob || ''
    const jfpSiblings = roster ? [...new Set(roster.players.filter((p) => p.holdsPlace && rowEmails(p).some((e) => r.emails.includes(e))).map((p) => p.player))] : []
    return {
      rowId: r.id, term: r.term || t, name: r.player, dob, age: dob ? ageOn(dob, sydneyToday()) : null,
      parent: r.parent, email: r.email, emails: r.emails, mobile: r.mobile, mobile2: r.mobile2,
      medical: r.medical && !/^none( supplied)?$/i.test(r.medical) ? r.medical : '',
      notes: r.notes, className: r.className || classLabelOf(jj, cls), session: [r.day, r.time].filter(Boolean).join(' '), location: r.location, coach: r.coach,
      // The class this term (by day, time and place); '' = in none of them.
      classId: current ? classForRow(jj, r)?.id || '' : '',
      feeCents: r.feeCents, paidCents: m ? m.paidCents : null, owingCents: m ? m.owingCents : null,
      pay: PAY[status] || 'unpaid', payStatus: status, payLabel: PAY_DETAIL[status] || status, airtableStatus: r.status || 'Not set',
      paidVia: m?.paidVia || r.paidVia || '', paidAt: m?.paidAt || r.paidAt || '',
      payments: [...(m?.payments || []).map((x) => ({ kind: 'stripe', ref: x.ref, cents: x.cents, at: x.at })), ...(m?.recorded || []).map((x) => ({ kind: 'recorded', id: x.id, cents: x.cents, at: x.date, method: x.method }))],
      waiver: w ? { onFile: true, how: w.how, signedDate: w.signedDate || '', term: w.term || '' } : /^completed$/i.test(r.waiverStatus) ? { onFile: true, how: 'Marked Completed in Airtable', signedDate: '', term: '' } : { onFile: false, airtable: r.waiverStatus || '', unknown: !roster },
      removed: r.removed, jfpSiblings,
      source: r.registrationId ? 'Website sign-up' : r.addId ? 'Added in the portal' : 'Airtable',
      confirmation: r.confirmation, confirmationDate: r.confirmationDate,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const enrolled = players.filter((p) => !p.removed)
  const count = (k) => enrolled.filter((p) => p.pay === k).length
  const sum = (list, k) => list.reduce((x, p) => x + (p[k] || 0), 0)
  const mt = money.byTerm?.[t] || null
  const capacity = capacityOf(jj)
  // Each class with its own places (stage 3).
  const classes = jj.classes.map((c) => { const n = enrolled.filter((p) => p.classId === c.id).length; return { id: c.id, label: classLabelFor(jj, c), capacity: c.capacity, enrolled: n, placesLeft: Math.max(0, c.capacity - n) } })
  return {
    term: t, current, terms: termTables(config).map((x) => x.term), at: new Date().toISOString(),
    classLabel: jj.classes.length > 1 ? `${jj.classes.length} classes` : classLabelOf(jj, cls), datesLabel: current ? datesLabelOf(jj) : '', capacity,
    classes: current ? classes : [], unplaced: current && jj.classes.length > 1 ? enrolled.filter((p) => !p.classId).length : 0,
    players,
    counts: { all: enrolled.length, paid: count('paid'), part: count('part'), unpaid: count('unpaid'), noprice: count('noprice'), noWaiver: enrolled.filter((p) => !p.waiver.onFile).length, removed: players.length - enrolled.length },
    summary: {
      enrolled: enrolled.length, capacity, placesLeft: Math.max(0, capacity - enrolled.length),
      collectedCents: mt?.collectedCents ?? null, keptCents: mt?.keptCents ?? null, feesCents: mt?.feesCents ?? null, feesPending: mt?.feesPending ?? 0,
      owingCents: mt ? mt.owingCents : sum(enrolled.filter((p) => p.feeCents != null && p.pay !== 'paid' && p.pay !== 'noprice'), 'feeCents'),
      owingComplete: mt ? mt.owingComplete : false,
      stripeCents: mt?.stripeCents ?? null, cashCents: mt?.cashCents ?? null, bankCents: mt?.bankCents ?? null,
      unlinkedCount: mt?.unlinkedCount || 0, unlinkedCents: mt?.unlinkedCents || 0,
      paidInStripeOnly: enrolled.filter((p) => p.payStatus === 'stripe').length, unverified: enrolled.filter((p) => p.payStatus === 'unverified').length,
    },
    moneyError: money.error || (money.stale ? money.error || 'Money is not up to date.' : ''), moneyAt: money.at || '',
    waiversUnknown: !roster,
  }
}

// What needs Ligia today, most important first.
export function needsList(o, jj) {
  const s = o.summary, c = o.counts, list = []
  const add = (kind, label, extra = {}) => list.push({ kind, label, ...extra })
  if (o.moneyError) add('money', `Money could not be read: ${o.moneyError}`, { tab: 'jj-money' })
  if (c.unpaid) add('unpaid', `${c.unpaid} ${c.unpaid === 1 ? 'child has' : 'children have'} not paid${s.owingCents ? ` (${formatAud(s.owingCents)} owing)` : ''}`, { tab: 'jj-players', filter: 'unpaid', count: c.unpaid })
  if (c.part) add('part', `${c.part} part paid`, { tab: 'jj-players', filter: 'part', count: c.part })
  if (c.noWaiver && !o.waiversUnknown) add('waiver', `${c.noWaiver} without a waiver`, { tab: 'jj-players', filter: 'waiver', count: c.noWaiver })
  if (s.paidInStripeOnly) add('stripe', `${s.paidInStripeOnly} paid in Stripe, Airtable still says unpaid`, { tab: 'jj-players', filter: 'paid', count: s.paidInStripeOnly })
  if (s.unverified) add('unverified', `${s.unverified} marked Paid in Airtable with no payment found`, { tab: 'jj-money', count: s.unverified })
  if (s.unlinkedCount) add('unlinked', `${s.unlinkedCount} Stripe payment${s.unlinkedCount === 1 ? '' : 's'} not matched to a child (${formatAud(s.unlinkedCents)})`, { tab: 'jj-money', count: s.unlinkedCount })
  if (c.noprice) add('noprice', `${c.noprice} with no fee set`, { tab: 'jj-players', filter: 'noprice', count: c.noprice })
  const classes = o.classes?.length ? o.classes : [{ label: 'The class', capacity: s.capacity, enrolled: s.enrolled }]
  for (const k of o.current ? classes : []) if (k.capacity && k.enrolled >= k.capacity) add('full', `${classes.length > 1 ? k.label : 'The class'} is full (${k.enrolled} of ${k.capacity})`, { tab: 'jj-classes' })
  if (o.unplaced) add('unplaced', `${o.unplaced} ${o.unplaced === 1 ? 'child is' : 'children are'} in no class`, { tab: 'jj-classes', count: o.unplaced })
  if (o.attendance?.streaks?.length) add('missing', `${o.attendance.streaks.length} ${o.attendance.streaks.length === 1 ? 'child has' : 'children have'} missed 2 or more in a row`, { tab: 'jj-registers', count: o.attendance.streaks.length })
  if (o.current && !jj.registrationOpen) add('closed', 'Website registrations are closed', { tab: 'jj-settings' })
  if (o.waiting) add('waiting', `${o.waiting} on the waitlist${o.current && s.placesLeft ? `, and ${s.placesLeft} place${s.placesLeft === 1 ? ' is' : 's are'} free` : ''}`, { tab: 'jj-requests', count: o.waiting })
  if (o.payAttention) add('payments', `${o.payAttention} online payment${o.payAttention === 1 ? ' needs' : 's need'} checking`, { tab: 'jj-invites', count: o.payAttention })
  return list
}

// ---------- writes ----------

function rowsTerm(config, body) { const term = termOf(config, clean(body.term, 40)); return { term, table: tableFor(config, term) } }
async function rowOr404(res, table, rowId, term) {
  const row = REC.test(String(rowId || '')) ? await getJJRow(table, rowId, term) : null
  if (!row) { fail(res, 404, 'That child was not found in the Joners Juniors table. Refresh and try again.'); return null }
  return row
}
const dollars = (v) => (v === null || v === '' || v === undefined ? undefined : Number(v))

// Add a child to the current term's table. Used by Players (Add a child)
// and by Requests & waitlist (accept). Returns { ok, rowId, recorded } or
// { ok:false, status, error, code }.
export async function addChildCore(principal, config, body, { tag = '', source = 'in the JFP portal (Joners Juniors)' } = {}) {
  const no = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) })
  const jj = config.juniors
  const { term, table } = { term: jj.term, table: tableFor(config, jj.term) }
  const name = plain(body.player?.name, 80)
  if (name.length < 3) return no(400, "Enter the child's full name.")
  const email = body.parent?.email ? validEmail(body.parent.email) : ''
  if (body.parent?.email && !email) return no(400, 'That parent email does not look right.')
  const mobile = plain(body.parent?.mobile, 40)
  if (mobile && !cleanPhone(mobile)) return no(400, 'Check the mobile number. Use digits, like 0411 222 333.')
  const dob = ISO.test(body.player?.dob || '') ? body.player.dob : ''
  if (dob && (ageOn(dob, sydneyToday()) == null || dob > sydneyToday())) return no(400, 'Check the date of birth.')
  const payment = ['none', 'offline', 'free'].includes(body.payment) ? body.payment : 'none'
  const fee = payment === 'free' ? 0 : dollars(body.feeAud) ?? jj.priceCents / 100
  if (!Number.isFinite(fee) || fee < 0 || fee > 2000) return no(400, 'Enter the fee in dollars, for example 220.')
  if (payment === 'offline' && !(Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0)) return no(400, 'Enter the amount they paid.')
  const lock = `jj:add-lock:${table}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '15'])) !== 'OK') return no(409, 'Someone is adding a child right now. Try again in a moment.')
  let rowId
  try {
    const rows = await readJJTable(table, { term, fresh: true })
    const enrolled = rows.filter(isEnrolled)
    const dup = enrolled.find((r) => normName(r.player) === normName(name) && (!email || !r.emails.length || r.emails.includes(email)))
    if (dup && body.force !== true) return no(409, `${dup.player} is already in ${term}. Add anyway?`, 'duplicate')
    // The class asked for, else the first with a place, else the first.
    const inC = (c) => enrolled.filter((r) => classForRow(jj, r)?.id === c.id).length
    const cls = classById(jj, String(body.classId || '')) || jj.classes.find((c) => inC(c) < c.capacity) || jj.classes[0]
    if (cls && inC(cls) >= cls.capacity && body.force !== true) return no(409, `${jj.classes.length > 1 ? classLabelFor(jj, cls) : 'The class'} has ${inC(cls)} of ${cls.capacity} places taken. Add anyway?`, 'full')
    let waiverOn = false
    try { const roster = await loadRoster(); waiverOn = Boolean(waiverFor(name, { emails: email ? [email] : [], phones: [mobile], dob }, roster.waivers)) } catch {}
    const coach = coachById(config, cls?.coachId || '')
    const addId = `JJADD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    rowId = await writeJJRow(table, {
      set: {
        player: name, parent: plain(body.parent?.name, 100), ...(email ? { email } : {}), ...(mobile ? { mobile } : {}), ...(dob ? { dob: dobText(dob) } : {}),
        term, day: cls?.day, time: cls?.time, location: cls?.location, coach: coach?.airtableName || '', className: classLabelFor(jj, cls),
        fee, status: payment === 'free' ? 'N/A' : 'Unpaid', waiverStatus: waiverOn ? 'Completed' : 'Needed',
        ...(plain(body.player?.medical, 600) ? { medical: plain(body.player.medical, 600) } : {}),
      },
      note: `Added by ${principal.name} ${source}.${plain(body.note, 300) ? ` ${plain(body.note, 300)}` : ''} [JJ-ADD:${addId}]${tag ? ` ${tag}` : ''}`,
    })
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
  let recorded = null
  if (payment === 'offline') {
    const r = await recordCore(principal, config, { rowIds: [rowId], term, amountCents: Number(body.amountCents), method: body.method || 'Cash', date: body.date, note: 'Paid when added.', allowOver: true })
    recorded = r.ok ? { id: r.id } : { error: r.error }
  }
  await audit({ by: principal.email, action: 'jj.player.add', target: rowId, after: { name, term, payment, feeAud: fee, recorded: recorded?.id || '', ...(tag ? { tag } : {}) } })
  return { ok: true, rowId, recorded, term, table, name, email }
}

async function addPlayer(res, principal, config, body) {
  const r = await addChildCore(principal, config, body)
  return r.ok ? out(res, { rowId: r.rowId, recorded: r.recorded }) : fail(res, r.status, r.error, r.code ? { code: r.code } : {})
}

async function editPlayer(res, principal, config, body) {
  const { term, table } = rowsTerm(config, body)
  const row = await rowOr404(res, table, body.rowId, term); if (!row) return
  const f = body.fields || {}
  const set = {}, before = {}
  if ('name' in f) { const v = plain(f.name, 80); if (v.length < 3) return fail(res, 400, "Enter the child's full name."); set.player = v; before.name = row.player }
  if ('parent' in f) { set.parent = plain(f.parent, 100); before.parent = row.parent }
  for (const [k, key] of [['email', 'email'], ['email2', 'email2']]) {
    if (!(k in f)) continue
    const v = f[k] ? validEmail(f[k]) : ''
    if (f[k] && !v) return fail(res, 400, 'That email does not look right.')
    set[key] = v || null; before[k] = k === 'email' ? row.emails[0] || '' : row.emails[1] || ''
  }
  for (const k of ['mobile', 'mobile2']) {
    if (!(k in f)) continue
    const v = plain(f[k], 40)
    if (v && !cleanPhone(v)) return fail(res, 400, 'Check the mobile number. Use digits, like 0411 222 333.')
    set[k] = v || null; before[k] = row[k]
  }
  if ('dob' in f) {
    if (f.dob && (!ISO.test(f.dob) || ageOn(f.dob, sydneyToday()) == null)) return fail(res, 400, 'Check the date of birth.')
    set.dob = f.dob ? dobText(f.dob) : null; before.dob = row.dobText
  }
  if ('medical' in f) { set.medical = plain(f.medical, 600) || 'None supplied'; before.medical = row.medical }
  if ('feeAud' in f) {
    if (f.feeAud === null || f.feeAud === '') set.fee = null
    else { const v = Number(f.feeAud); if (!Number.isFinite(v) || v < 0 || v > 2000) return fail(res, 400, 'Enter the fee in dollars, for example 220.'); set.fee = Math.round(v * 100) / 100 }
    before.feeAud = row.feeCents == null ? null : row.feeCents / 100
  }
  if (!Object.keys(set).length) return fail(res, 400, 'Nothing to change.')
  await writeJJRow(table, { id: row.id, set })
  await audit({ by: principal.email, action: 'jj.player.edit', target: row.id, before, after: set })
  return out(res, {})
}

async function addNote(res, principal, config, body) {
  const { term, table } = rowsTerm(config, body)
  const row = await rowOr404(res, table, body.rowId, term); if (!row) return
  const text = plain(body.text, 500)
  if (!text) return fail(res, 400, 'Write the note first.')
  await writeJJRow(table, { id: row.id, note: `Note from ${principal.name}: ${text}` })
  await audit({ by: principal.email, action: 'jj.player.note', target: row.id, after: { text } })
  return out(res, {})
}

// Soft remove, like JFP's removed players: the row stays in Airtable with a
// note and the [JJ-REMOVED] tag, out of the class, the counts and the owing.
async function removePlayer(res, principal, config, body) {
  const { term, table } = rowsTerm(config, body)
  const row = await rowOr404(res, table, body.rowId, term); if (!row) return
  if (row.removed) return fail(res, 409, `${row.player} was already removed on ${row.removed.at}.`)
  const reason = JJ_LEAVE_REASONS.includes(body.reason) ? body.reason : ''
  if (!reason) return fail(res, 400, 'Choose why they are leaving.')
  const details = plain(body.details, 400)
  await writeJJRow(table, { id: row.id, note: `Removed by ${principal.name}: ${reason}${details ? `. ${details}` : ''}. [JJ-REMOVED:${sydneyToday()}]` })
  await audit({ by: principal.email, action: 'jj.player.remove', target: row.id, after: { name: row.player, term, reason, details } })
  return out(res, {})
}

async function restorePlayer(res, principal, config, body) {
  const { term, table } = rowsTerm(config, body)
  const row = await rowOr404(res, table, body.rowId, term); if (!row) return
  if (!row.removed) return fail(res, 409, `${row.player} is not removed.`)
  const jj = config.juniors
  const cls = classForRow(jj, row) || jj.classes[0]
  if (term === jj.term && cls && body.force !== true) {
    const enrolled = (await readJJTable(table, { term, fresh: true })).filter((r) => isEnrolled(r) && classForRow(jj, r)?.id === cls.id).length
    if (enrolled >= cls.capacity) return fail(res, 409, `${jj.classes.length > 1 ? classLabelFor(jj, cls) : 'The class'} has ${enrolled} of ${cls.capacity} places taken. Restore anyway?`, { code: 'full' })
  }
  await writeJJRow(table, { id: row.id, editNotes: (text) => text.replace(/\s*\[JJ-REMOVED:[^\]]*\]/g, ''), note: `Restored by ${principal.name}.` })
  await audit({ by: principal.email, action: 'jj.player.restore', target: row.id, after: { name: row.player, term } })
  return out(res, {})
}

// ---------- payments: cash, bank transfer, other ----------

const methodOf = (v) => METHODS.find((m) => m.toLowerCase() === String(v || '').trim().toLowerCase()) || { cash: 'Cash', bank: 'Bank transfer', 'bank transfer': 'Bank transfer', other: 'Other' }[String(v || '').trim().toLowerCase()] || ''
const viaWith = (prev, method) => [...new Set(String(prev || '').split(/\s*\+\s*/).filter(Boolean).concat(method))].join(' + ')

// One payment onto one or more children (siblings): a ledger entry, then each
// row's Payment Status, Paid Via and a note. The same guards as JFP: a real
// amount, not in the future, not more than is owing (a typo), never twice.
export async function recordCore(principal, config, body) {
  const no = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) })
  const { term, table } = rowsTerm(config, body)
  const ids = [...new Set((Array.isArray(body.rowIds) ? body.rowIds : [body.rowId]).map((x) => String(x || '')).filter((x) => REC.test(x)))].slice(0, 6)
  if (!ids.length) return no(400, 'Choose a child.')
  const method = methodOf(body.method)
  if (!method) return no(400, 'Choose cash, bank transfer or other.')
  const date = ISO.test(body.date || '') ? body.date : sydneyToday()
  if (date > sydneyToday()) return no(400, 'The payment date cannot be in the future.')
  const amount = Number(body.amountCents)
  if (!(Number.isInteger(amount) && amount > 0 && amount <= 2000000)) return no(400, 'Enter the amount received.')
  const rows = []
  for (const id of ids) { const r = await getJJRow(table, id, term); if (r) rows.push(r) }
  if (rows.length !== ids.length) return no(404, 'That child was not found in the Joners Juniors table. Refresh and try again.')
  // What each child still owes: Stripe and recorded payments (Juniors Money).
  let money = null
  try { money = await jjMoneyData(config, { quick: true }) } catch (error) { console.error('jj money read failed', error.message) }
  const ledger = money ? [] : await readJJLedger()
  const paidOf = (r) => {
    const m = money?.players.find((p) => p.rowId === r.id)
    if (m) return m.paidCents
    return ledger.filter((e) => !e.void).flatMap((e) => e.shares || []).filter((s) => s.rowId === r.id).reduce((t, s) => t + s.cents, 0)
  }
  const oweOf = (r) => (r.feeCents == null ? 0 : Math.max(0, r.feeCents - paidOf(r)))
  if (body.allowOver !== true && rows.every((r) => r.feeCents > 0)) {
    const owing = rows.reduce((t, r) => t + oweOf(r), 0)
    if (amount > owing) return no(400, owing ? `That is more than the ${formatAud(owing)} still owing. Enter the amount received, or change the fee first.` : 'Nothing is owing for this child. Change the fee first if they owe more.')
  }
  // A double tap, or two staff saving the same payment together.
  if ((await kvCommand(['SET', `jj:paylock:${ids.slice().sort().join(',')}:${amount}:${method}`, '1', 'NX', 'EX', '20'])) !== 'OK') return no(409, 'That payment was just recorded. Refresh to check before entering it again.')
  let left = amount
  const shares = rows.map((r, i) => {
    const owe = oweOf(r)
    const share = i === rows.length - 1 ? left : Math.min(left, owe || Math.floor(amount / rows.length))
    left -= share
    return { rowId: r.id, name: r.player, cents: share, r }
  }).filter((s) => s.cents > 0)
  const id = `JJ-${method === 'Cash' ? 'CASH' : method === 'Bank transfer' ? 'BANK' : 'OTHER'}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`
  const note = plain(body.note, 200)
  const entry = { id, term, table, method, date, cents: amount, shares: shares.map(({ rowId, name, cents }) => ({ rowId, name, cents })), by: principal.name, byEmail: principal.email, note, at: new Date().toISOString(), void: null }
  await saveJJLedger(entry)
  try {
    for (const s of shares) {
      const paid = paidOf(s.r) + s.cents
      const status = s.r.feeCents != null && paid >= s.r.feeCents ? 'Paid' : 'Partially Paid'
      await writeJJRow(table, { id: s.rowId, set: { status, paidVia: viaWith(/credit/i.test(s.r.paidVia) ? '' : s.r.paidVia, method), amountPaid: paid / 100 }, note: `Payment recorded: ${formatAud(s.cents)} by ${method} on ${date}, by ${principal.name}.${note ? ` ${note}` : ''} [JJ-PAY:${id}:${s.cents}]` })
    }
  } catch (error) {
    // The rows could not be written: the payment is not recorded at all.
    await dropJJLedger(id).catch(() => {})
    throw error
  }
  await bustJJ(table)
  await audit({ by: principal.email, action: 'jj.payment.record', target: ids.join(','), after: { id, names: shares.map((s) => s.name).join(', '), cents: amount, method, date, term } })
  return { ok: true, id }
}

async function voidPayment(res, principal, config, body) {
  const id = clean(body.id, 60)
  const entry = (await readJJLedger()).find((e) => e.id === id)
  if (!entry) return fail(res, 404, 'That payment was not found.')
  if (entry.void) return fail(res, 409, 'That payment was already taken off.')
  const reason = plain(body.reason, 200)
  if (!reason) return fail(res, 400, 'Say why it is being taken off (for example, typed twice).')
  await saveJJLedger({ ...entry, void: { at: new Date().toISOString(), by: principal.name, byEmail: principal.email, reason } })
  const table = entry.table || tableFor(config, entry.term)
  await bustJJ(table)
  // Each child's status from what is left.
  let money = null
  try { money = await jjMoneyData(config, {}) } catch (error) { console.error('jj money read failed', error.message) }
  for (const s of entry.shares || []) {
    const r = await getJJRow(table, s.rowId, entry.term)
    if (!r) continue
    const m = money?.players.find((p) => p.rowId === r.id)
    const paid = m ? m.paidCents : null
    const set = paid == null ? {} : { status: r.feeCents != null && paid >= r.feeCents && paid > 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid', amountPaid: paid / 100 }
    // Nothing paid any more: no "Paid via" either (last term's credit stays).
    if (paid === 0 && r.paidVia && !/credit/i.test(r.paidVia)) set.paidVia = null
    await writeJJRow(table, { id: r.id, set, note: `Payment ${id} (${formatAud(s.cents)} ${entry.method}) taken off by ${principal.name}: ${reason}. [JJ-VOID:${id}]` })
  }
  await audit({ by: principal.email, action: 'jj.payment.void', target: id, before: { cents: entry.cents, method: entry.method }, after: { reason } })
  return out(res, {})
}

// ---------- settings ----------

function settingsView(config) {
  const jj = config.juniors
  return {
    juniors: jj,
    derived: { dates: juniorsDates(jj).map((iso) => ({ iso, label: dateLabel(iso) })), datesLabel: datesLabelOf(jj), classLabel: classLabelOf(jj), capacity: capacityOf(jj), next: nextTermOf(jj), classes: jj.classes.map((c) => ({ id: c.id, label: classLabelFor(jj, c), capacity: c.capacity })) },
    public: juniorsPublic(jj),
    coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })),
  }
}

async function saveSettings(res, principal, config, body) {
  const input = body.juniors && typeof body.juniors === 'object' ? body.juniors : {}
  const patch = Object.fromEntries(SETTINGS_KEYS.filter((k) => k in input).map((k) => [k, input[k]]))
  if (!Object.keys(patch).length) return fail(res, 400, 'classes' in input ? 'Classes are changed on the Classes page.' : 'Nothing to change.')
  // Next term is changed field by field, so saving its name never drops its price or hold.
  if (patch.nextTerm && typeof patch.nextTerm === 'object') patch.nextTerm = { ...config.juniors.nextTerm, ...patch.nextTerm }
  const checked = validateJuniors(patch, config.juniors)
  if (!checked.ok) return fail(res, 400, checked.errors.join(' '))
  // Families already invited for next term under its name: the name stays.
  const oldNext = config.juniors.nextTerm.name
  if (checked.juniors.nextTerm.name !== oldNext && Object.keys(await jjNextStatuses(oldNext)).length) return fail(res, 409, `Families have already been invited for ${oldNext}, so its name cannot change now.`)
  const before = config.juniors
  const next = await saveConfig({ juniors: checked.juniors })
  await audit({ by: principal.email, action: 'jj.settings', target: 'config.juniors', before, after: next.juniors })
  // The class and the money read the term's table: start them afresh.
  await bustJJ(tableFor(next, next.juniors.term)).catch(() => {})
  return out(res, { ...settingsView(next), warnings: checked.warnings })
}

// ---------- invites ----------

async function invitesAction(req, res, principal, config, body) {
  const kind = KINDS.includes(body.kind) ? body.kind : 'new'
  const filter = ['unpaid', 'waiver', 'both'].includes(body.filter) ? body.filter : 'both'
  const site = siteUrl(req)
  const overview = await jjOverview(config, { fresh: body.send === true || body.fresh === true })
  const plan = await invitePlan(config, overview, kind, { site, filter })
  if (body.send !== true) return out(res, { ...plan, filter, previews: invitePreviews(plan, config, { site, email: body.previewEmail ? String(body.previewEmail).toLowerCase() : '' }) })
  const r = await sendInvites(plan, config, principal, { emails: Array.isArray(body.emails) ? body.emails : [], resend: body.resend === true, site, filter })
  if (r.error) return fail(res, r.status || 400, r.error)
  return out(res, r)
}

// ---------- requests and waitlist ----------

async function requestsData(config) {
  const [list, invites, rows] = await Promise.all([listJJRequests(), readInvites(), readJJTable(tableFor(config, config.juniors.term), { term: config.juniors.term }).catch(() => [])])
  const jj = config.juniors
  const live = rows.filter(isEnrolled)
  const enrolled = live.length
  const capacity = capacityOf(jj)
  // Free places: each class's own, added up (a class over its places frees none elsewhere).
  const classes = jj.classes.map((c) => { const n = live.filter((r) => classForRow(jj, r)?.id === c.id).length; return { id: c.id, label: classLabelFor(jj, c), capacity: c.capacity, enrolled: n, placesLeft: Math.max(0, c.capacity - n) } })
  const placesLeft = classes.reduce((t, c) => t + c.placesLeft, 0)
  return { ...requestsView(list, { rowsById: new Map(rows.map((r) => [r.id, r])), invites, placesLeft }), enrolled, capacity, classes, term: jj.term, registrationOpen: jj.registrationOpen }
}

async function decideRequest(res, principal, config, body) {
  const r = await getJJRequest(body.id)
  if (!r) return fail(res, 404, 'That request was not found.')
  const decision = ['accept', 'decline', 'wait'].includes(body.decision) ? body.decision : ''
  if (!decision) return fail(res, 400, 'Choose accept, decline or back to the waitlist.')
  const lock = `jj:request-lock:${r.id}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) !== 'OK') return fail(res, 409, 'Someone is deciding this request right now.')
  try {
    const now = new Date().toISOString()
    const step = (status, extra = {}) => ({ ...r, ...extra, status, decidedBy: principal.name, decidedAt: now, history: [...(r.history || []), { status, by: principal.name, at: now, ...(extra.declineReason ? { reason: extra.declineReason } : {}) }] })
    if (decision === 'accept') {
      if (r.status === 'accepted') return fail(res, 409, `${r.player.name} was already accepted.`)
      const added = await addChildCore(principal, config, { player: { name: r.player.name, dob: r.player.dob, medical: r.player.medical }, parent: r.parent, payment: 'none', classId: body.classId || r.classId || '', note: `From the waitlist (asked ${r.createdAt.slice(0, 10)}).`, force: body.force === true }, { tag: `[JJ-REQ:${r.id}]`, source: 'from Requests & waitlist' })
      if (!added.ok) return fail(res, added.status, added.code === 'full' ? `${added.error.replace(/ Add anyway\?$/, '')} Accept anyway?` : added.error, added.code ? { code: added.code } : {})
      await saveJJRequest(step('accepted', { rowId: added.rowId }))
      await audit({ by: principal.email, action: 'jj.request.accept', target: r.id, after: { rowId: added.rowId, name: r.player.name } })
      return out(res, { status: 'accepted', rowId: added.rowId, email: r.parent.email })
    }
    if (decision === 'decline') {
      if (r.status === 'declined') return fail(res, 409, 'That request was already declined.')
      if (r.status === 'accepted') return fail(res, 409, `${r.player.name} is already in the class. Remove them in Players instead.`)
      const reason = plain(body.reason, 200)
      await saveJJRequest(step('declined', { declineReason: reason }))
      await audit({ by: principal.email, action: 'jj.request.decline', target: r.id, after: { reason } })
      return out(res, { status: 'declined' })
    }
    if (r.status !== 'declined') return fail(res, 409, 'Only a declined request can go back on the waitlist.')
    await saveJJRequest(step('waiting', { declineReason: '' }))
    await audit({ by: principal.email, action: 'jj.request.wait', target: r.id })
    return out(res, { status: 'waiting' })
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

// ---------- online payments ----------

function effectsLine(q) {
  const e = q.effects || {}
  const failed = JJ_PAY_EFFECTS.filter((k) => e[k]?.status === 'failed'), unclear = JJ_PAY_EFFECTS.filter((k) => ['uncertain', 'running'].includes(e[k]?.status))
  return { failed, unclear, airtable: e.airtable?.status || '', error: e.airtable?.error || '' }
}
async function paymentsData(req) {
  const [list, views] = await Promise.all([listJJPayreqs(), jjViews()])
  const site = siteUrl(req)
  return list.slice(0, 300).map((q) => {
    const fx = effectsLine(q)
    return {
      id: q.id, kind: q.kind, reason: q.reason, status: q.status, email: q.email, parent: q.parentName, players: q.playerNames, term: q.next?.term || q.term,
      what: q.next ? (q.next.choice === 'hold' ? 'Hold for next term' : 'Next term in full') : 'This term',
      amountCents: q.amountCents, paidCents: q.paidCents ?? null, feeCents: q.stripeFeeCents ?? null,
      createdAt: q.createdAt, paidAt: q.paidAt || '', views: Number(views.views[q.id]) || 0, viewedAt: views.viewedAt[q.id] || '',
      url: isOpen(q) ? jjPayreqUrl(site, q) : '', attention: q.needsAttention || '', ...fx,
      needsCheck: q.status === 'paid' && (fx.failed.length > 0 || fx.airtable !== 'done' || Boolean(q.needsAttention)),
    }
  })
}

// ---------- router ----------

export async function jjAction(req, res, principal, config, body, action) {
  switch (action) {
    case 'jjSettings': return out(res, settingsView(config))
    case 'jjSaveSettings': return await saveSettings(res, principal, config, body)
    case 'jjPlayers': {
      const o = await jjOverview(config, { term: clean(body.term, 40), fresh: body.fresh === true })
      return out(res, { ...o, reasons: JJ_LEAVE_REASONS, methods: METHODS, priceCents: config.juniors.priceCents })
    }
    case 'jjDashboard': {
      const o = await jjOverview(config, { fresh: body.fresh === true })
      const [reqs, pays] = await Promise.all([listJJRequests().catch(() => []), listJJPayreqs().catch(() => [])])
      o.waiting = reqs.filter((r) => r.status === 'waiting').length
      o.payAttention = pays.filter((q) => q.status === 'paid' && (q.effects?.airtable?.status !== 'done' || q.needsAttention)).length
      // Attendance by class date and who missed two or more in a row (the registers).
      o.attendance = await attendanceSummary(config).catch((error) => ({ ready: false, error: `Attendance could not be read: ${error.message}` }))
      const { players, ...rest } = o
      return out(res, { ...rest, needs: needsList(o, config.juniors), registrationOpen: config.juniors.registrationOpen, public: juniorsPublic(config.juniors) })
    }
    case 'jjClasses': return out(res, await classesView(config, { fresh: body.fresh === true }))
    case 'jjSaveClasses': return await saveClasses(res, principal, config, body)
    // The timetable put back in step with the classes (nothing else changes).
    case 'jjSyncClasses': {
      const report = await syncTimetable(config, config.juniors, principal)
      await audit({ by: principal.email, action: 'jj.classes.sync', target: 'timetable', after: report })
      return out(res, { ...(await classesView(config)), timetableReport: report })
    }
    case 'jjMoveChild': return await moveChild(res, principal, config, body)
    case 'jjAddPlayer': return await addPlayer(res, principal, config, body)
    case 'jjEditPlayer': return await editPlayer(res, principal, config, body)
    case 'jjAddNote': return await addNote(res, principal, config, body)
    case 'jjRemovePlayer': return await removePlayer(res, principal, config, body)
    case 'jjRestorePlayer': return await restorePlayer(res, principal, config, body)
    case 'jjRecordPayment': {
      const r = await recordCore(principal, config, body)
      return r.ok ? out(res, { id: r.id }) : fail(res, r.status, r.error, r.code ? { code: r.code } : {})
    }
    case 'jjVoidPayment': return await voidPayment(res, principal, config, body)
    case 'jjInvites': return await invitesAction(req, res, principal, config, body)
    case 'jjRequests': return out(res, await requestsData(config))
    case 'jjDecideRequest': return await decideRequest(res, principal, config, body)
    case 'jjPayments': return out(res, { payments: await paymentsData(req) })
    case 'jjRepairPayment': {
      const r = await repairJJPayreq(clean(body.id, 60))
      if (!r.ok) return fail(res, r.reason === 'busy' ? 409 : 400, r.reason === 'busy' ? 'That payment is being finished right now. Try again in a minute.' : 'Only a paid payment can be tried again.')
      await audit({ by: principal.email, action: 'jj.payment.repair', target: r.payreq.id, after: effectsLine(r.payreq) })
      return out(res, { done: r.payreq.effects?.airtable?.status === 'done', ...effectsLine(r.payreq) })
    }
    // A person has looked at a flagged payment (paid twice, paid after it was
    // cancelled, overpaid) and sorted it in Stripe: the flag comes off, kept in the record.
    case 'jjPaymentChecked': {
      const q = await getJJPayreq(body.id)
      if (!q) return fail(res, 404, 'That payment was not found.')
      if (!q.needsAttention) return fail(res, 409, 'Nothing is flagged on that payment.')
      const note = plain(body.note, 200)
      await saveJJPayreq({ ...q, needsAttention: '', checked: [...(q.checked || []), { what: q.needsAttention, by: principal.name, at: new Date().toISOString(), note }] })
      await audit({ by: principal.email, action: 'jj.payment.checked', target: q.id, before: { attention: q.needsAttention }, after: { note } })
      return out(res, {})
    }
    case 'jjCancelPayreq': {
      const q = await getJJPayreq(body.id)
      if (!q) return fail(res, 404, 'That payment was not found.')
      if (!isOpen(q)) return fail(res, 409, `That payment is already ${q.status}.`)
      if (!(await cancelJJPayreq(q, principal.email, plain(body.reason, 200) || 'cancelled by staff'))) return fail(res, 409, 'The family is paying it on Stripe right now. Refresh in a minute.')
      await audit({ by: principal.email, action: 'jj.payreq.cancel', target: q.id, after: { cents: q.amountCents } })
      return out(res, {})
    }
    default: return fail(res, 400, `Unknown action: ${action}`)
  }
}
