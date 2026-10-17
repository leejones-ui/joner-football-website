// A Stripe payment that is not JFP term income (Lee, 18 Oct 2026): money paid
// on a JFP payment link (say "1 on 1 Session") that was really holiday
// training, Pro sessions, or nothing to do with JFP. The Stripe twin of the
// bank line buttons (Holiday revenue, Pro session, Not JFP).
//
// One hash, jfp:stripe-class, one field per Checkout Session (or payment
// intent) id: { id, intentId, kind, cents, refundedCents, feeCents,
// feeGstCents, feeKnown, date, ... }. Written with HSETNX, so a payment is
// marked once and a second press changes nothing.
//
// jfpStripePayments applies it to every read: a marked payment leaves JFP
// term income (and so Unmatched Stripe, the to-check counts, the Stripe sync
// and Match to player). Holiday ones count in Money > Holiday training with
// their Stripe fee (_holiday-money.js), Pro ones in Money > Pro sessions, and
// Not JFP ones with the other Stripe payments. Undo takes the field away and
// the payment is back where it was.
import { kvCommand } from './_jfp-store.js'

export const STRIPE_CLASS = 'jfp:stripe-class'
export const CLASS_KINDS = ['holiday', 'pro', 'notJfp']
export const CLASS_LABEL = { holiday: 'holiday training', pro: 'Pro sessions', notJfp: 'not JFP' }
// A Checkout Session or a payment intent (auto charges are listed by intent).
export const STRIPE_PAY_ID = /^(cs|pi)_[A-Za-z0-9_]{6,200}$/

export async function listStripeClass() {
  const flat = await kvCommand(['HGETALL', STRIPE_CLASS]).catch(() => [])
  const out = []
  for (let i = 1; Array.isArray(flat) && i < flat.length; i += 2) { try { const r = JSON.parse(flat[i]); if (r?.id && CLASS_KINDS.includes(r.kind)) out.push(r) } catch {} }
  return out
}
export async function getStripeClass(id) {
  try { const r = JSON.parse((await kvCommand(['HGET', STRIPE_CLASS, id])) || 'null'); return r?.id ? r : null } catch { return null }
}
export const listHolidayStripe = async () => (await listStripeClass()).filter((r) => r.kind === 'holiday')

// Pure: a jfpStripePayments answer with the marked payments taken out of
// this term (and next term). Pro ones join pro; Not JFP ones count as other.
export function applyStripeClass(out, list = []) {
  if (!list.length) return out
  const by = new Map()
  for (const r of list) { by.set(r.id, r); if (r.intentId) by.set(r.intentId, r) }
  const markOf = (p) => by.get(p.id) || (p.intentId ? by.get(p.intentId) : null)
  const other = { count: out.other?.count || 0, cents: out.other?.cents || 0 }
  const pro = [...(out.pro || [])]
  const pick = (ps) => (ps || []).filter((p) => {
    const m = markOf(p)
    if (!m) return true
    if (m.kind === 'pro') pro.push({ ...p, pro: true, marked: true, ...(m.rowId ? { markedRowIds: [m.rowId] } : {}) })
    else if (m.kind === 'notJfp') { other.count += 1; other.cents += p.amountCents || 0 }
    return false
  })
  return { ...out, payments: pick(out.payments), next: pick(out.next), pro, other }
}
