// A refund made in Stripe flows back here, so Airtable and the ledger never
// disagree with the money. Stripe sends charge.refunded; we re-read the
// charge and its payment from Stripe (never trusting the event body), find
// the JFP booking or payment link it paid, and for each refund not seen yet:
//   - take the amount off the Term 4 rows it paid for (split by what each paid)
//   - add a negative row to the ledger, and mark the original payment
//   - note it on the booking or link, the audit log, and email Lee and Ligia
// Each refund id is applied once, however often Stripe sends the event.
import { stripeFetch } from './_holiday-store.js'
import { getBooking, saveBooking, getPayreq, savePayreq, getConfig, audit, formatAud, kvCommand, clean } from './_jfp-store.js'
import { getTerm4Row, updateTerm4Rows, appendNote, airtable, TABLES, findLedgerByPayment } from './_jfp-airtable.js'
import { splitBy } from './_jfp-finalise.js'
import { sendRefundAlert } from './_jfp-email.js'
import { nextStatuses, setNextStatus, recordNext } from './_jfp-next.js'

const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)

export async function jfpIdForCharge(chargeId) {
  const charge = await stripeFetch(`/charges/${encodeURIComponent(chargeId)}?expand[]=refunds`)
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!piId) return { charge, id: '' }
  const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(piId)}`)
  return { charge, id: clean(pi?.metadata?.jfpBookingId || '', 60), piId }
}

export async function applyJfpRefunds(id, charge, piId) {
  const isPay = id.startsWith('PAY-')
  const record = isPay ? await getPayreq(id) : await getBooking(id)
  if (!record) return { ok: false, reason: 'unknown' }
  const save = isPay ? savePayreq : saveBooking
  // Only money actually returned: a pending refund can still fail.
  const refunds = (charge.refunds?.data || []).filter((r) => r.status === 'succeeded')
  const config = await getConfig()
  const done = []
  for (const refund of refunds) {
    // One worker per refund at a time. Every step below checks whether it
    // already happened, so a retry after a failure finishes the job safely.
    const lock = `jfp:refund-lock:${refund.id}`
    if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '120'])) !== 'OK') continue
    try {
    const fresh = isPay ? await getPayreq(id) : await getBooking(id)
    Object.assign(record, fresh)
    if ((record.refunds || []).some((x) => x.id === refund.id)) continue
    const amount = refund.amount
    const rows = []
    for (const rid of record.term4Ids || []) { const r = await getTerm4Row(rid); if (r) rows.push(r) }
    // Split by what THIS payment put on each row (saved when it was paid),
    // never more than that; older records fall back to what each row paid.
    const given = rows.map((r) => Number(record.rowShares?.[r.id] ?? (record.term4Ids.length === 1 ? cents(r.paidAud) : record.unitCents ?? cents(r.paidAud))))
    const already = rows.map((r) => (record.refunds || []).reduce((t, x) => t + Number(x.byRow?.[r.id] || 0), 0))
    const room = given.map((g, i) => Math.max(0, g - already[i]))
    const share = rows.length ? splitBy(Math.min(amount, room.reduce((t, v) => t + v, 0)), room) : []
    const updates = rows.map((r, i) => {
      if (r.notes.includes(`[REFUND:${refund.id}]`) || !share[i]) return null
      const paid = Math.max(0, cents(r.paidAud) - share[i])
      const fee = cents(r.feeAud)
      return { id: r.id, fields: {
        'Term 4 Amount Paid': paid / 100,
        'Term 4 Payment Status': paid <= 0 ? (r.holdsPlace ? 'Unpaid' : 'N/A') : fee && paid < fee ? 'Partially Paid' : 'Paid',
        'Term 4 Notes': appendNote(r.notes, `Refunded ${formatAud(share[i])} in Stripe (${refund.id}). [REFUND:${refund.id}]`),
        'Term 4 Payment Evidence': `${r.evidence ? `${r.evidence}\n` : ''}Refund ${refund.id}, ${(share[i] / 100).toFixed(2)} back to the family.`.slice(-4000),
      } }
    }).filter(Boolean)
    if (updates.length) await updateTerm4Rows(updates)
    // The ledger keeps every movement: the refund as its own negative row,
    // and the original payment marked refunded.
    if (!(await findLedgerByPayment(refund.id)).length) {
      await airtable(encodeURIComponent(TABLES.ledger), { method: 'POST', body: { typecast: true, records: [{ fields: {
        'Payment ID': refund.id, 'Term': record.next?.term || config.term, 'Player Name': (record.playerNames || (record.players || []).map((p) => p.name)).join(', '),
        'Amount Paid': -amount / 100, 'Payment Method': 'Stripe', 'Payment Status': charge.amount_refunded >= charge.amount ? 'Refunded' : 'Partially Refunded',
        'Payment Date': new Date((refund.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10), 'Source Table': 'Term 4 Players',
        'Source Record ID': (record.term4Ids || []).join(', ') || record.next?.rowId || '', 'Stripe Payment Intent ID': piId || '', 'Notes': `Refund of ${record.id} made in Stripe${refund.reason ? ` (${refund.reason})` : ''}.`,
        'Updated At': new Date().toISOString(),
      } }] } })
    }
    const [orig] = await findLedgerByPayment(piId || record.stripePaymentIntentId || record.id)
    if (orig) await airtable(encodeURIComponent(TABLES.ledger), { method: 'PATCH', body: { typecast: true, records: [{ id: orig, fields: { 'Payment Status': charge.amount_refunded >= charge.amount ? 'Refunded' : 'Partially Refunded', 'Updated At': new Date().toISOString() } }] } })
    // Next term: a refunded hold or payment no longer holds the place.
    if (record.next) {
      const st = (await nextStatuses(record.next.term))[record.next.rowId] || {}
      const left = Math.max(0, Number(st.paidCents || 0) - amount)
      const status = left <= 0 ? 'invited' : st.status === 'paid' && left < record.next.fullCents ? 'held' : st.status || 'invited'
      await setNextStatus(record.next.term, record.next.rowId, { ...st, status, paidCents: left })
      const row = await getTerm4Row(record.next.rowId)
      if (row) await recordNext({ term: record.next.term, row, group: null, status, amountCents: left, note: `Refunded ${formatAud(amount)} in Stripe (${refund.id}).`, by: 'stripe' })
    }
    const entry = { id: refund.id, amountCents: amount, at: new Date().toISOString(), rows: updates.map((u) => u.id), byRow: Object.fromEntries(rows.map((r, i) => [r.id, share[i] || 0])) }
    record.refunds = [...(record.refunds || []), entry]
    record.refundedCents = (record.refunds || []).reduce((t, x) => t + x.amountCents, 0)
    await save(record)
    await audit({ by: 'stripe', action: 'payment.refund', target: record.id, after: { refund: refund.id, cents: amount, rows: entry.rows } })
    try { await sendRefundAlert({ record, refund: entry, config, full: charge.amount_refunded >= charge.amount }) } catch (error) { console.error('jfp refund alert failed', error) }
    done.push(entry)
    } finally { await kvCommand(['DEL', lock]) }
  }
  await kvCommand(['DEL', 'jfp:roster-cache'])
  return { ok: true, applied: done.length }
}
