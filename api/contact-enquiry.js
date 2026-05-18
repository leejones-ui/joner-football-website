import { cleanString, protectForm } from './_security.js'

const FALLBACK_RECIPIENT_EMAIL = process.env.CONTACT_FORM_RECIPIENT_EMAIL || 'leejones@jonerfootball.com'

const TYPES = {
  'training-sydney': 'Training Enquiries (Sydney)',
  'game-analysis': 'Game Analysis Enquiries',
  general: 'General Enquiries',
  'joners-juniors': 'Joners Juniors Enquiries',
  'coaching-role': 'Apply For A Coaching Role',
  'team-subscriptions': 'Team Subscriptions Enquiry',
}

const RECIPIENTS = {
  'training-sydney': process.env.CONTACT_TRAINING_EMAIL || FALLBACK_RECIPIENT_EMAIL,
  'game-analysis': process.env.CONTACT_GAME_ANALYSIS_EMAIL || 'jonerfootballdean@gmail.com,trainingenquiries@jonerfootball.com,ligia@jonerfootball.com',
  general: process.env.CONTACT_GENERAL_EMAIL || FALLBACK_RECIPIENT_EMAIL,
  'joners-juniors': process.env.CONTACT_JUNIORS_EMAIL || FALLBACK_RECIPIENT_EMAIL,
  'coaching-role': process.env.CONTACT_COACHING_EMAIL || FALLBACK_RECIPIENT_EMAIL,
  'team-subscriptions': process.env.CONTACT_TEAM_SUBSCRIPTIONS_EMAIL || 'Reswin@jonerfootball.com,leejones@jonerfootball.com',
}

const BREVO_LIST_IDS = {
  'training-sydney': [Number(process.env.BREVO_TRAINING_LIST_ID || 6)],
  'game-analysis': [Number(process.env.BREVO_GAME_ANALYSIS_LIST_ID || 43)],
  general: [Number(process.env.BREVO_GENERAL_LIST_ID || 2), Number(process.env.BREVO_COACHES_LIST_ID || 39)],
  'joners-juniors': [Number(process.env.BREVO_JUNIORS_LIST_ID || 6)],
  'coaching-role': [Number(process.env.BREVO_COACHING_LIST_ID || process.env.BREVO_COACHES_LIST_ID || 39)],
  'team-subscriptions': [Number(process.env.BREVO_TEAM_SUBSCRIPTIONS_LIST_ID || 44)],
}

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

function parseRecipients(value) {
  return String(value || FALLBACK_RECIPIENT_EMAIL)
    .split(',')
    .map((email) => clean(email, 200).toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, name: 'Joner Football' }))
}

function cleanAttachment(file) {
  if (!file || typeof file !== 'object') return null
  const name = clean(file.name || 'cv', 180)
  const content = String(file.content || '').replace(/[^A-Za-z0-9+/=]/g, '')
  if (!name || !content) return null
  const bytes = Math.ceil((content.length * 3) / 4)
  if (bytes > 5 * 1024 * 1024) throw new Error('CV file is too large. Max 5MB.')
  return { name, content }
}

