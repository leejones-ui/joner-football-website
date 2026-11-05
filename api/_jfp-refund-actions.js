// The one way a JFP payment is refunded from the portal (Lee, 5 Nov 2026):
// the Refund button in Money and the family's "Cancel this session" both call
// refundPayreq. It refunds in Stripe, then applies the refund at once with the
// same code the charge.refunded webhook runs (applyJfpRefunds), so a refund
// lands once however it arrives.
//
// Extra sessions rule: 24 hours or more notice, everything back but A$5;
// inside 24 hours, nothing (the caller decides that; this only checks money).
import { stripeFetch } from './_holiday-store.js'
import { getPayreq, audit, formatAud, clean, kvCommand } from './_jfp-store.js'
import { jfpIdForCharge, applyJfpRefunds } from './_jfp-refunds.js'

export const REFUND_KEEP_CENTS = 500

// The Stripe charge a paid payreq was paid with, with its refunds.
async function chargeOf(q) {
  let piId = q.stripePaymentIntentId || ''
  if (!piId && q.stripeSessionId) {
    const s = await stripeFetch(`/checkout/sessions/${encodeURIComponent(q.stripeSessionId)}`)
    piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || ''
  }
  if (!piId) return null
  const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(piId)}?expand[]=latest_charge`)
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  return charge ? { charge, piId } : null
}

// What a refund can be for this payreq: { paidCents, refundedCents, roomCents, suggestCents }, or { error }.
export async function refundRoom(payreqId) {
  const q = await getPayreq(payreqId)
  if (!q) return { error: 'That payment was not found.' }
  if (q.status !== 'paid') return { error: 'Only a paid payment can be refunded.' }
  const found = await chargeOf(q)
  if (!found) return { error: 'This was not paid by card in Stripe, so there is nothing to refund there.' }
  const { charge } = found
  const roomCents = Math.max(0, charge.amount - charge.amount_refunded)
  return { q, ...found, paidCents: charge.amount, refundedCents: charge.amount_refunded, roomCents, suggestCents: Math.max(0, Math.min(roomCents, charge.amount - REFUND_KEEP_CENTS - charge.amount_refunded)) }
}

// refundPayreq({ payreqId, amountCents, by, reason }) -> { ok: true, refundId, amountCents, refundedCents }
// or { ok: false, error }. Never throws for a money reason. A second call with
// the same amount while nothing else has been refunded is the same refund.
export async function refundPayreq({ payreqId, amountCents, by, reason = '' }) {
  const id = clean(payreqId, 60)
  const amount = Math.round(Number(amountCents))
  const who = clean(by, 120)
  if (!id.startsWith('PAY-')) return { ok: false, error: 'That payment was not found.' }
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'Enter an amount to refund.' }
  if (!who) return { ok: false, error: 'Who is refunding is needed.' }
  const lock = `jfp:refund-request:${id}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '60'])) !== 'OK') return { ok: false, error: 'A refund for this payment is already going through. Check again in a minute.' }
  try {
    const r = await refundRoom(id)
    if (r.error) return { ok: false, error: r.error }
    if (amount > r.roomCents) return { ok: false, error: r.roomCents ? `Only ${formatAud(r.roomCents)} is left to refund on this payment.` : 'This payment has already been refunded in full.' }
    const note = clean(reason, 300)
    let refund
    try {
      refund = await stripeFetch('/refunds', {
        method: 'POST',
        idempotencyKey: `jfp-refund:${id}:${r.refundedCents}:${amount}`,
        body: { charge: r.charge.id, amount: String(amount), reason: 'requested_by_customer', 'metadata[jfpPayreqId]': id, 'metadata[by]': who, ...(note ? { 'metadata[note]': note } : {}) },
      })
    } catch (error) {
      return { ok: false, error: `Stripe did not refund it: ${error.message}` }
    }
    await audit({ by: who, action: 'payment.refundRequest', target: id, after: { refund: refund.id, cents: amount, status: refund.status, reason: note } })
    // Apply it now (the webhook may come later and then finds it done).
    if (refund.status === 'succeeded') {
      try {
        const { charge, piId } = await jfpIdForCharge(r.charge.id)
        await applyJfpRefunds(id, charge, piId)
      } catch (error) { console.error('jfp refund: applied by the webhook instead', error) }
    }
    const after = await getPayreq(id)
    return { ok: true, refundId: refund.id, status: refund.status, amountCents: amount, refundedCents: after?.refundedCents ?? r.refundedCents + amount }
  } finally { await kvCommand(['DEL', lock]) }
}
