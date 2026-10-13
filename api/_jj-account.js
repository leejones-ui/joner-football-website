// Joners Juniors in the family account (stage 2): the same sign-in as JFP
// (Lee, 13 Oct 2026: one family login shows JFP and Juniors children
// together, pays both, one waiver).
//
// A Juniors child belongs to the signed-in family when the row carries one of
// the family's emails (the parent email, a second parent's, or one the JFP
// rows give). A family with no Juniors child gets null and sees exactly what
// they saw before.
import { siteUrl } from './_holiday-store.js'
import { formatAud, dateLabel, ageOn, normName, kvCommand, audit, clean } from './_jfp-store.js'
import { waiverFor } from './_jfp-airtable.js'
import { readJJRows, isEnrolled, tableFor, writeJJRow, tagValues } from './_jj-data.js'
import { juniorsDates, classLabelOf, datesLabelOf, nextTermOf, termShort } from './_jj-config.js'
import { listJJPayreqs, isOpen, noteJJView, jjNextStatuses, setJJNextStatus, createNextPayreq, ensureTermPayreq, cancelJJPayreq, startJJCheckout, getJJPayreq, JJPAY } from './_jj-pay.js'
import { jjMoneyData } from './_jj-portal.js'

const PAID = (r) => /^paid$/i.test(r.status) || /^n\/?a$/i.test(r.status) || /credit/i.test(r.paidVia)
// What the row's notes say was recorded in cash or bank, less anything taken off.
function recordedCents(notes) {
  const voided = new Set(tagValues(notes, 'JJ-VOID'))
  return tagValues(notes, 'JJ-PAY').map((v) => v.split(':')).filter(([id]) => !voided.has(id)).reduce((t, [, c]) => t + (Number(c) || 0), 0)
}

// The family's Juniors children, rows and emails. null when none (or when
// the Juniors table cannot be read: a JFP family is never shown an error).
export async function familyJJ(config, parentEmail, fam) {
  let rows
  try { rows = await readJJRows(config) } catch (error) { console.error('jj family rows failed', error.message); return null }
  const mine = new Set([parentEmail, ...(fam?.emails || [])].filter(Boolean))
  const kids = rows.filter((r) => isEnrolled(r) && r.emails.some((e) => mine.has(e)))
  if (!kids.length) return null
  return { rows: kids, emails: [...new Set([...mine, ...kids.flatMap((r) => r.emails)])] }
}

const ownsJJ = (q, emails) => Boolean(q) && emails.includes(String(q.email || '').toLowerCase())

function waiverOf(r, emails, roster) {
  const w = roster ? waiverFor(r.player, { emails, phones: [r.mobile, r.mobile2], dob: r.dob }, roster.waivers) : null
  if (w) return { onFile: true, signedDate: w.signedDate || '', dob: w.dob || '' }
  if (/^completed$/i.test(r.waiverStatus)) return { onFile: true, signedDate: '', dob: '' }
  return { onFile: false }
}

