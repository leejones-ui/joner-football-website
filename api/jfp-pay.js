// The page a quick payment link opens (/jfp-pay/?q=PAY-...), Lee, 13 Oct 2026.
// Anyone with the link can pay it, with no sign-in, so this shows only what it
// is for and how much: never a name or an email.
//
//   view     what the link is for, its amount, and whether it can be paid
//   pay      a Stripe Checkout Session on the Sydney account, the same way
//            every JFP link is paid (metadata.jfpBookingId = the link)
//   confirm  after Stripe: is it paid? Records it if the webhook has not yet
import { stripeFetch, siteUrl } from './_holiday-store.js'
import { getPayreq, savePayreq, closeCheckout, kvPipeline, clean } from './_jfp-store.js'
import { finaliseJfpBooking, jfpBookingIdFromSession } from './_jfp-finalise.js'
import { sameOrigin } from './_jfp-people.js'
import { rateLimit } from './_security.js'
import { QUICK_ID, quickOpen, quickCheckoutBody, publicQuick } from './_jfp-quick.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

// Only a quick link is ever found here; any other payment is "not found".
async function quickLink(id) {
  const c = clean(id, 60)
  if (!QUICK_ID.test(c)) return null
  const q = await getPayreq(c)
  return q?.quick ? q : null
}

async function view(res, q) {
  // Counted on its own key, never by rewriting the link (as the account page does).
  if (quickOpen(q)) await kvPipeline([['HINCRBY', 'jfp:payreq-views', q.id, '1'], ['HSET', 'jfp:payreq-viewed-at', q.id, new Date().toISOString()]])
  return res.status(200).json({ success: true, link: publicQuick(q) })
}

async function pay(req, res, q) {
  if (q.status === 'paid') return fail(res, 409, 'This is already paid. Thank you.', { code: 'paid' })
  if (!quickOpen(q)) return fail(res, 410, q.status === 'cancelled' ? 'This payment link was cancelled. Contact Joner Football for a new one.' : 'This payment link has expired. Contact Joner Football and we will send a new one.', { code: 'closed' })
  // Paying again after going back from Stripe: close the first page first,
  // so one link can never be paid twice.
  if (q.status === 'checkout' && q.stripeSessionId) {
    const closed = await closeCheckout(q.stripeSessionId)
    if (closed === 'complete') return fail(res, 409, 'This payment has gone through and is being processed. Refresh in a minute.', { code: 'processing' })
    if (closed === 'error') return fail(res, 503, 'Could not check your earlier payment. Try again in a minute.')
  }
  const base = siteUrl(req)
  const session = await stripeFetch('/checkout/sessions', { method: 'POST', body: quickCheckoutBody(q, base) })
  // Staff may have changed or cancelled it while this page was opening.
  const now = await getPayreq(q.id)
  if (!now || now.amountCents !== q.amountCents || !['open', 'checkout'].includes(now.status)) {
    await closeCheckout(session.id)
    return fail(res, 409, 'This payment was just updated. Refresh the page and try again.', { code: 'changed' })
  }
  await savePayreq({ ...now, status: 'checkout', stripeSessionId: session.id, siteUrl: base })
  return res.status(200).json({ success: true, url: session.url })
}

async function confirm(res, q, sessionId) {
  const sid = clean(sessionId, 120)
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return fail(res, 400, 'Missing session')
  let session = null
  try { session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sid)}`) } catch (error) {
    if (/No such/i.test(error.message)) return fail(res, 404, 'Payment not found.')
    throw error
  }
  if (jfpBookingIdFromSession(session) !== q.id) return fail(res, 404, 'Payment not found.')
  let status = 'pending'
  if (session.payment_status === 'paid') {
    const r = await finaliseJfpBooking(q.id, session)
    status = r.attention ? 'received' : r.busy ? 'pending' : 'paid'
  } else if (session.status === 'expired') status = 'expired'
  return res.status(200).json({ success: true, status, link: publicQuick(await getPayreq(q.id) || q) })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  const limited = rateLimit(req, { key: 'jfp-pay', limit: 30, windowMs: 60_000 })
  if (!limited.allowed) return fail(res, 429, 'Slow down a moment, then try again.')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const q = await quickLink(body.id)
    if (!q) return fail(res, 404, 'We could not find that payment link. Check the link, or contact Joner Football.')
    if (body.action === 'view') return await view(res, q)
    if (body.action === 'pay') return await pay(req, res, q)
    if (body.action === 'confirm') return await confirm(res, q, body.sessionId)
    return fail(res, 400, 'Unknown action')
  } catch (error) {
    console.error('jfp-pay failed', error)
    return fail(res, 500, 'Something went wrong. Try again in a moment.')
  }
}
