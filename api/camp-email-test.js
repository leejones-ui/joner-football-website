import { renderCampPaidConfirmationEmail, renderCampUnpaidReminderEmail, sendCampTransactionalEmail, testCampEmailData } from './_camp-email-templates.js'

function sendJson(res, status, body) {
  res.status(status).json(body)
}

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, max)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendJson(res, 405, { success: false, error: 'Method not allowed' })
  }

  const secret = process.env.CAMP_EMAIL_TEST_SECRET
  if (!secret) return sendJson(res, 404, { success: false, error: 'Test email endpoint is not enabled.' })

  let body = {}
  if (typeof req.body === 'string') {
    body = JSON.parse(req.body || '{}')
  } else if (Buffer.isBuffer(req.body)) {
    body = JSON.parse(req.body.toString('utf8') || '{}')
  } else {
    body = req.body || {}
  }

  const providedSecret = body.secret || req.headers['x-camp-email-test-secret']
  if (providedSecret !== secret) return sendJson(res, 401, { success: false, error: 'Unauthorized' })

  const template = body.template === 'unpaid' ? 'unpaid' : 'confirmed'
  const toEmail = clean(body.toEmail || body.email, 200).toLowerCase()
  const toName = clean(body.toName || body.name || 'Lee', 120)
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail)) {
    return sendJson(res, 400, { success: false, error: 'Valid toEmail is required.' })
  }

  const data = testCampEmailData(body.data || {})
  if (body.previewOnly) {
    const rendered = template === 'unpaid' ? renderCampUnpaidReminderEmail(data) : renderCampPaidConfirmationEmail(data)
    return sendJson(res, 200, { success: true, template, subject: rendered.subject, html: rendered.html })
  }

  try {
    const result = await sendCampTransactionalEmail({ toEmail, toName, template, data })
    return sendJson(res, 200, { success: true, template, subject: result.subject })
  } catch (error) {
    console.error('Camp test email failed:', error)
    return sendJson(res, 500, { success: false, error: 'Could not send camp test email.' })
  }
}
