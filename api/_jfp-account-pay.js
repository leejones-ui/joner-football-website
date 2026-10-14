// Pay from My account with no link from staff (Lee, 13 Oct 2026). A player
// added "session by session" or "decide later", or given a term fee with no
// payment link, could sign in and find nothing to pay. Now, for any place
// with no open payment request:
//
//   term      a term fee still owing (fee less paid): "Pay A$850 for Term 4, <group>"
//   sessions  session by session, with sessions staff billed but no open link:
//             pay what is owing
//   prepay    session by session, nothing owing: pay for the next 1 to N
//             sessions this term at their own price ([PERSESSION:...] on the
//             row, or the price list's default), with the dates listed
//
// Amounts are always worked out here from Airtable, never taken from the
// page. The payment request is made when the family taps Pay (one at a time,
// and an open one for the same place is handed back rather than a second
// made), then the usual pay() checkout runs. The waiver comes first.
//
// Prepaid sessions: the sessions go onto the row's fee when the link is made
// (exactly as staff session billing does, with restoreFields so a cancelled
// link takes them off again). When it is paid, the finalise step adds the
// count to [PREPAID:<n>] in the row's notes, and the next time staff bill
// sessions from Money that many come off the bill (sessionInvoice). The dates
// prepaid stay on the payment request (prepay.dates), so the account never
// offers the same date twice.
import {
  clean, formatAud, newId, savePayreq, getPayreq, listPayreqs, audit, kvCommand, locationFor, dateLabel, sydneyToday, closeCheckout,
  isSessionType, isProType, withPerSession, rowEmails,
} from './_jfp-store.js'
import { getTerm4Row, updateTerm4Rows, appendNote, bustRosterCache } from './_jfp-airtable.js'
import { rowSessionDates, rowTime, noticeFor } from './_jfp-cancel.js'
import { quoteTiersOf, quoteOptions, commitmentOf } from './_jfp-quote.js'

const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const isOpen = (q) => ['open', 'checkout'].includes(q?.status)
export const PREPAY_MAX = 20

// Rows where an amount shown to the family could be wrong: trials (their own
// link), and places staff have marked paid, not charged or on an agreed plan.
const NO_AMOUNT = /trial|scholar|sponsor|free|comp|plan|n\/a/i
function termOwing(r) {
  if (isSessionType(r.paymentType) || NO_AMOUNT.test(r.paymentType || '')) return 0
  if (['Paid', 'N/A'].includes(r.paymentStatus)) return 0
  const fee = cents(r.feeAud), paid = cents(r.paidAud)
  return fee > 0 && fee > paid ? fee - paid : 0
}

// The price per session: the player's own, else the price list's default
// (a Pro sessions price for Pro players, the 1 to 1 price for 1 to 1
// casuals, otherwise the group's term price over the weeks of the term).
export function perSessionFor(config, r, group) {
  if (r.perSessionCents >= 100) return r.perSessionCents
  const live = (config.customPrices || []).filter((p) => !p.archived && p.perSession)
  if (isProType(r.paymentType)) return live.find((p) => p.programme === 'pro')?.cents || 0
  if (/1 on 1/i.test(r.paymentType || '')) return config.prices?.oneToOne || 0
  const own = live.find((p) => p.programme === 'jfp')
  if (own) return own.cents
  const term = group ? config.prices?.[group.product || 'group'] : 0
  const weeks = Number(config.weeks) || 10
  return term ? Math.round(term / weeks / 100) * 100 : 0
}

// Upcoming dates this row can still prepay: not past, not told "can't make
// it", not already on a paid (or open) prepay link.
export function prepayDates({ config, row, group, payreqs, cancels = [], nowMs = Date.now() }) {
  if (!row.groupId && !group) return []
  const time = rowTime(row, group)
  const taken = new Set(payreqs.filter((q) => q.prepay?.rowId === row.id && (q.status === 'paid' || isOpen(q))).flatMap((q) => q.prepay.dates || []))
  const told = new Set(cancels.filter((c) => c.rowId === row.id).map((c) => c.date))
  return rowSessionDates(config, row, group)
    .filter((d) => !taken.has(d) && !told.has(d))
    .filter((d) => { const n = noticeFor({ date: d, time, nowMs }); return n && n.startMs > nowMs })
}

const placeLabel = (config, row, group) => (group ? `${group.day} ${group.time}, ${locationFor(config, group.location).name}` : [row.day, row.time, row.location].filter(Boolean).join(' ') || 'Group to be confirmed')

