// The invoice page (/jfp-invoice/?i=<token>). Shows this one invoice, then
// Pay by card (Stripe) or the bank details, and Download PDF (the designed PDF
// from the server, or the browser's print as an A4 invoice if that fails).
// After Stripe it checks the payment.
import { $, esc, api, savePdf } from './jfp-common.js'

const hero = (e, h, l) => { $('eyebrow').textContent = e; $('heading').textContent = h; $('lead').textContent = l }

export function invoiceHtml(x) {
  const stamp = x.status === 'paid' ? '<span class="ji-stamp paid">Paid</span>' : x.status === 'void' ? '<span class="ji-stamp void">Cancelled</span>' : x.status === 'part' ? '<span class="ji-stamp">Part paid</span>' : x.draft ? '<span class="ji-stamp">Draft</span>' : ''
  const b = x.business
  return `<div class="ji-top"><div><h2>Tax invoice</h2><p style="margin:6px 0 0;font-weight:700">${esc(x.number)}</p>${stamp}</div>
    <div class="ji-biz"><b>${esc(b.name)}</b><br>${esc(b.address)}<br>${esc(b.email)}${b.abn ? `<br>ABN ${esc(b.abn)}` : ''}</div></div>
    <div class="ji-meta">
      <div><span>Bill to</span>${esc(x.billTo.name || x.billTo.email)}${x.billTo.name ? `<br><small>${esc(x.billTo.email)}</small>` : ''}</div>
      ${x.players.length ? `<div><span>Player${x.players.length > 1 ? 's' : ''}</span>${esc(x.players.join(', '))}</div>` : ''}
      <div><span>Date</span>${esc(x.issueLabel)}</div>
      ${x.dueLabel ? `<div><span>Due</span>${esc(x.dueLabel)}</div>` : ''}
    </div>
    <table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
    <tbody>${x.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${l.qty}</td><td class="num">${esc(l.unitLabel)}</td><td class="num">${esc(l.totalLabel)}</td></tr>`).join('')}</tbody></table>
    <div class="ji-sum">
      <div class="ji-big"><span>Total (AUD)</span><span>${esc(x.totalLabel)}</span></div>
      <div class="ji-gst"><span>Includes GST of</span><span>${esc(x.gstLabel)}</span></div>
      ${x.paidCents ? `<div><span>Paid</span><span>${esc(x.paidLabel)}</span></div><div><b>To pay</b><b>${esc(x.owingLabel)}</b></div>` : ''}
    </div>
    ${x.notes ? `<p class="ji-notes">${esc(x.notes)}</p>` : ''}
    ${x.owingCents > 0 && x.status !== 'void' ? `<div class="ji-pay">
      <div><h3>Pay by card</h3>Use the Pay by card button on this invoice's page. Card or Apple Pay, through Stripe.</div>
      ${x.bank ? `<div><h3>Pay by bank transfer</h3>Account name: ${esc(x.bank.accountName)}<br>BSB: ${esc(x.bank.bsb)}<br>Account number: ${esc(x.bank.accountNumber)}<br>Reference: <b>${esc(x.bank.reference)}</b></div>` : ''}
    </div>` : ''}`
}

export async function initInvoice({ search = location.search, wait = (ms) => new Promise((r) => setTimeout(r, ms)), go = (url) => { location.href = url }, print = () => window.print() } = {}) {
  const q = new URLSearchParams(search)
  const token = q.get('i') || ''
  const sid = q.get('session_id') || ''
  // The designed PDF from the server; the browser's print if that fails.
  $('pdf').addEventListener('click', async () => {
    $('pdf').disabled = true
    const r = token ? await api('/api/jfp-invoice', { action: 'pdf', token }) : { ok: false }
    $('pdf').disabled = false
    if (r.ok && r.data.pdf) savePdf(r.data); else print()
  })
  if (!token) { hero('Invoice', 'Invoice not found', 'Open the invoice link you were sent.'); $('help').hidden = false; return }
  if (sid) return confirmLoop(token, sid, wait)
  const r = await api('/api/jfp-invoice', { action: 'view', token })
  if (!r.ok) { hero('Invoice', 'Invoice not found', r.data.error || 'Check the link, or contact Joner Football.'); $('help').hidden = false; return }
  show(r.data.invoice, token, go)
}

function draw(x) {
  $('doc').innerHTML = invoiceHtml(x)
  $('doc').hidden = false
  $('ji-actions').hidden = false
  document.title = `Invoice ${x.number} | Joner Football`
}

function show(x, token, go) {
  draw(x)
  if (x.status === 'paid') { hero('Invoice', 'Paid', 'This invoice is paid. Thank you.'); return }
  if (x.status === 'void') { hero('Invoice', 'This invoice was cancelled', 'Contact Joner Football if you have a question.'); return }
  hero('Invoice', `Invoice ${x.number}`, x.draft ? 'This invoice is a draft and cannot be paid yet.' : `${x.owingLabel} to pay${x.dueLabel ? ` by ${x.dueLabel}` : ''}.`)
  if (!x.canPayCard) return
  $('pay').textContent = `Pay ${x.owingLabel} by card`
  $('pay').hidden = false
  $('pay').onclick = async () => {
    $('pay').disabled = true
    $('err').hidden = true
    const r = await api('/api/jfp-invoice', { action: 'pay', token })
    if (r.ok && r.data.url) return go(r.data.url)
    $('pay').disabled = false
    $('err').textContent = r.data.error || 'Could not open the payment. Try again.'
    $('err').hidden = false
    if (['paid', 'closed', 'processing'].includes(r.data.code)) $('pay').hidden = true
  }
}

async function confirmLoop(token, sid, wait) {
  hero('Confirming payment', 'One moment', 'We are checking your payment with Stripe.')
  for (let tries = 1; tries <= 12; tries++) {
    const r = await api('/api/jfp-invoice', { action: 'confirm', token, sessionId: sid })
    if (r.status === 404 || r.status === 400) { hero('Invoice', 'Payment not found', 'If you paid, email us and we will find it.'); $('help').hidden = false; return }
    if (r.ok && r.data.invoice) draw(r.data.invoice)
    const st = r.data.status
    if (st === 'paid') { hero('Payment complete', 'Thank you', r.data.invoice?.owingCents ? `Your payment went through. ${r.data.invoice.owingLabel} is still to pay.` : 'Your payment went through. This invoice is paid.'); return }
    if (st === 'received') { hero('Payment received', 'We have your payment', 'This invoice had been changed before your payment went through, so Lee or Ligia will contact you. Do not pay again.'); return }
    if (st === 'expired') { hero('Invoice', 'Not paid', 'The payment page expired before it was finished. Nothing was charged.'); $('help').hidden = false; return }
    hero('Confirming payment', 'Almost there', 'Your payment is still processing. This page updates on its own.')
    await wait(5000)
  }
  hero('Confirming payment', 'Still checking', 'Your payment is taking longer than usual. Do not pay again.')
  $('help').hidden = false
}
