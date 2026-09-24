import crypto from 'node:crypto'
import { buildCapture, captureWebsiteContact, listCaptureOutbox, replayCapture } from './_master-contact-capture.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function authorised(req) {
  const expected = process.env.MASTER_CONTACT_CAPTURE_REPLAY_SECRET
  const supplied = String(req.headers?.['x-master-capture-secret'] || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '')
  return Boolean(expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied) && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)))
}
function json(res, status, body) { return res.status(status).json(body) }

// Operator-only, notification-free verification/replay endpoint. It never
// calls Brevo, Sheets, Stripe, or any customer-facing email code.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { success: false, error: 'Method not allowed' }) }
  if (!authorised(req)) return json(res, 401, { success: false, error: 'Unauthorized' })
  try {
    const body = parse(req)
    if (body.action === 'dryRun') {
      const result = buildCapture(body.payload || body)
      return json(res, 200, { success: true, notificationFree: true, result })
    }
    if (body.action === 'list') return json(res, 200, { success: true, notificationFree: true, outbox: await listCaptureOutbox(Number(body.limit || 20), String(body.cursor || '0')) })
    if (body.action === 'replay') {
      if (!body.id) return json(res, 400, { success: false, error: 'id is required.' })
      return json(res, 200, { success: true, notificationFree: true, result: await replayCapture(body.id) })
    }
    if (body.action === 'capture') {
      if (!body.payload || typeof body.payload !== 'object') return json(res, 400, { success: false, error: 'payload is required.' })
      return json(res, 200, { success: true, notificationFree: true, result: await captureWebsiteContact(body.payload) })
    }
    return json(res, 400, { success: false, error: 'Use action=dryRun, capture, list, or replay.' })
  } catch (error) {
    console.error('Master contact capture replay failed')
    return json(res, 500, { success: false, error: 'Replay failed.' })
  }
}
