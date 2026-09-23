// Stripe tells us a holiday Checkout Session completed or expired.
//
// Registered on the Sydney account as its own endpoint with its own signing
// secret. Any event that is not a holiday booking gets a 200 and is ignored,
// because a 4xx would make Stripe retry forever and eventually disable the
// endpoint. If the signature cannot be verified we do not trust the payload:
// we re-read the session from Stripe's API and act on that instead.
import { verifyStripeWebhook } from './_stripe-webhook.js'
import { stripeFetch, clean } from './_holiday-store.js'
import { finaliseBooking, expireBooking, bookingIdFromSession } from './_holiday-finalise.js'
import { finaliseJfpBooking, expireJfpBooking, jfpBookingIdFromSession } from './_jfp-finalise.js'

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && Object.keys(req.body).length) return JSON.stringify(req.body)
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  const rawBody = await readRawBody(req)
  const signature = req.headers['stripe-signature']
  const secret = process.env.STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY || ''

  let verified = false
  if (secret && signature) {
    try {
      await verifyStripeWebhook(rawBody, signature, secret)
      verified = true
    } catch (error) {
      console.warn('holiday webhook signature failed', error.message)
    }
  }

  let event
  try { event = JSON.parse(rawBody || '{}') } catch { return res.status(400).json({ success: false, error: 'Invalid payload' }) }

  const type = clean(event?.type, 80)
  const sessionIdFromEvent = clean(event?.data?.object?.id, 120)
  if (!type.startsWith('checkout.session.') || !/^cs_(test|live)_/.test(sessionIdFromEvent)) {
    return res.status(200).json({ success: true, ignored: 'not-a-checkout-session' })
  }

  // Whether or not the signature checked out, the session we act on comes
  // from Stripe's own API, never from the request body.
  let session
  try {
    session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionIdFromEvent)}`)
  } catch (error) {
    console.error('holiday webhook could not read session', error)
    return res.status(verified ? 500 : 200).json({ success: false, error: 'Could not read session' })
  }

  // One Stripe endpoint on the Sydney account serves both booking systems;
  // the session's own metadata says which one it belongs to.
  const jfpId = jfpBookingIdFromSession(session)
  if (jfpId) {
    try {
      if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
        if (session.payment_status !== 'paid') return res.status(200).json({ success: true, skipped: 'not-paid', jfpId })
        const r = await finaliseJfpBooking(jfpId, session)
        return res.status(200).json({ success: true, jfpId, already: r.already === true, verified })
      }
      if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
        const r = await expireJfpBooking(jfpId)
        return res.status(200).json({ success: true, jfpId, released: r.changed, verified })
      }
      return res.status(200).json({ success: true, ignored: type })
    } catch (error) {
      console.error('jfp webhook failed', error)
      return res.status(500).json({ success: false, error: 'Webhook processing failed' })
    }
  }

  const bookingId = bookingIdFromSession(session)
  if (!bookingId) return res.status(200).json({ success: true, ignored: 'not-holiday' })

  try {
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      if (session.payment_status !== 'paid') return res.status(200).json({ success: true, skipped: 'not-paid', bookingId })
      const result = await finaliseBooking(bookingId, session)
      return res.status(200).json({ success: true, bookingId, already: result.already === true, verified })
    }
    if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
      const result = await expireBooking(bookingId)
      return res.status(200).json({ success: true, bookingId, released: result.changed, verified })
    }
    return res.status(200).json({ success: true, ignored: type })
  } catch (error) {
    console.error('holiday webhook failed', error)
    return res.status(500).json({ success: false, error: 'Webhook processing failed' })
  }
}