// What each place still needs paying, for places with no open payment
// request. players: the family's players (familyFor). Each item says what to
// show; nothing here is trusted back from the page.
export function owedItems({ config, players, payreqs, byGroup, cancels = [], nowMs = Date.now() }) {
  const out = []
  for (const p of players) {
    for (const r of p.term4) {
      if (!r.holdsPlace || /trial/i.test(r.paymentType || '')) continue
      if (payreqs.some((q) => isOpen(q) && !q.quick && (q.term4Ids || []).includes(r.id))) continue
      const group = byGroup[r.groupId] || null
      const where = placeLabel(config, r, group)
      const base = { rowId: r.id, playerKey: p.key, player: p.name, group: where, needsWaiver: !p.waiver }
      const term = termOwing(r)
      if (term) { out.push({ ...base, kind: 'term', amountCents: term, amountLabel: formatAud(term), title: `Pay ${formatAud(term)} for ${config.term}, ${where}` }); continue }
      if (!isSessionType(r.paymentType)) continue
      const owing = Math.max(0, cents(r.feeAud) - cents(r.paidAud))
      if (owing > 0) { out.push({ ...base, kind: 'sessions', amountCents: owing, amountLabel: formatAud(owing), title: 'Pay for your sessions' }); continue }
      const per = perSessionFor(config, r, group)
      if (!per) continue
      const dates = prepayDates({ config, row: r, group, payreqs, cancels, nowMs })
      if (!dates.length) continue
      const listed = dates.slice(0, PREPAY_MAX).map((iso) => ({ iso, label: dateLabel(iso) }))
      // A quote staff set for this player (Pro sessions, 14 Oct 2026): the
      // next session, or one of their commitment options. Only these.
      const tiers = quoteTiersOf(r.notes)
      const quote = tiers.length ? { options: quoteOptions({ perCents: per, tiers, dates: listed }), commitment: commitmentOf(r.notes, sydneyToday(nowMs)) } : null
      out.push({ ...base, kind: 'prepay', title: 'Pay for your sessions', perCents: per, perLabel: formatAud(per), max: Math.min(PREPAY_MAX, dates.length), dates: listed, ...(quote ? { quote } : {}) })
    }
  }
  return out
}

function no(status, error, code = '') { return { ok: false, status, error, ...(code ? { code } : {}) } }

