const RECIPIENT_EMAIL = 'joner1on1info@gmail.com'

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim())
}

function escapeHtml(value) {
  return clean(value, 4000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function sendBrevoEmail(application) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Email service is not configured.')

  const rows = [
    ['Camp', application.camp],
    ['Player full name', application.playerFullName],
    ['Parent full name', application.parentFullName],
    ['Age', application.playerAge],
    ['Club or team', application.playFor],
    ['Mobile number', application.mobileNumber],
    ['Email address', application.email],
    ['Worked with us before', application.workedBefore],
    ['How they heard about it', application.hearAbout],
    ['Application message', application.applicationMessage],
    ['Submitted at', application.submittedAt],
  ]

  const html = `
    <h2>New selection application</h2>
    <p><strong>${escapeHtml(application.camp)}</strong></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join('')}
    </table>
  `

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: 'Joner Football Website',
        email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com',
      },
      to: [{ email: RECIPIENT_EMAIL, name: 'Joner Football' }],
      replyTo: [{ email: application.email, name: application.parentFullName || application.playerFullName }],
      subject: `Selection application: ${application.playerFullName} for ${application.camp}`,
      htmlContent: html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Email send failed.')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const application = {
      submittedAt: new Date().toISOString(),
      camp: clean(body.camp || 'LA Complete Player Experience', 160),
      playerFullName: clean(body.playerFullName, 160),
      parentFullName: clean(body.parentFullName, 160),
      playerAge: clean(body.playerAge, 20),
      playFor: clean(body.playFor, 200),
      mobileNumber: clean(body.mobileNumber, 60),
      email: clean(body.email, 200).toLowerCase(),
      workedBefore: clean(body.workedBefore, 120),
      hearAbout: clean(body.hearAbout, 240),
      applicationMessage: clean(body.applicationMessage, 2000),
    }

    if (!application.playerFullName || !application.playerAge || !application.playFor || !application.mobileNumber || !application.email || !application.hearAbout || !application.applicationMessage) {
      return res.status(400).json({ success: false, error: 'Please complete all required fields.' })
    }

    if (!validEmail(application.email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' })
    }

    await sendBrevoEmail(application)
    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Selection application failed:', error)
    return res.status(500).json({ success: false, error: 'Application could not be sent. Please try again.' })
  }
}