async function sendEmail(enquiry) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Email service is not configured.')

  const html = `
    <h2>New website contact enquiry</h2>
    <p><strong>${escapeHtml(enquiry.typeLabel)}</strong></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${row('Enquiry type', enquiry.typeLabel)}
      ${row('Name', enquiry.name)}
      ${row('Email', enquiry.email)}
      ${row('Phone', enquiry.phone)}
      ${row('Location', enquiry.location)}
      ${row('Player name', enquiry.playerName)}
      ${row('Player age', enquiry.playerAge)}
      ${row('Player level or team', enquiry.playerLevel)}
      ${row('Club / team', enquiry.clubTeam)}
      ${row('Number of players', enquiry.numberOfPlayers)}
      ${row('Number of coaches', enquiry.numberOfCoaches)}
      ${row('Training interest', enquiry.trainingInterest)}
      ${row('Junior program', enquiry.juniorProgram)}
      ${row('Main goal', enquiry.parentGoal)}
      ${row('Coaching experience', enquiry.coachingExperience)}
      ${row('Qualifications', enquiry.qualifications)}
      ${row('Availability', enquiry.availability)}
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
      to: parseRecipients(enquiry.recipientEmail),
      replyTo: { email: enquiry.email, name: enquiry.name },
      subject: `Website enquiry: ${enquiry.typeLabel}`,
      htmlContent: html,
      ...(enquiry.cvAttachment ? { attachment: [enquiry.cvAttachment] } : {}),
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Email send failed.')
  }
}

async function addMarketingOptIn(enquiry) {
  if (!enquiry.marketingOptIn && !['general', 'coaching-role', 'game-analysis', 'team-subscriptions'].includes(enquiry.type)) return
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Email service is not configured.')

  const listIds = (BREVO_LIST_IDS[enquiry.type] || (enquiry.type === 'general' ? BREVO_LIST_IDS.general : []))
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0)
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
        FIRSTNAME: enquiry.name,
        WEBSITE_SOURCE: `contact-${enquiry.type}`,
        CONTACT_ENQUIRY_TYPE: enquiry.typeLabel,
      },
      listIds,
      updateEnabled: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Brevo opt-in failed.')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const protection = await protectForm(req, res, 'contact-enquiry', body)
    if (!protection.ok) return protection.response

    const type = clean(body.enquiryType, 80)
    const typeLabel = TYPES[type] || TYPES.general
    const enquiry = {
      submittedAt: new Date().toISOString(),
      type,
      typeLabel,
      name: clean(body.name, 160),
      email: clean(body.email, 200).toLowerCase(),
      phone: clean(body.phone, 80),
      location: clean(body.location, 160),
      playerName: clean(body.playerName, 160),
      playerAge: clean(body.playerAge, 40),
      playerLevel: clean(body.playerLevel, 200),
      clubTeam: clean(body.clubTeam || body.club || '', 200),
      numberOfPlayers: clean(body.numberOfPlayers || body.players || '', 40),
      numberOfCoaches: clean(body.numberOfCoaches || body.coaches || '', 40),
      trainingInterest: clean(body.trainingInterest, 160),
      juniorProgram: clean(body.juniorProgram, 160),
      parentGoal: clean(body.parentGoal, 240),
      coachingExperience: clean(body.coachingExperience, 500),
      qualifications: clean(body.qualifications, 500),
      availability: clean(body.availability, 240),
      message: clean(body.message, 2500),
      cvAttachment: type === 'coaching-role' ? cleanAttachment(body.cvFile) : null,
      marketingOptIn: body.marketingOptIn === true || body.marketingOptIn === 'true' || body.marketingOptIn === 'on',
      recipientEmail: RECIPIENTS[type] || FALLBACK_RECIPIENT_EMAIL,
    }

    const requiresMessage = enquiry.type !== 'team-subscriptions'
    if (!enquiry.name || !enquiry.email || !enquiry.phone || (requiresMessage && !enquiry.message)) {
      return res.status(400).json({ success: false, error: 'Please complete all required fields.' })
    }

    if (type === 'team-subscriptions' && (!enquiry.clubTeam || !enquiry.numberOfPlayers || !enquiry.numberOfCoaches || !enquiry.location)) {
      return res.status(400).json({ success: false, error: 'Please complete all team subscription fields.' })
    }

    if (!validEmail(enquiry.email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' })
    }

    if ((type === 'training-sydney' || type === 'game-analysis' || type === 'joners-juniors') && (!enquiry.playerName || !enquiry.playerAge)) {
      return res.status(400).json({ success: false, error: 'Please add the player name and age.' })
    }

    if (type === 'coaching-role' && (!enquiry.coachingExperience || !enquiry.qualifications)) {
      return res.status(400).json({ success: false, error: 'Please add your coaching experience and qualifications.' })
    }

    await sendEmail(enquiry)
    try {
      await addMarketingOptIn(enquiry)
    } catch (optInError) {
      console.error('Contact opt-in failed:', optInError)
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Contact enquiry failed:', error)
    return res.status(500).json({ success: false, error: 'Enquiry could not be sent. Please try again.' })
  }
}