// The family pressed Pay on one of the items above: make (or hand back) the
// payment request. ctx: { config, parent, fam (fresh), byGroup, cancels, site }.
export async function payOwed({ config, parent, fam, byGroup, cancels, site, body }) {
  const rowId = clean(body.rowId, 30)
  const p = fam.players.find((x) => x.term4.some((r) => r.id === rowId))
  const listed = p?.term4.find((r) => r.id === rowId)
  // fam is this signed-in family's own rows only (familyFor), so a row found
  // here is theirs.
  if (!p || !listed || !rowEmails(listed).some((e) => fam.emails.includes(e))) return no(404, 'We could not find that place on your account.')
  // One at a time per place: two taps, two tabs.
  const lock = `jfp:owed-lock:${rowId}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) !== 'OK') return no(409, 'Just a moment, that is still being set up.', 'busy')
  try {
    const all = await listPayreqs()
    // Any open request for this place already: that one, never a second.
    const open = all.find((q) => isOpen(q) && !q.quick && (q.term4Ids || []).includes(rowId))
    if (open) return { ok: true, payreqId: open.id, reused: true }
    if (!p.waiver) return no(400, 'Sign the waiver first, then pay.', 'waiver')
    const row = (await getTerm4Row(rowId)) || listed
    // Fresh money fields from Airtable; the group as the roster placed it.
    const r = { ...listed, ...row, groupId: listed.groupId, emails: listed.emails }
    const group = byGroup[r.groupId] || null
    const [item] = owedItems({ config, players: [{ ...p, term4: [r] }], payreqs: all, byGroup, cancels })
    if (!item) return no(409, 'There is nothing to pay for this place just now. Your account updates within a few minutes.', 'nothing')
    const where = placeLabel(config, r, group)
    const q = {
      id: newId('PAY'),
      email: parent.email,
      parentName: r.ownContact ? '' : r.parent || fam.parentName || '',
      ...(isProType(r.paymentType) ? { programme: 'pro' } : {}),
      ...(r.ownContact ? { ownContact: true } : {}),
      playerNames: [p.name], playerKeys: [p.key], term4Ids: [r.id],
      groupId: group?.id || '', groupLabel: where,
      requestId: '', product: '', productLabel: '', startDate: '', trialDate: '', creditCents: 0,
      status: 'open', createdBy: parent.email, createdAt: new Date().toISOString(), expiresAt: '', siteUrl: site,
      // Made by the family from My account, not sent by staff.
      fromAccount: true,
    }
    if (item.kind === 'term') {
      Object.assign(q, { reason: 'balance', amountCents: item.amountCents, afterpay: true })
    } else if (item.kind === 'sessions') {
      Object.assign(q, { reason: 'sessions', amountCents: item.amountCents, afterpay: false, groupLabel: 'Session by session', places: [{ rowId: r.id, name: p.name, label: 'Sessions billed by Joner Football', feeCents: item.amountCents, paidCents: 0, owingCents: item.amountCents }] })
    } else {
      // A quoted player picks one of staff's options (body.option, e.g.
      // 'commit:6'); the price comes from the quote on the row, never the page.
      const pick = body.option != null && body.option !== 'one' ? (item.quote?.options || []).find((o) => o.key === clean(body.option, 20)) : null
      if (body.option != null && body.option !== 'one' && !pick) return no(400, 'That option is not available any more. Refresh and choose again.', 'option')
      const n = pick ? pick.n : Number(body.sessions ?? 1)
      if (!Number.isInteger(n) || n < 1 || n > item.max) return no(400, `Choose 1 to ${item.max} session${item.max > 1 ? 's' : ''}.`)
      const per = pick ? pick.perCents : item.perCents
      const dates = item.dates.slice(0, n).map((d) => d.iso)
      const amountCents = n * per
      const fee = cents(r.feeAud) + amountCents
      const paid = cents(r.paidAud)
      const restoreFields = [{ id: r.id, fields: { 'Term 4 Fee': r.feeAud ?? 0, 'Term 4 Payment Status': r.paymentStatus || 'Unpaid' } }]
      Object.assign(q, {
        reason: 'sessions', amountCents, afterpay: false, groupLabel: 'Session by session', restoreFields,
        prepay: { rowId: r.id, sessions: n, perCents: per, dates, ...(pick?.commit ? { commit: true } : {}) },
        places: [{ rowId: r.id, name: p.name, label: `${pick?.commit ? `Commitment: ${n} sessions in a row` : `${n} session${n > 1 ? 's' : ''}`} at ${formatAud(per)}${pick?.commit ? ' each' : ''}: ${dates.map(dateLabel).join(', ')}`, feeCents: amountCents, paidCents: 0, owingCents: amountCents }],
      })
      // On the fee now, as staff billing does, so Money and the balance agree.
      await updateTerm4Rows([{ id: r.id, fields: {
        'Term 4 Fee': fee / 100,
        'Term 4 Payment Status': paid >= fee ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid',
        'Term 4 Notes': appendNote(r.perSessionCents ? r.notes : withPerSession(r.notes, item.perCents), `${pick?.commit ? `Committing from My account on ${sydneyToday()} to ${n} sessions in a row` : `Prepaying from My account on ${sydneyToday()}`}: ${n} x ${formatAud(per)} = ${formatAud(amountCents)} (${dates.join(', ')}), payment link ${q.id}.`),
      } }])
      await bustRosterCache()
    }
    await savePayreq(q)
    await audit({ by: parent.email, action: `payreq.account.${q.prepay?.commit ? 'commit' : item.kind}`, target: q.id, after: { row: r.id, cents: q.amountCents, ...(q.prepay ? { sessions: q.prepay.sessions, per: q.prepay.perCents, dates: q.prepay.dates } : {}) } })
    return { ok: true, payreqId: q.id }
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}

// The family made a prepay link from My account and wants to choose again
// (say the next session instead of a commitment): close it, take its sessions
// back off the fee, and the options show again. Only their own account-made
// prepay links; anything staff sent stays for staff to change.
export async function cancelOwed({ parent, fam, body }) {
  const q = await getPayreq(clean(body.payreqId, 60))
  const rowId = q?.prepay?.rowId
  const mine = rowId && fam.players.some((p) => p.term4.some((r) => r.id === rowId && rowEmails(r).some((e) => fam.emails.includes(e))))
  if (!q || !q.fromAccount || !mine) return no(404, 'We could not find that payment.')
  if (q.status === 'paid') return no(409, 'This is already paid.', 'paid')
  if (!isOpen(q)) return { ok: true, already: true }
  const lock = `jfp:owed-lock:${rowId}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '20'])) !== 'OK') return no(409, 'Just a moment, that is still being set up.', 'busy')
  try {
    const closed = q.status === 'checkout' && q.stripeSessionId ? await closeCheckout(q.stripeSessionId) : 'expired'
    if (closed === 'complete') return no(409, 'This payment has gone through and is being processed. Refresh in a minute.', 'processing')
    if (closed === 'error') return no(503, 'Could not close the payment page. Try again in a minute.')
    await savePayreq({ ...q, status: 'cancelled', cancelledBy: parent.email, cancelledAt: new Date().toISOString(), cancelReason: 'Family chose again in My account' })
    if (q.restoreFields?.length) { await updateTerm4Rows(q.restoreFields); await bustRosterCache() }
    await audit({ by: parent.email, action: 'payreq.account.cancel', target: q.id, after: { row: rowId, cents: q.amountCents } })
    return { ok: true }
  } finally { await kvCommand(['DEL', lock]).catch(() => {}) }
}
