// Credits come off by themselves (Lee, 20 Oct 2026: "if we have given them
// lets say $50 in credit ... it comes off").
//
// A credit is a make-up record of kind 'credit' (api/_jfp-makeups.js): made
// when a session is cancelled, or given by Lee or Ligia from Money. While it
// is owed, it comes off the next thing the family is asked to pay:
//   - a place's fee (a term link, a family invoice, a balance, sessions
//     billed from Money, a Pro added with sessions already had): the row's
//     fee comes down by the credit, so every open link follows it
//     (_jfp-fee-sync.js) and the family's account shows the lower amount;
//   - an auto charge after a session: the charge is smaller, or none.
// Never more than is owing: a credit bigger than the bill keeps the rest for
// next time. Nothing is refunded or paid out. Each use is on the row's notes,
// on the credit, and in the audit log.
import { kvCommand, clean, newId, audit, formatAud, dateLabel, sydneyToday, rowEmails } from './_jfp-store.js'
import { getTerm4Row, updateTerm4Rows, appendNote } from './_jfp-airtable.js'
import { listMakeups } from './_jfp-makeups.js'

const MK = 'jfp:makeups'
const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

// Owed credits with a value, oldest first.
export async function owedCredits() {
  const list = await listMakeups().catch(() => [])
  return list.filter((m) => m.kind === 'credit' && m.status === 'owed' && Number(m.cents) > 0).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}
export async function creditByRow() {
  const out = new Map()
  for (const m of await owedCredits()) out.set(m.rowId, (out.get(m.rowId) || 0) + Number(m.cents))
  return out
}

