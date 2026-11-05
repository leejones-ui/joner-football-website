// The whole term on the Overview (Lee, 5 Nov 2026: "i need a full figure of
// what that term brings in"). JFP fees (Stripe after refunds, bank and cash,
// Pro sessions included), plus Joners Juniors collected this term (after
// refunds), plus Extra sessions paid since the term's money started (after
// refunds). Each part comes from the same reading its own Money view uses.
import { esc, money } from './jfp-common.js'

// jfpCents: Income this term. since: 'YYYY-MM-DD' the term's money starts.
// juniors: Juniors money data or null/undefined. extra: Extra sessions data or null/undefined.
export function wholeTerm({ jfpCents = 0, since = '', juniors, extra }) {
  const jt = juniors?.byTerm?.[juniors.currentTerm]
  const from = String(since || '').slice(0, 10)
  const lines = (extra?.lines || []).filter((x) => !from || (x.paidDate || '') >= from)
  const parts = [
    { key: 'jfp', label: 'JFP fees', cents: jfpCents, ready: true },
    { key: 'juniors', label: 'Joners Juniors', cents: jt ? jt.collectedCents || 0 : 0, ready: juniors !== undefined, failed: juniors === null },
    { key: 'extra', label: 'Extra sessions', cents: lines.reduce((t, x) => t + (x.takenCents || 0) - (x.refundedCents || 0), 0), ready: extra !== undefined, failed: extra === null },
  ]
  return { parts, totalCents: parts.reduce((t, p) => t + (p.failed ? 0 : p.cents), 0), waiting: parts.filter((p) => !p.ready).map((p) => p.label), failed: parts.filter((p) => p.failed).map((p) => p.label) }
}

export function wholeTermHtml(w) {
  return `<p class="lbl">Whole term brings in</p><p class="big" id="d-whole-total">${esc(money(w.totalCents))}</p>
    <p class="jm-sum" id="d-whole-parts">${w.parts.map((p) => `<span>${esc(p.label)} <b>${p.ready ? (p.failed ? 'not read' : esc(money(p.cents))) : '…'}</b></span>`).join(' · ')}</p>
    <p class="muted small">After refunds.${w.waiting.length ? ` Adding ${esc(w.waiting.join(' and '))}.` : ''}${w.failed.length ? ` ${esc(w.failed.join(' and '))} could not be read just now, so not counted.` : ''}</p>`
}
