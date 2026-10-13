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
import { validateJuniors, juniorsPublic, juniorsDates, capacityOf, classLabelOf, datesLabelOf } from './_jj-config.js'
import { juniorsMoneyData, readJJLedger, saveJJLedger, dropJJLedger, JUNIORS_TABLES, METHODS } from './_jfp-juniors-money.js'
import { jfpStripePayments } from './_jfp-stripe.js'

export const JJ_ACTIONS = new Set(['jjSettings', 'jjSaveSettings', 'jjPlayers', 'jjDashboard', 'jjAddPlayer', 'jjEditPlayer', 'jjAddNote', 'jjRemovePlayer', 'jjRestorePlayer', 'jjRecordPayment', 'jjVoidPayment'])
export const JJ_LEAVE_REASONS = ['Cost', 'Time or schedule clash', 'Moved up to JFP', 'Not ready yet', 'Moved away', 'Taking a break', 'Joined another program', 'No reply from the family', 'Other']
const ISO = /^\d{4}-\d{2}-\d{2}$/
const SETTINGS_KEYS = ['term', 'termStart', 'weeks', 'skipDates', 'datesLabel', 'classes', 'classLabel', 'location', 'priceCents', 'siblingPriceCents', 'registrationOpen', 'waiverVersion', 'ageLabel', 'tables', 'nextTerm']
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
  return {
    term: t, current: t === jj.term, terms: termTables(config).map((x) => x.term), at: new Date().toISOString(),
    classLabel: classLabelOf(jj, cls), datesLabel: t === jj.term ? datesLabelOf(jj) : '', capacity,
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
  if (o.current && s.capacity && s.enrolled >= s.capacity) add('full', `The class is full (${s.enrolled} of ${s.capacity})`, { tab: 'jj-settings' })
  if (o.current && !jj.registrationOpen) add('closed', 'Website registrations are closed', { tab: 'jj-settings' })
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

async function addPlayer(res, principal, config, body) {
  const jj = config.juniors
  const { term, table } = { term: jj.term, table: tableFor(config, jj.term) }
  const name = plain(body.player?.name, 80)
  if (name.length < 3) return fail(res, 400, "Enter the child's full name.")
  const email = body.parent?.email ? validEmail(body.parent.email) : ''
  if (body.parent?.email && !email) return fail(res, 400, 'That parent email does not look right.')
  const mobile = plain(body.parent?.mobile, 40)
  if (mobile && !cleanPhone(mobile)) return fail(res, 400, 'Check the mobile number. Use digits, like 0411 222 333.')
  const dob = ISO.test(body.player?.dob || '') ? body.player.dob : ''
  if (dob && (ageOn(dob, sydneyToday()) == null || dob > sydneyToday())) return fail(res, 400, 'Check the date of birth.')
  const payment = ['none', 'offline', 'free'].includes(body.payment) ? body.payment : 'none'
  const fee = payment === 'free' ? 0 : dollars(body.feeAud) ?? jj.priceCents / 100
  if (!Number.isFinite(fee) || fee < 0 || fee > 2000) return fail(res, 400, 'Enter the fee in dollars, for example 220.')
  if (payment === 'offline' && !(Number.isInteger(Number(body.amountCents)) && Number(body.amountCents) > 0)) return fail(res, 400, 'Enter the amount they paid.')
  const lock = `jj:add-lock:${table}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '15'])) !== 'OK') return fail(res, 409, 'Someone is adding a child right now. Try again in a moment.')
  let rowId
  try {
    const rows = await readJJTable(table, { term, fresh: true })
    const enrolled = rows.filter(isEnrolled)
    const dup = enrolled.find((r) => normName(r.player) === normName(name) && (!email || !r.emails.length || r.emails.includes(email)))
    if (dup && body.force !== true) return fail(res, 409, `${dup.player} is already in ${term}. Add anyway?`, { code: 'duplicate' })
    const cls = jj.classes[0]
    if (cls && enrolled.length >= cls.capacity && body.force !== true) return fail(res, 409, `The class has ${enrolled.length} of ${cls.capacity} places taken. Add anyway?`, { code: 'full' })
    let waiverOn = false
    try { const roster = await loadRoster(); waiverOn = Boolean(waiverFor(name, { emails: email ? [email] : [], phones: [mobile], dob }, roster.waivers)) } catch {}
    const coach = coachById(config, cls?.coachId || '')
    const addId = `JJADD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    rowId = await writeJJRow(table, {
      set: {
        player: name, parent: plain(body.parent?.name, 100), ...(email ? { email } : {}), ...(mobile ? { mobile } : {}), ...(dob ? { dob: dobText(dob) } : {}),
        term, day: cls?.day, time: cls?.time, location: cls?.location, coach: coach?.airtableName || '', className: classLabelOf(jj, cls),
        fee, status: payment === 'free' ? 'N/A' : 'Unpaid', waiverStatus: waiverOn ? 'Completed' : 'Needed',
        ...(plain(body.player?.medical, 600) ? { medical: plain(body.player.medical, 600) } : {}),
      },
      note: `Added by ${principal.name} in the JFP portal (Joners Juniors).${plain(body.note, 300) ? ` ${plain(body.note, 300)}` : ''} [JJ-ADD:${addId}]`,
    })
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
  let recorded = null
  if (payment === 'offline') {
    const r = await recordCore(principal, config, { rowIds: [rowId], term, amountCents: Number(body.amountCents), method: body.method || 'Cash', date: body.date, note: 'Paid when added.', allowOver: true })
    recorded = r.ok ? { id: r.id } : { error: r.error }
  }
  await audit({ by: principal.email, action: 'jj.player.add', target: rowId, after: { name, term, payment, feeAud: fee, recorded: recorded?.id || '' } })
  return out(res, { rowId, recorded })
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
  const cls = config.juniors.classes[0]
  if (term === config.juniors.term && cls && body.force !== true) {
    const enrolled = (await readJJTable(table, { term, fresh: true })).filter(isEnrolled).length
    if (enrolled >= cls.capacity) return fail(res, 409, `The class has ${enrolled} of ${cls.capacity} places taken. Restore anyway?`, { code: 'full' })
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
    derived: { dates: juniorsDates(jj).map((iso) => ({ iso, label: dateLabel(iso) })), datesLabel: datesLabelOf(jj), classLabel: classLabelOf(jj), capacity: capacityOf(jj) },
    public: juniorsPublic(jj),
    coaches: config.coaches.map((c) => ({ id: c.id, name: coachLabel(c) })),
  }
}

async function saveSettings(res, principal, config, body) {
  const input = body.juniors && typeof body.juniors === 'object' ? body.juniors : {}
  const patch = Object.fromEntries(SETTINGS_KEYS.filter((k) => k in input).map((k) => [k, input[k]]))
  if (!Object.keys(patch).length) return fail(res, 400, 'Nothing to change.')
  if (Array.isArray(patch.classes)) {
    const bad = patch.classes.find((c) => c?.coachId && !coachById(config, c.coachId))
    if (bad) return fail(res, 400, 'Choose a coach from the list.')
  }
  const checked = validateJuniors(patch, config.juniors)
  if (!checked.ok) return fail(res, 400, checked.errors.join(' '))
  const before = config.juniors
  const next = await saveConfig({ juniors: checked.juniors })
  await audit({ by: principal.email, action: 'jj.settings', target: 'config.juniors', before, after: next.juniors })
  // The class and the money read the term's table: start them afresh.
  await bustJJ(tableFor(next, next.juniors.term)).catch(() => {})
  return out(res, { ...settingsView(next), warnings: checked.warnings })
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
      const { players, ...rest } = o
      return out(res, { ...rest, needs: needsList(o, config.juniors), registrationOpen: config.juniors.registrationOpen, public: juniorsPublic(config.juniors), attendance: { ready: false, note: 'Attendance by week arrives with Registers.' } })
    }
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
    default: return fail(res, 400, `Unknown action: ${action}`)
  }
}