// One row at a time, so a credit is never used twice.
async function withRowLock(rowId, fn) {
  const key = `jfp:credit-lock:${rowId}`
  for (let i = 0; i < 20; i += 1) {
    if ((await kvCommand(['SET', key, '1', 'NX', 'EX', '30'])) === 'OK') {
      try { return await fn() } finally { await kvCommand(['DEL', key]).catch(() => {}) }
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

// Use up to maxCents of a row's owed credits. Returns the cents used.
// what: what it came off, for the credit's record ("Session on 22 Oct").
export async function useCredit(rowId, maxCents, { by = 'system', what = '' } = {}) {
  if (!(maxCents > 0)) return 0
  return (await withRowLock(rowId, () => useCreditNow(rowId, maxCents, { by, what }))) || 0
}
async function useCreditNow(rowId, maxCents, { by, what }) {
  const mine = (await owedCredits()).filter((m) => m.rowId === rowId)
  let left = maxCents, used = 0
  const now = new Date().toISOString()
  for (const m of mine) {
    if (left <= 0) break
    // Read it again: another use may have taken it a moment ago.
    const fresh = parse(await kvCommand(['HGET', MK, m.id]))
    if (!fresh || fresh.status !== 'owed' || !(Number(fresh.cents) > 0)) continue
    const take = Math.min(left, Number(fresh.cents))
    const rest = Number(fresh.cents) - take
    const uses = [...(fresh.uses || []), { cents: take, at: now, by, what: clean(what, 120) }]
    const next = rest > 0
      ? { ...fresh, cents: rest, uses }
      : { ...fresh, cents: 0, valueCents: fresh.valueCents || take + (fresh.uses || []).reduce((t, u) => t + u.cents, 0), status: 'applied', appliedAt: now, uses }
    await kvCommand(['HSET', MK, m.id, JSON.stringify(next)])
    await audit({ by, action: 'credit.use', target: m.id, after: { rowId, cents: take, left: rest, what: clean(what, 120) } })
    left -= take; used += take
  }
  return used
}

// Owed credits come off what these rows owe now (fee minus paid). Lowers the
// fee and puts the status right. Returns [{ rowId, cents }] for rows changed;
// the caller then lets open links follow (syncRowLinks).
export async function applyCredits(rowIds, { by = 'system', what = 'your next payment', limitCents = Infinity } = {}) {
  const have = await creditByRow()
  const out = []
  let room = limitCents
  for (const id of [...new Set(rowIds)].filter((x) => have.get(x) > 0)) {
    const r = await getTerm4Row(id)
    if (!r || r.feeAud == null) continue
    const fee = cents(r.feeAud), paid = cents(r.paidAud)
    const owing = Math.min(fee - paid, room)
    if (owing <= 0) continue
    const used = await useCredit(id, owing, { by, what })
    room -= used
    if (!used) continue
    const newFee = fee - used
    await updateTerm4Rows([{ id, fields: {
      'Term 4 Fee': newFee / 100,
      'Term 4 Payment Status': paid >= newFee ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid',
      'Term 4 Notes': appendNote(r.notes, `Credit ${formatAud(used)} used: comes off ${what} (fee ${formatAud(fee)} to ${formatAud(newFee)}).`),
    } }])
    out.push({ rowId: id, cents: used })
  }
  return out
}

// A link a credit was used on is cancelled and its fee put back as it was:
// the credit goes back to the family, owed again.
export async function returnCredits(q, { by = 'system', why = 'link cancelled' } = {}) {
  const used = (q?.creditUsed || []).filter((c) => c.cents > 0)
  for (const c of used) {
    const r = await getTerm4Row(c.rowId).catch(() => null)
    const m = { id: newId('MK'), rowId: c.rowId, player: r?.player || '', email: r ? rowEmails(r)[0] || '' : '', groupId: '', date: sydneyToday(), kind: 'credit', status: 'owed', reason: `Credit back: ${why}`, cents: c.cents, given: true, returnedFrom: q.id, createdBy: by, createdAt: new Date().toISOString(), expiresOn: '' }
    await kvCommand(['HSET', MK, m.id, JSON.stringify(m)])
    await audit({ by, action: 'credit.return', target: m.id, after: { rowId: c.rowId, cents: c.cents, payreq: q.id } })
  }
  return used.length
}

// Lee or Ligia give a credit by hand (Money > Credits).
export async function giveCredit({ principal, rowId, cents: amount, reason }) {
  const r = await getTerm4Row(clean(rowId, 30))
  if (!r) return { status: 404, error: 'Player not found.' }
  const c = Math.round(Number(amount))
  if (!(c >= 100 && c <= 200000)) return { status: 400, error: 'Enter the credit in dollars, from A$1.' }
  const why = clean(reason, 160)
  if (!why) return { status: 400, error: 'Say what the credit is for.' }
  const m = { id: newId('MK'), rowId: r.id, player: r.player, email: rowEmails(r)[0] || '', groupId: '', date: sydneyToday(), kind: 'credit', status: 'owed', reason: why, cents: c, given: true, createdBy: principal.email, createdAt: new Date().toISOString(), expiresOn: '' }
  await kvCommand(['HSET', MK, m.id, JSON.stringify(m)])
  await audit({ by: principal.email, action: 'credit.give', target: m.id, after: { rowId: r.id, player: r.player, cents: c, reason: why } })
  return { status: 200, credit: m }
}

// Money > Credits: every owed credit, and the ones used lately.
export async function creditsView() {
  const list = await listMakeups().catch(() => [])
  const credits = list.filter((m) => m.kind === 'credit' && m.status !== 'cancelled')
  const owed = credits.filter((m) => m.status === 'owed' && Number(m.cents) > 0)
  const unvalued = credits.filter((m) => m.status === 'owed' && !(Number(m.cents) > 0))
  const line = (m) => ({ id: m.id, rowId: m.rowId, player: m.player, cents: Number(m.cents) || 0, amountLabel: Number(m.cents) > 0 ? formatAud(Number(m.cents)) : 'No value set', reason: m.reason || '', dateLabel: m.date ? dateLabel(m.date) : '', given: Boolean(m.given), used: (m.uses || []).map((u) => ({ amountLabel: formatAud(u.cents), what: u.what, dateLabel: dateLabel(String(u.at).slice(0, 10)) })) })
  return {
    totalCents: owed.reduce((t, m) => t + Number(m.cents), 0),
    owed: owed.map(line).sort((a, b) => a.player.localeCompare(b.player)),
    unvalued: unvalued.map(line),
    used: credits.filter((m) => (m.uses || []).length).sort((a, b) => String(b.uses.at(-1).at).localeCompare(String(a.uses.at(-1).at))).slice(0, 20).map(line),
  }
}

