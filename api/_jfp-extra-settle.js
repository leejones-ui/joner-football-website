// After a payment request is paid (card, saved card, bank, cash): an extra
// session it paid for is now that family's (Lee, 28 Oct 2026: only a paid
// booking takes a place). Families still to pay who no longer fit come off
// and their charge is cancelled, so auto charge never takes money for it.
// Two families paid at the same moment: nobody is moved or refunded here;
// Lee and Ligia are told and choose. Never throws: a paid payment must
// always finish.
import { extraSettle, extraRestore } from './_jfp-extra.js'
import { listCharges as listChargesReal, cancelCharge as cancelChargeReal } from './_jfp-charges.js'
import { telegramAlert as telegramReal, barryAlert as barryReal } from './_jfp-notify.js'
import { formatAud, dateLabel, getPayreq, getConfig, coachById, coachLabel, locationFor, kvCommand } from './_jfp-store.js'
import { sendStaffNotice } from './_jfp-email.js'

const SYSTEM = { email: 'system', name: 'Extra session taken' }
const TOLD = 'jfp:extra-paid-told'
const OWNER = () => (process.env.JFP_OWNER_EMAIL || 'leejones@jonerfootball.com').toLowerCase()

// The words for a paid booking (Lee, 3 Nov 2026: Niki Brown booked his
// Thursday session and nobody told him). Names, session and amount only: no
// emails or phone numbers in chat.
export function paidWords({ config, s, payreq }) {
  const lead = (s.bookings || []).find((b) => b.payreqId === payreq.id)
  const group = lead ? (s.bookings || []).filter((b) => b.status !== 'removed' && (b.id === lead.id || (lead.groupId ? b.groupId === lead.groupId : b.groupId === lead.id))) : []
  const names = [...new Set((group.length ? group : [lead]).filter(Boolean).map((b) => `${b.name}${b.guest ? ' (friend)' : ''}`))]
  const c = coachById(config, s.coachId)
  const coach = coachLabel(c) || 'no coach set'
  const where = locationFor(config, s.location).name
  const kind = /1 on 1/.test(payreq.productLabel || '') ? '1 on 1' : names.length > 1 ? `group of ${names.length}` : ''
  const when = `${dateLabel(s.date)} ${s.time}`
  const amount = formatAud(payreq.paidCents ?? payreq.amountCents ?? 0)
  const who = names.join(', ') || (payreq.playerNames || []).join(', ') || 'A family'
  return {
    text: `Extra session booked and paid\n${who}\n${when}, ${where}${kind ? `, ${kind}` : ''}\nCoach ${coach} · ${amount}${payreq.paidOffline ? ' (recorded by staff)' : ' (card)'}\nPortal: Extra sessions`,
    email: { subject: `Extra session booked: ${who}, ${when}`, heading: 'An extra session is booked and paid', paras: [`${who} booked the extra session on ${when} at ${where}${kind ? ` (${kind})` : ''} and paid ${amount}.`], list: [['Session', `${when}, ${where}`], ['Coach', coach], ['Paid', amount]] },
    // The coach of the session hears it too (Lee, 3 Nov 2026: "yes 100%").
    // No price in it: what a family pays is for Lee and Ligia.
    coach: c?.email ? {
      to: [{ email: c.email, name: `Coach ${c.name}` }],
      subject: `Your extra session is booked: ${who}, ${when}`, heading: 'Your extra session is booked',
      paras: [`Hi ${c.name}. ${who} ${names.length > 1 ? 'have' : 'has'} booked and paid for your extra session on ${when} at ${where}${kind ? ` (${kind})` : ''}.`, 'It is on your Timetable in the portal.'],
      list: [['Session', `${when}, ${where}`], ['Player', who]],
    } : null,
  }
}
async function tellPaid(payreqId, s, barry) {
  if (Number(await kvCommand(['HSETNX', TOLD, payreqId, new Date().toISOString()])) !== 1) return
  const [config, payreq] = await Promise.all([getConfig(), getPayreq(payreqId)])
  if (!payreq) return
  const w = paidWords({ config, s, payreq })
  await Promise.allSettled([
    barry(w.text),
    sendStaffNotice({ to: [{ email: OWNER(), name: 'Lee' }], ...w.email, cta: { label: 'Open Extra sessions', url: 'https://jonerfootball.com/jfp-portal/#extra' }, kind: 'extra paid' }),
    // Lee coaching it himself: the email above already told him.
    w.coach && w.coach.to[0].email.toLowerCase() !== OWNER() ? sendStaffNotice({ ...w.coach, cta: { label: 'Open the portal', url: 'https://jonerfootball.com/jfp-portal/' }, kind: 'extra paid to coach' }) : null,
  ])
}

// `deps` is for the unit test only (a charge that cannot be cancelled).
export async function settleExtraPaid(payreqId, deps = {}) {
  const { listCharges = listChargesReal, cancelCharge = cancelChargeReal, telegramAlert = telegramReal, barryAlert = barryReal, tell = tellPaid } = deps
  try {
    const r = await extraSettle(payreqId)
    const s = r.slot
    if (!s) return r
    const when = `${dateLabel(s.date)} ${s.time}`
    // Lee hears every paid family booking, in his Barry chat and by email.
    await tell(payreqId, s, barryAlert).catch((e) => console.error('jfp extra paid alert failed', e))
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
