// Refund a JFP term fee (Lee, 5 Nov 2026), from a Stripe payment in a
// player's payment history. The terms (/terms/#jfp-term-refunds):
// before the first session, the fee back less A$50 (full term) or A$30
// (half term); once it has started, only the sessions not had yet, less the
// same; once half the sessions have happened, nothing. Staff can change the
// amount (a medical credit, a session we cancelled): the sum is a starting point.
import { esc, money } from './jfp-common.js'

export const TERM_FEE_CENTS = { full: 5000, half: 3000 }
const cents = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.]/g, '')) * 100)

// termRefundQuote({ paidCents, roomCents, half, weeks, had }) -> { cents, sessions, feeCents, line }
export function termRefundQuote({ paidCents, roomCents = paidCents, half = false, weeks = 10, had = 0 }) {
  const sessions = half ? Math.round(weeks / 2) : weeks
  const feeCents = half ? TERM_FEE_CENTS.half : TERM_FEE_CENTS.full
  const h = Math.max(0, Math.min(sessions, Math.floor(Number(had) || 0)))
  if (h * 2 >= sessions) return { cents: 0, sessions, feeCents, line: `${h} of ${sessions} sessions have happened: half or more, so no refund.` }
  const unused = Math.round((paidCents * (sessions - h)) / sessions)
  const out = Math.max(0, Math.min(roomCents, unused - feeCents))
  const line = h
    ? `${sessions - h} of ${sessions} sessions not had: ${money(unused)}, less the ${money(feeCents)} fee = ${money(out)}.`
    : `Before the first session: ${money(paidCents)} less the ${money(feeCents)} fee = ${money(out)}.`
  return { cents: out, sessions, feeCents, line }
}

// The Refund window. ui: { post, modal, closeModal, toast }. s: the Stripe
// payment from playerPayments; t: its termRefund ({ weeks, half, had }).
export async function termRefundModal(ui, s, t, who, onDone) {
  const room = await ui.post('refundRoom', { stripeId: s.intentId || s.id })
  if (!room.ok) return ui.toast(room.data.error)
  const r = room.data
  const box = ui.modal(`<h2 style="margin-bottom:4px">Refund a term fee</h2><p class="muted small" style="margin-bottom:12px">${esc(who)} · paid ${esc(money(r.paidCents))}${r.refundedCents ? `, ${esc(money(r.refundedCents))} already refunded` : ''}</p>
    <div class="j-two"><label class="j-field"><span>Term</span><select class="j-select" id="tr-kind"><option value="full"${t.half ? '' : ' selected'}>Full term (A$50 fee)</option><option value="half"${t.half ? ' selected' : ''}>Half term (A$30 fee)</option></select></label>
    <label class="j-field"><span>Sessions had so far</span><input class="j-input" id="tr-had" inputmode="numeric" value="${esc(String(t.had || 0))}"></label></div>
    <div class="j-box j-box-blue small" id="tr-line" style="margin:4px 0 12px"></div>
    <label class="j-field"><span>Amount to refund (A$)</span><input class="j-input" id="rf-amt" inputmode="decimal"></label>
    <p class="muted small" style="margin-bottom:12px">Up to ${esc(money(r.roomCents))}. Change it if you need to: a session we cancelled, or a medical credit instead (then refund nothing and add a credit).</p>
    <label class="j-field"><span>Why (optional)</span><input class="j-input" id="rf-why" maxlength="300" placeholder="Moving away, before the term started"></label>
    <p class="j-err" id="rf-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="rf-go">Refund</button></div>`)
  const $ = (id) => box.querySelector(id)
  const go = $('#rf-go'), amt = $('#rf-amt')
  let sure = 0
  const reset = () => { sure = 0; go.textContent = 'Refund' }
  const work = () => {
    const q = termRefundQuote({ paidCents: r.paidCents, roomCents: r.roomCents, half: $('#tr-kind').value === 'half', weeks: t.weeks, had: $('#tr-had').value })
    $('#tr-line').textContent = q.line
    amt.value = (q.cents / 100).toFixed(2).replace(/\.00$/, '')
    reset()
  }
  $('#tr-kind').addEventListener('change', work)
  $('#tr-had').addEventListener('input', work)
  amt.addEventListener('input', reset)
  work()
  const err = (m) => { const e = $('#rf-err'); e.textContent = m; e.hidden = false }
  // Two taps: Refund, then "Yes, refund A$X" (money back to a card cannot be taken back).
  go.addEventListener('click', async () => {
    const amountCents = cents(amt.value)
    if (!amountCents) return err('Nothing to refund. For a medical credit, add a credit instead.')
    if (amountCents > r.roomCents) return err(`Only ${money(r.roomCents)} is left to refund.`)
    if (sure !== amountCents) { sure = amountCents; go.textContent = `Yes, refund ${money(amountCents)} to their card`; return }
    go.disabled = true
    const out = await ui.post('refundPayment', { stripeId: s.intentId || s.id, amountCents, reason: $('#rf-why').value || $('#tr-line').textContent })
    if (!out.ok) { go.disabled = false; reset(); return err(out.data.error) }
    ui.closeModal(); ui.toast(`Refunded ${money(amountCents)}`); onDone()
  })
}
