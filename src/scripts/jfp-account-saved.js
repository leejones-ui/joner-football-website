// My account > Fees: "Save a card or bank account for session payments"
// (Lee, 14 Oct 2026; claude/card-on-file). The family ticks the authority
// (and, for a bank account, the BECS Direct Debit Request), goes to Stripe to
// enter the card or account, and comes back here. We never see the numbers:
// Stripe keeps them, we show the brand and last 4 (or the bank's last 4).
// Saved: Replace and Remove, the players it pays for, and the latest charges.
import { esc, api, toast, openSheet, closeSheet } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'

let SAVED = null

const STATUS_TAG = { succeeded: 'green', processing: 'amber', failed: 'amber', action: 'amber', uncertain: 'grey' }

function savedHtml(v) {
  const pays = (v.players || []).filter((p) => p.perCents)
  const who = pays.length
    ? `<ul class="ja-saved-list">${pays.map((p) => `<li><b>${esc(p.name)}</b> <span class="ja-muted">${esc(p.perLabel)} a session${p.when ? `, ${esc(p.when)}` : ''}${p.paused ? ', paused by Joner Football' : ''}</span></li>`).join('')}</ul>`
    : '<p class="ja-small ja-muted">Right now none of your places is paid by the session, so nothing is charged to it.</p>'
  const recent = (v.recent || []).length
    ? `<ul class="ja-saved-list">${v.recent.map((x) => `<li><span>${esc(x.dateLabel)}, ${esc(x.player)}: ${esc(x.amountLabel)}</span> <span class="ja-tag ${STATUS_TAG[x.status] || 'grey'}">${esc(x.statusLabel)}</span>${x.payreqId ? ` <a class="ja-link" href="/jfp-account/?pay=${encodeURIComponent(x.payreqId)}">Pay now</a>` : ''}</li>`).join('')}</ul>`
    : ''
  if (v.method) {
    return `<article class="ja-card ja-saved" data-saved>
      <p class="ja-kicker"><i></i>${v.method.kind === 'bank' ? 'Direct debit on file' : 'Card on file'}</p>
      <h3 class="ja-h3" style="margin-top:8px">${esc(v.method.label)}</h3>
      <p class="ja-small ja-muted">${esc(v.method.detail || '')}${v.method.savedLabel ? `${v.method.detail ? '. ' : ''}Saved ${esc(v.method.savedLabel)}.` : ''}</p>
      <p class="ja-small" style="margin-top:10px">We charge it the day after each session, at the agreed price: session by session fees and extra sessions booked. You get a receipt each time. Sessions you told us about at least 24 hours before, and sessions already paid ahead, are not charged.${v.method.kind === 'bank' ? ' Direct debits take 2 to 3 business days to clear.' : ''}</p>
      <p class="ja-small ja-muted" style="margin-top:12px">It pays for:</p>${who}
      ${recent ? `<p class="ja-small ja-muted" style="margin-top:12px">Latest charges:</p>${recent}` : ''}
      <div class="ja-actions" style="margin-top:14px"><button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-saved-start>Replace</button><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-saved-remove>Remove</button></div>
    </article>`
  }
  return `<article class="ja-card ja-saved" data-saved>
    <p class="ja-kicker"><i></i>Session payments</p>
    <h3 class="ja-h3" style="margin-top:8px">Save a card or bank account for session payments</h3>
    <p class="ja-small" style="margin-top:6px">Paying by the session? Save a card (Apple Pay and Google Pay work too)${v.bank ? ' or an Australian bank account' : ''} once, and we charge it the day after each session: session by session fees and extra sessions booked. No payment links to chase.</p>
    ${v.other ? `<p class="ja-small ja-muted" style="margin-top:8px">${esc(v.other.label)} is saved by ${esc(v.other.email)} on this account and pays for your sessions. You can save your own here instead.</p>` : ''}
    ${pays.length ? `<p class="ja-small ja-muted" style="margin-top:12px">It would pay for:</p>${who}` : '<p class="ja-small ja-muted" style="margin-top:10px">Right now none of your places is paid by the session, so nothing would be charged until one is.</p>'}
    <div class="ja-actions" style="margin-top:14px"><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-saved-start="card">${ic('card')}Save a card</button>${v.bank ? '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-saved-start="bank">Save a bank account</button>' : ''}</div>
    <p class="ja-small ja-muted" style="margin-top:10px">Stripe keeps the card or account details. Joner Football never sees or stores the numbers. Remove it here any time.</p>
  </article>`
}

