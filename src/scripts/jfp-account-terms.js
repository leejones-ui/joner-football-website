// The updated terms and cancelling an extra session (Lee, 5 Nov 2026).
// Every family ticks the terms once (asked again each visit until they do),
// ticks the extra session terms each time they book one, and can cancel a
// booked extra session here: 24 hours or more before, back what they paid
// less A$5; under 24 hours, no refund (api/_jfp-extra-cancel.js).
import { esc, api, openSheet, closeSheet, toast } from './jfp-common.js'

export const TERMS_URL = '/terms/#jfp-extra-sessions'
const EXTRA_LINES = [
  'Cancel at least 24 hours before the session starts and we refund what you paid, less a A$5 fee to cover card processing.',
  'Cancel less than 24 hours before, or miss the session, and it is not refunded.',
  'You can cancel in your account, under Extra sessions.',
]
const MAKEUP_LINE = 'There are no make-up sessions for sessions you miss, arrive late to or do not attend. If we cancel a session, you get a free make-up or a credit.'
const list = (lines) => `<ul class="ja-small" style="margin:6px 0 0 18px;display:flex;flex-direction:column;gap:6px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`

// The box under Book and pay. Required before the booking goes through.
export function extraTermsTick() {
  return `<div class="j-field" style="margin:0"><p class="ja-small"><b>Extra sessions: cancelling and refunds</b></p>${list(EXTRA_LINES)}
    <label class="j-check" style="margin-top:8px"><input type="checkbox" data-xterms> <span>I accept the extra session terms. <a class="ja-link" href="${TERMS_URL}" target="_blank" rel="noopener">Read the full terms</a></span></label></div>`
}

// Once for everyone: JFP sessions (no make-ups) and the extra session terms.
export function askTerms(D) {
  if (!D?.termsAsk) return false
  const sheet = openSheet({ title: 'Our updated terms', subtitle: 'Please read and tick to carry on' })
  sheet.body.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
    <div><p class="ja-small"><b>JFP sessions: make-ups</b></p>${list([MAKEUP_LINE])}</div>
    <div><p class="ja-small"><b>Extra sessions: cancelling and refunds</b></p>${list(EXTRA_LINES)}</div>
    <p class="ja-small"><a class="ja-link" href="${TERMS_URL}" target="_blank" rel="noopener">Read the full terms</a></p>
    <label class="j-check"><input type="checkbox" data-terms-ok> <span>I have read and accept the Joner Football terms.</span></label>
    <p class="j-err" data-terms-err hidden></p></div>`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" data-terms-go>I agree</button>'
  const go = sheet.foot.querySelector('[data-terms-go]')
  go.addEventListener('click', async () => {
    const err = sheet.body.querySelector('[data-terms-err]')
    if (!sheet.body.querySelector('[data-terms-ok]').checked) { err.textContent = 'Tick the box to accept the terms.'; err.hidden = false; return }
    go.disabled = true
    const r = await api('/api/jfp-account', { action: 'acceptTerms' })
    go.disabled = false
    if (!r.ok) { err.textContent = r.data?.error || 'Could not save that. Try again.'; err.hidden = false; return }
    D.termsAsk = null
    closeSheet()
    toast('Thanks. Saved.')
  })
  return true
}

export const makeupLine = () => `<p class="ja-small ja-muted">${esc(MAKEUP_LINE)}</p>`

// Cancel a booked extra session: what they get back first, then confirm.
export function cancelExtraSheet(x, onDone) {
  const c = x.cancel
  if (!c) return
  const sheet = openSheet({ title: 'Cancel this extra session', subtitle: `${x.dateLabel} · ${x.time} · ${x.players.join(', ')}` })
  const what = !c.paid
    ? 'It is not paid yet, so there is nothing to refund.'
    : c.late
      ? `<b>This is less than 24 hours before the session, so there is no refund.</b> The ${esc(c.paidLabel)} you paid is not returned.`
      : `<b>You will get ${esc(c.refundLabel)} back</b> to the card you paid with. We keep A$5 to cover card processing. It usually shows in 5 to 10 business days.`
  sheet.body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
    <div class="j-box ${c.paid && c.late ? 'j-box-amber' : 'j-box-green'}">${what}</div>
    <p class="ja-small">Your place is given up and the coach is told straight away. This cannot be undone, but you can book again if there is still a place.</p>
    <p class="j-err" data-xc-err hidden></p></div>`
  sheet.foot.innerHTML = `<button type="button" class="ja-btn ja-btn-red ja-btn-block" data-xc-go>Cancel the session${c.paid && !c.late ? ` and refund ${esc(c.refundLabel)}` : ''}</button><button type="button" class="ja-btn ja-btn-light ja-btn-block" data-xc-keep>Keep it</button>`
  sheet.foot.querySelector('[data-xc-keep]').addEventListener('click', () => closeSheet())
  const go = sheet.foot.querySelector('[data-xc-go]')
  go.addEventListener('click', async () => {
    const err = sheet.body.querySelector('[data-xc-err]')
    err.hidden = true
    go.disabled = true
    go.textContent = 'Cancelling'
    const r = await api('/api/jfp-account', { action: 'cancelExtra', slotId: x.id, confirm: true })
    if (!r.ok) { go.disabled = false; go.textContent = 'Try again'; err.textContent = r.data?.error || 'Could not cancel that. Try again.'; err.hidden = false; return }
    closeSheet()
    toast(r.data.refundCents ? `Cancelled. ${r.data.refundLabel} is on its way back to you.` : 'Cancelled. The coach has been told.')
    onDone?.()
  })
}