// What the account page shows. pay: the ?pay= id the family opened, if any.
export async function jjAccountView({ config, parentEmail, fam, roster, pay = '' }) {
  const f = await familyJJ(config, parentEmail, fam)
  if (!f) return null
  const jj = config.juniors
  const cls = jj.classes[0]
  const nowIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const dates = juniorsDates(jj)
  const nt = nextTermOf(jj)
  const [payreqs, statuses] = await Promise.all([listJJPayreqs(), nt.name ? jjNextStatuses(nt.name) : Promise.resolve({})])
  const mine = payreqs.filter((q) => ownsJJ(q, f.emails) && q.status !== 'cancelled')
  const opened = mine.find((q) => q.id === clean(pay, 60) && isOpen(q))
  if (opened) await noteJJView(opened.id)
  const children = f.rows.map((r) => {
    const w = waiverOf(r, f.emails, roster)
    const dob = r.dob || w.dob || ''
    const open = mine.find((q) => isOpen(q) && q.kind === 'term' && q.rowIds.includes(r.id))
    let payment
    if (open) payment = { state: 'due', label: `${formatAud(open.amountCents)} to pay`, payreqId: open.id }
    else if (PAID(r)) payment = { state: 'paid', label: /^n\/?a$/i.test(r.status) ? 'No fee' : 'Paid' }
    // Unpaid with nothing recorded: the family can pay the fee themselves
    // (checked against Juniors Money when they press Pay).
    else if (r.feeCents > 0 && !recordedCents(r.notes) && !r.paidRequests.length && !/partial/i.test(r.status)) payment = { state: 'owing', label: `${formatAud(r.feeCents)} to pay`, canPay: true }
    else if (r.feeCents > 0) payment = { state: 'part', label: 'Part paid', canPay: true }
    else payment = { state: 'arranged', label: 'Payment arranged with Joner Football' }
    const st = statuses[r.id]
    const showNext = Boolean(nt.name && nt.table && (nt.open || st))
    const nextOpen = st?.payreqId ? mine.find((q) => q.id === st.payreqId && isOpen(q)) : null
    return {
      key: `jj:${r.id}`, rowId: r.id, name: r.player, age: dob ? ageOn(dob, jj.termStart) : null, needsDob: !dob,
      waiver: { onFile: w.onFile, signedDate: w.signedDate || '' },
      className: classLabelOf(jj, cls), location: jj.location, term: jj.term,
      dates: dates.map(dateLabel), firstDate: dates[0] ? dateLabel(dates[0]) : '', nextDate: dates.find((d) => d >= nowIso) ? dateLabel(dates.find((d) => d >= nowIso)) : '',
      payment,
      next: showNext ? {
        status: st?.status || 'invited', fullLabel: formatAud(nt.fullCents), holdLabel: nt.holdCents ? formatAud(nt.holdCents) : '',
        afterHoldLabel: st?.status === 'held' ? formatAud(Math.max(0, nt.fullCents - (st.paidCents || 0))) : '', openPayreqId: nextOpen?.id || '',
      } : null,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const kidsByRow = new Map(children.map((c) => [c.rowId, c]))
  const todo = mine.filter(isOpen).map((q) => {
    const ids = q.next ? [q.next.fromRowId] : q.rowIds
    return {
      id: q.id, juniors: true, amountLabel: formatAud(q.amountCents), players: q.playerNames,
      what: q.next ? `${q.next.term}: ${q.next.choice === 'hold' ? 'hold the place' : q.next.holdPaidCents ? 'the rest of the term' : 'the full term'}` : `${termShort(q.term)}: ${classLabelOf(jj, cls)}`,
      needsWaiver: ids.some((id) => kidsByRow.get(id) && !kidsByRow.get(id).waiver.onFile),
      places: q.kind === 'term' && q.rows.length > 1 ? q.rows.map((x) => ({ name: x.name, amountLabel: formatAud(x.owingCents) })) : [],
    }
  })
  return {
    parentName: f.rows.find((r) => r.parent)?.parent || '',
    term: jj.term, termShort: termShort(jj.term), classLabel: classLabelOf(jj, cls), datesLabel: datesLabelOf(jj), location: jj.location, ageLabel: jj.ageLabel,
    waiverVersion: jj.waiverVersion,
    children, todo,
    nextTerm: children.some((c) => c.next) ? { name: nt.name, holdLabel: nt.holdCents ? formatAud(nt.holdCents) : '', fullLabel: formatAud(nt.fullCents) } : null,
    paid: mine.filter((q) => q.status === 'paid').map((q) => ({ id: q.id, amountLabel: formatAud(q.paidCents ?? q.amountCents), players: q.playerNames, paidAt: q.paidAt, what: q.next ? q.next.term : q.term })),
  }
}

const no = (status, error, code) => ({ ok: false, status, error, ...(code ? { code } : {}) })

// Pay a Juniors payment request (Stripe Checkout). The waiver comes first, as JFP.
export async function jjPay(req, { config, parent, fam, roster, body }) {
  const q = await getJJPayreq(body.payreqId)
  const f = await familyJJ(config, parent.email, fam)
  if (!q || !f || !ownsJJ(q, f.emails)) return no(404, 'We could not find that payment.')
  const ids = q.next ? [q.next.fromRowId] : q.rowIds
  const kids = f.rows.filter((r) => ids.includes(r.id))
  if (kids.some((r) => !waiverOf(r, f.emails, roster).onFile)) return no(400, 'Sign the waiver for each child first.', 'waiver')
  return startJJCheckout(q, siteUrl(req))
}

// "Pay" on a child with no payment request yet: what is owing comes from
// Juniors Money (Stripe, cash and bank), never a guess, so a family who
// already paid on a payment link is not charged twice.
export async function jjRequestPay(req, { config, parent, fam, body }) {
  const f = await familyJJ(config, parent.email, fam)
  if (!f) return no(404, 'We could not find that child on your account.')
  const want = new Set((Array.isArray(body.rowIds) ? body.rowIds : []).map((x) => clean(x, 30)))
  const kids = f.rows.filter((r) => want.has(r.id))
  if (!kids.length) return no(404, 'We could not find that child on your account.')
  let money
  try { money = await jjMoneyData(config, { quick: true }) } catch (error) { console.error('jj family money failed', error.message); return no(503, 'We could not check your payments just now. Try again in a minute.') }
  if (money.stale) return no(503, 'We could not check your payments just now. Try again in a minute.')
  const byRow = new Map(money.players.map((p) => [p.rowId, p]))
  const rows = kids.map((r) => ({ rowId: r.id, name: r.player, owingCents: byRow.get(r.id)?.owingCents })).filter((x) => x.owingCents > 0)
  if (!rows.length) return no(409, 'This is already paid. Thank you. Your account updates within a few minutes.', 'paid')
  const amountCents = rows.reduce((t, x) => t + x.owingCents, 0)
  const r = await ensureTermPayreq({ by: parent.email, email: parent.email, parentName: kids[0].parent, rows, amountCents, term: config.juniors.term, table: tableFor(config, config.juniors.term), reason: 'family', site: siteUrl(req) })
  if (r.busy) return no(409, 'A payment is already on its way. Refresh in a minute.', 'processing')
  if (!r.reused) await audit({ by: parent.email, action: 'jj.payreq.family', target: r.payreq.id, after: { rows: rows.map((x) => x.rowId), cents: amountCents } })
  return { ok: true, payreqId: r.payreq.id }
}

// Next term: hold the place, pay in full, or not returning.
export async function jjNextChoice(req, { config, parent, fam, body }) {
  const nt = nextTermOf(config.juniors)
  const choice = ['hold', 'full', 'no'].includes(body.choice) ? body.choice : ''
  if (!choice) return no(400, 'Choose hold, pay in full or not returning.')
  const f = await familyJJ(config, parent.email, fam)
  const row = f?.rows.find((r) => r.id === clean(body.rowId, 30))
  if (!row) return no(404, 'We could not find that child on your account.')
  if (!nt.name || !nt.table) return no(403, `${nt.name || 'Next term'} places are not open yet.`)
  const lock = `jj:next-choice-lock:${row.id}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) !== 'OK') return no(409, 'Just a moment, that is still being saved.')
  try {
    const statuses = await jjNextStatuses(nt.name)
    const st = statuses[row.id]
    if (!nt.open && !st) return no(403, `${nt.name} places are not open yet.`)
    if (st?.status === 'paid') return no(409, `${row.player} is already paid for ${nt.name}.`)
    if (st?.status === 'held' && choice !== 'full') return no(409, `${row.player}'s place is already held.`)
    if (choice === 'hold' && !nt.holdCents) return no(400, `There is no hold for ${nt.name}. Pay in full, or tell us they are not returning.`)
    const existing = st?.payreqId ? await getJJPayreq(st.payreqId) : null
    if (existing && isOpen(existing)) {
      if (choice !== 'no' && existing.next?.choice === choice) return { ok: true, payreqId: existing.id }
      if (!(await cancelJJPayreq(existing, parent.email, 'family changed their choice'))) return no(409, 'A payment is already on its way. Refresh in a minute.')
    }
    if (choice === 'no') {
      await setJJNextStatus(nt.name, row.id, { ...(st || {}), status: 'no', payreqId: '', note: clean(body.note, 300) })
      await audit({ by: parent.email, action: 'jj.next.no', target: row.id, after: { term: nt.name, name: row.player } })
      return { ok: true, status: 'no' }
    }
    const q = await createNextPayreq({ config, row, choice, st, email: parent.email, parentName: row.parent, site: siteUrl(req) })
    await setJJNextStatus(nt.name, row.id, { ...(st || {}), status: st?.status === 'held' ? 'held' : 'invited', payreqId: q.id, paidCents: st?.paidCents || 0 })
    await audit({ by: parent.email, action: `jj.next.${choice}`, target: row.id, after: { payreq: q.id, term: nt.name } })
    return { ok: true, payreqId: q.id }
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

// The waiver for Juniors children ("jj:<row id>" keys): the one family
// waiver, in the JFP waiver table, marked Programme: Joners Juniors with the
// Juniors waiver version. Returns Airtable fields, or { error }.
export function jjWaiverRows({ config, list, f, roster, parent, parentName, mobile, signature, acceptedAt, media, waiverFields, phoneOk }) {
  const jj = config.juniors
  const out = [], rowIds = []
  for (const x of list) {
    const r = f.rows.find((k) => `jj:${k.id}` === clean(x.key, 40))
    if (!r) return { error: 'We could not find that child on your account.', status: 404 }
    if (waiverOf(r, f.emails, roster).onFile) continue
    const dob = r.dob || clean(x.dob, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || ageOn(dob, jj.termStart) == null) return { error: `Enter ${r.player}'s date of birth.`, status: 400 }
    const emergencyName = clean(x.emergencyName, 100), emergencyPhone = clean(x.emergencyPhone, 40)
    if (emergencyName.length < 2 || !phoneOk(emergencyPhone)) return { error: `Add an emergency contact for ${r.player}.`, status: 400 }
    const fields = waiverFields({
      player: { name: r.player, dob, club: clean(x.club, 120), medical: clean(x.medical, 500) || (r.medical && !/^none( supplied)?$/i.test(r.medical) ? r.medical : ''), emergencyName, emergencyPhone },
      parent: { name: parentName, email: parent.email, mobile }, config: { ...config, term: jj.term, waiverVersion: jj.waiverVersion }, signature, acceptedAt, media,
    })
    fields.Programme = 'Joners Juniors'
    fields['JFP Program Waiver and Agreement'] = `Joner Football waiver and agreement accepted online for Joners Juniors ${jj.term} (${jj.waiverVersion}). Signed by ${signature} at ${acceptedAt}.`
    out.push(fields); rowIds.push(r.id)
  }
  return { rows: out, rowIds }
}

// After the waiver is saved: Ligia's "Waiver Status" on the Juniors row says Completed.
export async function markJJWaivers(config, rowIds, by) {
  const table = tableFor(config, config.juniors.term)
  for (const id of rowIds) {
    try { await writeJJRow(table, { id, set: { waiverStatus: 'Completed' }, note: `Waiver signed online in the family account by ${by}.` }) } catch (error) { console.error('jj waiver status failed', id, error.message) }
  }
}

export { normName, JJPAY }