function consentSheet(v, kind) {
  const s = openSheet({ title: kind === 'bank' ? 'Save a bank account' : 'Save a card', subtitle: 'For session payments' })
  const bank = kind === 'bank'
  s.body.innerHTML = `
    <p class="ja-small">${bank ? 'You enter the BSB and account number on Stripe\'s secure page next. Direct debits take 2 to 3 business days to clear.' : 'You enter the card on Stripe\'s secure page next. Apple Pay and Google Pay work there too.'}</p>
    <label class="j-check" style="margin-top:12px"><input type="checkbox" id="sv-agree"> <span>${esc(bank ? v.consent.bank : v.consent.card)}</span></label>
    ${bank ? `<p class="ja-small ja-muted" style="margin-top:8px">${esc(v.consent.becsMandate)} <a class="ja-link" href="${esc(v.consent.becsAgreementUrl)}" target="_blank" rel="noopener">Direct Debit Request service agreement</a>.</p><p class="ja-small ja-muted">Ticking the box above also agrees to this Direct Debit Request.</p>` : ''}
    <p class="j-err" id="sv-err" hidden></p>`
  s.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="sv-go">Continue to Stripe</button>'
  s.foot.querySelector('#sv-go').addEventListener('click', async (ev) => {
    const err = s.body.querySelector('#sv-err')
    err.hidden = true
    if (!s.body.querySelector('#sv-agree').checked) { err.textContent = bank ? 'Tick the box to agree to the authority and the Direct Debit Request first.' : 'Tick the box to agree first.'; err.hidden = false; return }
    ev.currentTarget.disabled = true
    const r = await api('/api/jfp-account', { action: 'savedPaySetup', kind, agree: true })
    if (!r.ok || !r.data.url) { ev.currentTarget.disabled = false; err.textContent = r.data.error || 'Could not open Stripe. Try again.'; err.hidden = false; return }
    location.href = r.data.url
  })
}

function wire(el, v) {
  el.querySelectorAll('[data-saved-start]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.savedStart || ''
    if (kind) return consentSheet(v, kind)
    // Replace: choose a card or a bank account again.
    const s = openSheet({ title: 'Replace', subtitle: `Instead of ${v.method?.label || 'the saved one'}` })
    s.body.innerHTML = `<p class="ja-small">Save a new card${v.bank ? ' or bank account' : ''}. The one saved now is removed once the new one is saved.</p>`
    s.foot.innerHTML = `<div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-k="card">A card</button>${v.bank ? '<button type="button" class="ja-btn ja-btn-light" data-k="bank">A bank account</button>' : ''}</div>`
    s.foot.querySelectorAll('[data-k]').forEach((x) => x.addEventListener('click', () => { closeSheet(true); consentSheet(v, x.dataset.k) }))
  }))
  el.querySelector('[data-saved-remove]')?.addEventListener('click', () => {
    const s = openSheet({ title: 'Remove it?', subtitle: v.method?.label || '' })
    s.body.innerHTML = '<p class="ja-small">Nothing more is charged to it. Sessions from now on are paid in My account, Fees, as before.</p><p class="j-err" id="sv-rerr" hidden></p>'
    s.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="sv-rm">Remove</button>'
    s.foot.querySelector('#sv-rm').addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true
      const r = await api('/api/jfp-account', { action: 'savedPayRemove' })
      if (!r.ok) { ev.currentTarget.disabled = false; const e = s.body.querySelector('#sv-rerr'); e.textContent = r.data.error || 'Could not remove it. Try again.'; e.hidden = false; return }
      closeSheet(true)
      toast('Removed. Nothing more will be charged to it.')
      SAVED = null
      mountSavedPay(el.closest('[data-saved-mount]'))
    })
  })
}

// Draws into a container (Fees). Reads once, again after a change.
export async function mountSavedPay(mount) {
  if (!mount) return
  mount.dataset.savedMount = '1'
  if (!SAVED) {
    mount.innerHTML = '<div class="ja-card"><p class="ja-small ja-muted">Loading session payments.</p></div>'
    const r = await api('/api/jfp-account', { action: 'savedPay' })
    if (!r.ok) { mount.innerHTML = `<div class="ja-card"><p class="ja-small">${esc(r.data.error || 'Could not load session payments.')}</p></div>`; return }
    if (!r.data?.saved) { mount.innerHTML = ''; return }
    SAVED = r.data.saved
  }
  if (!mount.isConnected) return
  mount.innerHTML = savedHtml(SAVED)
  wire(mount, SAVED)
}
export function forgetSaved() { SAVED = null }

// Back from Stripe (?saved=<session>): save it, say so, open Fees.
export async function savedReturn(sessionId, banner) {
  if (!sessionId) return false
  if (banner) banner.innerHTML = '<div class="j-box j-box-grey" style="margin-bottom:16px">Saving with Stripe</div>'
  let r = null
  for (let i = 0; i < 5; i += 1) {
    r = await api('/api/jfp-account', { action: 'savedPayConfirm', sessionId })
    if (r.ok || !['pending', 'busy'].includes(r.data.code)) break
    await new Promise((res) => setTimeout(res, 2500))
  }
  history.replaceState(null, '', `${location.pathname}#fees`)
  SAVED = null
  if (banner) banner.innerHTML = r?.ok
    ? `<div class="j-box j-box-green" style="margin-bottom:16px"><b>${esc(r.data.method?.label || 'Saved')}.</b> We charge it the day after each session (session fees and extra sessions) and email you a receipt each time.</div>`
    : `<div class="j-box j-box-amber" style="margin-bottom:16px">${esc(r?.data?.error || 'Nothing was saved. Try again.')}</div>`
  return true
}
