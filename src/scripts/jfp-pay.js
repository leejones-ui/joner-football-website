// The quick payment link page (/jfp-pay/?q=PAY-...). Shows what it is for
// and how much, then sends the family to Stripe. After Stripe it checks the
// payment and says thank you. Never shows a name or an email.
import { $, esc, api } from './jfp-common.js'

const hero = (e, h, l) => { $('eyebrow').textContent = e; $('heading').textContent = h; $('lead').textContent = l }
const details = (x) => {
  $('details').innerHTML = [['For', x.forText], ['Amount', x.amountLabel]].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
  $('card').hidden = false
}

export async function initPay({ search = location.search, wait = (ms) => new Promise((r) => setTimeout(r, ms)), go = (url) => { location.href = url } } = {}) {
  const q = new URLSearchParams(search)
  const id = q.get('q') || ''
  const sid = q.get('session_id') || ''
  if (!id) { hero('Payment', 'Link not found', 'Open the payment link you were sent.'); $('help').hidden = false; return }
  if (sid) return confirmLoop(id, sid, wait)
  const r = await api('/api/jfp-pay', { action: 'view', id })
  if (!r.ok) { hero('Payment', 'Link not found', r.data.error || 'Check the link, or contact Joner Football.'); $('help').hidden = false; return }
  show(r.data.link, id, go)
}

function show(x, id, go) {
  details(x)
  if (x.status === 'paid') { hero('Payment complete', 'Already paid', 'This payment has been made. Thank you.'); return }
  if (x.status !== 'open') { hero('Payment', x.status === 'cancelled' ? 'This link was cancelled' : 'This link has expired', 'Contact Joner Football and we will send a new one.'); $('help').hidden = false; return }
  hero(x.programme === 'Other' ? 'Joner Football' : x.programme, 'Your payment', 'Check what it is for, then pay.')
  $('pay').textContent = `Pay ${x.amountLabel}`
  $('pay').hidden = false
  $('how').textContent = `Secure payment by Stripe. ${x.afterpay ? 'Card, Apple Pay or Afterpay.' : 'Card or Apple Pay.'}`
  $('how').hidden = false
  $('pay').onclick = async () => {
    $('pay').disabled = true
    $('err').hidden = true
    const r = await api('/api/jfp-pay', { action: 'pay', id })
    if (r.ok && r.data.url) return go(r.data.url)
    $('pay').disabled = false
    $('err').textContent = r.data.error || 'Could not open the payment. Try again.'
    $('err').hidden = false
    if (r.data.code === 'paid' || r.data.code === 'closed') $('pay').hidden = true
  }
}

async function confirmLoop(id, sid, wait) {
  hero('Confirming payment', 'One moment', 'We are checking your payment with Stripe.')
  for (let tries = 1; tries <= 12; tries++) {
    const r = await api('/api/jfp-pay', { action: 'confirm', id, sessionId: sid })
    if (r.status === 404 || r.status === 400) { hero('Payment', 'Payment not found', 'If you paid, email us and we will find it.'); $('help').hidden = false; return }
    const st = r.data.status
    if (r.ok && r.data.link) details(r.data.link)
    if (st === 'paid') { hero('Payment complete', 'Thank you', 'Your payment went through.'); $('details').insertAdjacentHTML('beforeend', `<dt>Reference</dt><dd>${esc(id)}</dd>`); return }
    if (st === 'received') { hero('Payment received', 'We have your payment', 'This link had been closed before your payment went through, so Lee or Ligia will contact you. Do not pay again.'); return }
    if (st === 'expired') { hero('Payment', 'Not paid', 'The payment page expired before it was finished. Nothing was charged.'); $('help').hidden = false; return }
    hero('Confirming payment', 'Almost there', 'Your payment is still processing. This page updates on its own.')
    await wait(5000)
  }
  hero('Confirming payment', 'Still checking', 'Your payment is taking longer than usual. Do not pay again.')
  $('help').hidden = false
}
