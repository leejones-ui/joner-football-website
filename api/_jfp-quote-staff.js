// Pro session quotes, the staff side (Lee, 14 Oct 2026). Only Lee and Ligia
// (the portal's admins) reach these: a player's quote and commitment in Edit
// player, saving a quote, and the default Pro quote on Money > Prices.
// Every change is written to the row's notes and the audit log.
//
//   playerQuote      { rowId } -> quote, commitment, prepaid, default quote
//   saveQuote        { rowId, perCents, tiers: [{ n, cents }] }   (tiers [] = no commitments)
//   saveDefaultQuote { quote: { perCents, tiers } | null }
import { getTerm4Row, updateTerm4Rows } from './_jfp-airtable.js'
import { audit, saveConfig, listPayreqs, withPerSession, isSessionType, sydneyToday, dateLabel, formatAud, clean } from './_jfp-store.js'
import { quoteTiersOf, withQuote, cleanQuote, cleanDefaultQuote, commitmentOf } from './_jfp-quote.js'

const ok = (body) => ({ status: 200, body: { success: true, ...body } })
const no = (status, error) => ({ status, body: { success: false, error } })
const REC = /^rec[A-Za-z0-9]{14}$/

export function quoteView(row, config, today = sydneyToday()) {
  const tiers = quoteTiersOf(row.notes)
  const c = commitmentOf(row.notes, today)
  return {
    rowId: row.id,
    sessionPay: isSessionType(row.paymentType),
    quote: { perCents: row.perSessionCents || null, tiers },
    quoted: tiers.length > 0,
    prepaidSessions: row.prepaidSessions || 0,
    commitment: c ? { ...c, dates: c.dates.map((iso) => ({ iso, label: dateLabel(iso), done: iso <= today })) } : null,
    defaultQuote: config.proQuote || null,
  }
}

export async function playerQuote(config, body) {
  const id = clean(body.rowId, 30)
  const row = REC.test(id) ? await getTerm4Row(id) : null
  if (!row) return no(404, 'Player row not found in Airtable.')
  // The commitment link they paid (when, how much), for staff to see.
  const paid = (await listPayreqs()).filter((q) => q.status === 'paid' && q.prepay?.commit && q.prepay.rowId === row.id)
    .map((q) => ({ id: q.id, sessions: q.prepay.sessions, perCents: q.prepay.perCents, amountLabel: formatAud(q.paidCents ?? q.amountCents), paidAt: q.paidAt || '', dates: q.prepay.dates || [] }))
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
  return ok({ ...quoteView(row, config), commitments: paid })
}

export async function saveQuote(principal, config, body) {
  const id = clean(body.rowId, 30)
  const row = REC.test(id) ? await getTerm4Row(id) : null
  if (!row) return no(404, 'Player row not found in Airtable.')
  const before = { perCents: row.perSessionCents || null, tiers: quoteTiersOf(row.notes) }
  // No options: the quote's commitments come off (the price per session stays).
  if (!(Array.isArray(body.tiers) && body.tiers.length)) {
    if (!before.tiers.length) return ok({ ...quoteView(row, config), unchanged: true })
    const notes = withQuote(row.notes, [])
    await updateTerm4Rows([{ id: row.id, fields: { 'Term 4 Notes': notes } }])
    await audit({ by: principal.email, action: 'player.quote', target: row.id, before, after: { perCents: before.perCents, tiers: [] } })
    return ok(quoteView({ ...row, notes }, config))
  }
  if (!isSessionType(row.paymentType)) return no(400, 'A quote is for Pro sessions and session by session players. Set the payment type first.')
  const r = cleanQuote({ perCents: body.perCents, tiers: body.tiers })
  if (!r.ok) return no(400, r.error)
  if (before.perCents === r.perCents && JSON.stringify(before.tiers) === JSON.stringify(r.tiers)) return ok({ ...quoteView(row, config), unchanged: true })
  const notes = withQuote(withPerSession(row.notes, r.perCents), r.tiers)
  await updateTerm4Rows([{ id: row.id, fields: { 'Term 4 Notes': notes } }])
  await audit({ by: principal.email, action: 'player.quote', target: row.id, before, after: { perCents: r.perCents, tiers: r.tiers } })
  // Open links keep the amount they were made for; staff are told.
  const open = (await listPayreqs()).filter((q) => ['open', 'checkout'].includes(q.status) && (q.term4Ids || []).includes(row.id))
  return ok({ ...quoteView({ ...row, notes, perSessionCents: r.perCents }, config), openLinks: open.map((q) => ({ id: q.id, amountCents: q.amountCents })) })
}

export async function saveDefaultQuote(principal, config, body) {
  const input = body.quote
  let next = null
  if (input) {
    const r = cleanQuote(input)
    if (!r.ok) return no(400, r.error)
    next = cleanDefaultQuote({ perCents: r.perCents, tiers: r.tiers, updatedAt: new Date().toISOString() })
  }
  const saved = await saveConfig({ proQuote: next })
  await audit({ by: principal.email, action: 'price.proQuote', target: 'config', before: config.proQuote || null, after: saved.proQuote })
  return ok({ defaultQuote: saved.proQuote })
}

// Add a player: the quote staff typed (or the default) goes on the new row's
// notes. { notes } or { error }. Nothing typed: the notes as they were.
export function addQuote(notes, input, { perSession, sessionPay }) {
  if (!input || !sessionPay) return { notes }
  const tiers = Array.isArray(input.tiers) ? input.tiers : []
  if (!tiers.length) return { notes }
  if (!perSession) return { error: 'Enter the price per session for the quote.' }
  const r = cleanQuote({ perCents: perSession, tiers })
  if (!r.ok) return { error: r.error }
  return { notes: withQuote(notes, r.tiers), tiers: r.tiers }
}
