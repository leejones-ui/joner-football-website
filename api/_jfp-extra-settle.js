// After a payment request is paid (card, saved card, bank, cash): an extra
// session it paid for is now that family's (Lee, 28 Oct 2026: only a paid
// booking takes a place). Families still to pay who no longer fit come off
// and their charge is cancelled, so auto charge never takes money for it.
// Two families paid at the same moment: nobody is moved or refunded here;
// Lee and Ligia are told and choose. Never throws: a paid payment must
// always finish.
import { extraSettle, extraRestore } from './_jfp-extra.js'
import { listCharges as listChargesReal, cancelCharge as cancelChargeReal } from './_jfp-charges.js'
import { telegramAlert as telegramReal } from './_jfp-notify.js'
import { formatAud, dateLabel, getPayreq } from './_jfp-store.js'

const SYSTEM = { email: 'system', name: 'Extra session taken' }

// `deps` is for the unit test only (a charge that cannot be cancelled).
export async function settleExtraPaid(payreqId, deps = {}) {
  const { listCharges = listChargesReal, cancelCharge = cancelChargeReal, telegramAlert = telegramReal } = deps
  try {
    const r = await extraSettle(payreqId)
    const s = r.slot
    if (!s) return r
    const when = `${dateLabel(s.date)} ${s.time}`
    if (r.overPaid?.length) {
      const charges = (await listCharges()).filter((c) => r.overPaid.includes(c.payreqId))
      await telegramAlert(`Extra session ${when} (${s.location}): two families have paid for the same session at the same time.\n${charges.map((c) => `- ${c.playerName || c.label}: ${formatAud(c.amountCents)}`).join('\n')}\nNothing was refunded. Choose who keeps it and refund the other in Stripe.`)
      return r
    }
    if (!r.removed.length) return r
    const charges = await listCharges()
    const cancelled = [], paidToo = []
    for (const x of r.removed) {
      const c = charges.find((y) => y.payreqId === x.payreqId)
      const res = c ? await cancelCharge({ id: c.id, principal: SYSTEM, why: 'Another family paid for the session first' }).catch((e) => { console.error('jfp extra settle cancel failed', e); return { ok: false } }) : null
      // Not cancelled, or paid in the meantime: that family paid too.
      const q = x.payreqId ? await getPayreq(x.payreqId).catch(() => null) : null
      if ((c && !res?.ok) || q?.status === 'paid') paidToo.push({ ...x, charge: c }); else cancelled.push(x)
    }
    if (paidToo.length) {
      await extraRestore(s.id, paidToo.flatMap((x) => x.ids || [x.bookingId]))
      const payer = charges.find((c) => c.payreqId === payreqId)
      const lines = [payer ? `- ${payer.playerName || payer.label}: ${formatAud(payer.amountCents)}` : '- the family that paid first', ...paidToo.map((x) => `- ${x.players.join(' and ')}${x.charge ? `: ${formatAud(x.charge.amountCents)}` : ''}`)]
      await telegramAlert(`Extra session ${when} (${s.location}): two families have paid for the same session at the same time.\n${lines.join('\n')}\nBoth are still on the session. Nothing was refunded. Choose who keeps it and refund the other in Stripe.`)
    }
    if (cancelled.length) await telegramAlert(`Extra session ${when} (${s.location}) was paid for, so ${cancelled.map((x) => x.players.join(' and ')).join('; ')} came off it (they had not paid). Their charge is cancelled and nothing was taken. They have not been told yet.`)
    return r
  } catch (error) {
    console.error('jfp extra settle failed', error)
    return { removed: [], error: true }
  }
}
