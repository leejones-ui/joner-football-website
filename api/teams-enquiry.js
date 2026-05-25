import { cleanString, protectForm } from './_security.js'

// TODO: ASK LEE: Confirm the final Brevo list. Defaults to existing Team Subscriptions list 44.
const TEAM_SUBSCRIPTIONS_LIST_ID = Number(process.env.BREVO_TEAM_SUBSCRIPTIONS_LIST_ID || 44)
const FALLBACK_RECIPIENTS = 'Reswin@jonerfootball.com,leejones@jonerfootball.com'

function clean(value, max = 1000) {
  return cleanString(value, max)
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

function row(label, value) {
  if (!value) return ''
  return `<tr><td style="font-weight:bold;vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
}

function recipients() {
  return String(process.env.TEAMS_ENQUIRY_RECIPIENT_EMAIL || process.env.CONTACT_TEAM_SUBSCRIPTIONS_EMAIL || FALLBACK_RECIPIENTS)
    .split(',')
    .map((email) => clean(email, 200).toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, name: 'Joner Football' }))
}

async function sendNotification(enquiry) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Enquiry service is not configured.')

  const html = `
    <h2>New Team Subscription enquiry</h2>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${row('Full name', enquiry.fullName)}
      ${row('Club / Organisation', enquiry.organisation)}
      ${row('Role', enquiry.role)}
      ${row('Email', enquiry.email)}
      ${row('Number of players', enquiry.numberOfPlayers)}
      ${row('Country', enquiry.country)}
      ${row('Message', enquiry.message)}
      ${row('Submitted at', enquiry.submittedAt)}
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
      to: recipients(),
      replyTo: { email: enquiry.email, name: enquiry.fullName },
      subject: `Team subscription enquiry: ${enquiry.fullName}`,
      htmlContent: html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Email send failed.')
  }
}

async function addBrevoContact(enquiry) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Enquiry service is not configured.')
  const listIds = Number.isFinite(TEAM_SUBSCRIPTIONS_LIST_ID) && TEAM_SUBSCRIPTIONS_LIST_ID > 0
    ? [TEAM_SUBSCRIPTIONS_LIST_ID]
    : []
  if (!listIds.length) return

  const response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      email: enquiry.email,
      attributes: {
        FIRSTNAME: enquiry.fullName,
        WEBSITE_SOURCE: 'draft-teams-enquiry',
        CONTACT_ENQUIRY_TYPE: 'Team Subscriptions Enquiry',
      },
      listIds,
      updateEnabled: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Brevo contact sync failed.')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const protection = await protectForm(req, res, 'teams-enquiry', body)
    if (!protection.ok) return protection.response

    const enquiry = {
      submittedAt: new Date().toISOString(),
      fullName: clean(body.fullName || body.name, 160),
      organisation: clean(body.organisation || body.clubTeam || body.club, 200),
      role: clean(body.role, 160),
      email: clean(body.email, 200).toLowerCase(),
      numberOfPlayers: clean(body.numberOfPlayers, 40),
      country: clean(body.country, 120),
      message: clean(body.message, 2500),
    }

    if (!enquiry.fullName || !enquiry.organisation || !enquiry.role || !enquiry.email || !enquiry.numberOfPlayers || !enquiry.country || !enquiry.message) {
      return res.status(400).json({ success: false, error: 'Please complete all required fields.' })
    }

    if (!validEmail(enquiry.email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' })
    }

    await sendNotification(enquiry)

    try {
      await addBrevoContact(enquiry)
    } catch (syncError) {
      console.error('Teams enquiry Brevo contact sync failed:', syncError)
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Teams enquiry failed:', error)
    return res.status(500).json({ success: false, error: 'Enquiry could not be sent. Please try again.' })
  }
}
