// The one way a JFP payment is refunded from the portal (Lee, 5 Nov 2026):
// the Refund button in Money and the family's "Cancel this session" both call
// refundPayreq. It refunds in Stripe, then applies the refund at once with the
// same code the charge.refunded webhook runs (applyJfpRefunds), so a refund
// lands once however it arrives.
//
// Extra sessions rule (_jfp-extra-cancel.js cancelQuote, Lee, 7 Nov 2026): 48 hours
// or more notice, everything back but A$5; 24 to 48 hours, half; under 24
// hours, nothing (the caller decides that; this only checks money).
// JFP term fees (Lee, 5 Nov 2026) are refunded by their Stripe payment with
// refundStripePayment: the A$50 / A$30 and unused sessions are worked out in
// the portal (src/scripts/jfp-term-refund.js) and staff can change the amount.
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

// The charge behind a Stripe payment (pi_ or cs_), with the JFP record it paid.
async function chargeOfPayment(stripeId) {
  const id = clean(stripeId, 120)
  if (!/^(pi|cs)_/.test(id)) return null
  const found = await chargeOf(id.startsWith('cs_') ? { stripeSessionId: id } : { stripePaymentIntentId: id })
  if (!found) return null
  const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(found.piId)}`)
  return { ...found, jfpId: clean(pi?.metadata?.jfpBookingId || '', 60) }
}

// What a refund can be for one Stripe payment: { paidCents, refundedCents, roomCents }, or { error }.
export async function paymentRefundRoom(stripeId) {
  const found = await chargeOfPayment(stripeId)
  if (!found) return { error: 'That Stripe payment was not found.' }
  const { charge } = found
  if (charge.status !== 'succeeded' && charge.paid !== true) return { error: 'Only a paid payment can be refunded.' }
  return { ...found, paidCents: charge.amount, refundedCents: charge.amount_refunded, roomCents: Math.max(0, charge.amount - charge.amount_refunded) }
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
    return await sendRefund({ key: id, jfpId: id, r, amount, who, reason })
  } finally { await kvCommand(['DEL', lock]) }
}

// Refund r.charge by amount, record it, then apply it to the JFP record (if any).
async function sendRefund({ key, jfpId, r, amount, who, reason }) {
  const note = clean(reason, 300)
  let refund
  try {
    refund = await stripeFetch('/refunds', {
      method: 'POST',
      idempotencyKey: `jfp-refund:${key}:${r.refundedCents}:${amount}`,
      body: { charge: r.charge.id, amount: String(amount), reason: 'requested_by_customer', ...(jfpId ? { 'metadata[jfpPayreqId]': jfpId } : {}), 'metadata[by]': who, ...(note ? { 'metadata[note]': note } : {}) },
    })
  } catch (error) {
    return { ok: false, error: `Stripe did not refund it: ${error.message}` }
  }
  // Money's Stripe list (api/_jfp-stripe.js CACHE) is read again, so the refund shows at once.
  await kvCommand(['DEL', 'jfp:stripe-payments:v2'])
  await audit({ by: who, action: 'payment.refundRequest', target: jfpId || key, after: { refund: refund.id, cents: amount, status: refund.status, reason: note } })
  // Apply it now (the webhook may come later and then finds it done).
  if (refund.status === 'succeeded' && jfpId) {
    try {
      const { charge, piId } = await jfpIdForCharge(r.charge.id)
      await applyJfpRefunds(jfpId, charge, piId)
    } catch (error) { console.error('jfp refund: applied by the webhook instead', error) }
  }
  const after = jfpId.startsWith('PAY-') ? await getPayreq(jfpId) : null
  return { ok: true, refundId: refund.id, status: refund.status, amountCents: amount, refundedCents: after?.refundedCents ?? r.refundedCents + amount }
}

// refundStripePayment({ stripeId, amountCents, by, reason }): a JFP term fee
// (or any JFP Stripe payment) refunded by its pi_ / cs_ id. Same answers as refundPayreq.
export async function refundStripePayment({ stripeId, amountCents, by, reason = '' }) {
  const id = clean(stripeId, 120)
  const amount = Math.round(Number(amountCents))
  const who = clean(by, 120)
  if (!/^(pi|cs)_/.test(id)) return { ok: false, error: 'That Stripe payment was not found.' }
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'Enter an amount to refund.' }
  if (!who) return { ok: false, error: 'Who is refunding is needed.' }
  const lock = `jfp:refund-request:${id}`
  if ((await kvCommand(['SET', lock, '1', 'NX', 'EX', '60'])) !== 'OK') return { ok: false, error: 'A refund for this payment is already going through. Check again in a minute.' }
  try {
    const r = await paymentRefundRoom(id)
    if (r.error) return { ok: false, error: r.error }
    if (amount > r.roomCents) return { ok: false, error: r.roomCents ? `Only ${formatAud(r.roomCents)} is left to refund on this payment.` : 'This payment has already been refunded in full.' }
    // One key per payment intent, whichever id the button was given.
    return await sendRefund({ key: r.piId, jfpId: r.jfpId, r, amount, who, reason })
  } finally { await kvCommand(['DEL', lock]) }
}
