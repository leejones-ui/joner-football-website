// The invoice page (/jfp-invoice/?i=<token>), Lee, 14 Oct 2026. Anyone with
// the link can see and pay this one invoice, with no sign-in: the token is
// unguessable and only ever finds its own invoice, and the page gets nothing
// about any other family.
//
//   view     the invoice, its lines, GST, what is paid and owing, how to pay
//   pay      a Stripe Checkout Session tied to the invoice and the player
//            (metadata.jfpBookingId = the invoice's payment request)
//   confirm  after Stripe: is it paid? Records it if the webhook has not yet
import { stripeFetch, siteUrl } from './_holiday-store.js'
import { getConfig, getPayreq, savePayreq, closeCheckout, kvCommand, clean } from './_jfp-store.js'
import { finaliseJfpBooking, jfpBookingIdFromSession } from './_jfp-finalise.js'
import { sameOrigin } from './_jfp-people.js'
import { rateLimit } from './_security.js'
import { invoiceByToken, publicInvoice, invoiceCheckoutBody, owingOf, invoiceStatus, VIEWED, getInvoice } from './_jfp-invoices.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

async function view(res, inv, config) {
  // Seen by the family (not a draft staff are looking at): counted on its own hash.
  if (inv.issuedAt && !inv.voidedAt) await kvCommand(['HSETNX', VIEWED, inv.id, new Date().toISOString()])
  const viewedAt = await kvCommand(['HGET', VIEWED, inv.id])
  return res.status(200).json({ success: true, invoice: publicInvoice(inv, config, { viewedAt: viewedAt || '' }) })
}

async function pay(req, res, inv) {
  const st = invoiceStatus(inv)
  if (st === 'paid') return fail(res, 409, 'This invoice is paid. Thank you.', { code: 'paid' })
  if (st === 'void') return fail(res, 410, 'This invoice was cancelled. Contact Joner Football.', { code: 'closed' })
  if (st === 'draft' || !inv.payreqId) return fail(res, 409, 'This invoice is not ready to pay yet.', { code: 'draft' })
  let q = await getPayreq(inv.payreqId)
  if (!q || q.status === 'cancelled') return fail(res, 410, 'This invoice can no longer be paid online. Contact Joner Football.', { code: 'closed' })
  if (q.status === 'paid') return fail(res, 409, 'This invoice has just been paid. Refresh in a minute.', { code: 'processing' })
  // Paying again after going back from Stripe: close the first page first.
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'This payment has gone through and is being processed. Refresh in a minute.', { code: 'processing' })
    if (closed === 'error') return fail(res, 503, 'Could not check your earlier payment. Try again in a minute.')
  }
  const owing = owingOf(inv)
  if (q.amountCents !== owing) { q = { ...q, amountCents: owing, status: 'open', stripeSessionId: '' }; await savePayreq(q) }
  const base = siteUrl(req)
  const session = await stripeFetch('/checkout/sessions', { method: 'POST', body: invoiceCheckoutBody(inv, q, base) })
  // Staff may have recorded a payment or voided it while this page was opening.
  const [now, fresh] = await Promise.all([getPayreq(q.id), getInvoice(inv.id)])
  if (!now || !fresh || now.amountCents !== owingOf(fresh) || !['open', 'checkout'].includes(now.status) || fresh.voidedAt) {
    await closeCheckout(session.id)
    return fail(res, 409, 'This invoice was just updated. Refresh the page and try again.', { code: 'changed' })
  }
  await savePayreq({ ...now, status: 'checkout', stripeSessionId: session.id, siteUrl: base })
  return res.status(200).json({ success: true, url: session.url })
}

async function confirm(res, inv, config, sessionId) {
  const sid = clean(sessionId, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return fail(res, 400, 'Missing session')
  let session = null
  try { session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sid)}`) } catch (error) {
    if (/No such/i.test(error.message)) return fail(res, 404, 'Payment not found.')
    throw error
  }
  if (!inv.payreqId || jfpBookingIdFromSession(session) !== inv.payreqId) return fail(res, 404, 'Payment not found.')
  let status = 'pending'
  if (session.payment_status === 'paid') {
    const r = await finaliseJfpBooking(inv.payreqId, session)
    status = r.attention ? 'received' : r.busy ? 'pending' : 'paid'
  } else if (session.status === 'expired') status = 'expired'
  return res.status(200).json({ success: true, status, invoice: publicInvoice((await getInvoice(inv.id)) || inv, config) })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  const limited = rateLimit(req, { key: 'jfp-invoice', limit: 30, windowMs: 60_000 })
  if (!limited.allowed) return fail(res, 429, 'Slow down a moment, then try again.')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const inv = await invoiceByToken(body.token)
    if (!inv) return fail(res, 404, 'We could not find that invoice. Check the link, or contact Joner Football.')
    const config = await getConfig()
    if (body.action === 'view') return await view(res, inv, config)
    if (body.action === 'pay') return await pay(req, res, inv)
    if (body.action === 'confirm') return await confirm(res, inv, config, body.sessionId)
    return fail(res, 400, 'Unknown action')
  } catch (error) {
    console.error('jfp-invoice failed', error)
    return fail(res, 500, 'Something went wrong. Try again in a moment.')
  }
}
