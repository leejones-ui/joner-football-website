import { cleanString, protectForm } from './_security.js'
import { validateEmailFormat, validateEmailQuality } from './_email-quality.js'

const FALLBACK_RECIPIENT_EMAIL = process.env.CONTACT_FORM_RECIPIENT_EMAIL || 'leejones@jonerfootball.com'
const duplicateBuckets = new Map()
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_WAIVER_TABLE = 'Player Onboarding & Waiver'

const TYPES = {
  'training-sydney': 'Training Enquiries (Sydney)',
  'game-analysis': 'Game Analysis Enquiries',
  general: 'General Enquiries',
  'joners-juniors': 'Joners Juniors Enquiries',
  'coaching-role': 'Apply For A Coaching Role',
  'team-subscriptions': 'Team Subscriptions Enquiry',
  'player-waiver': 'Player Onboarding & Waiver',
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
  return validateEmailFormat(value).ok
}

function looksLikePlayerAge(value) {
  const text = clean(value, 40).toLowerCase()
  if (!text) return false
  if (/^(u|under\s*)?([3-9]|1[0-9]|2[0-5])\s*(years?|yrs?|yo)?$/.test(text)) return true
  if (/^([3-9]|1[0-9]|2[0-5])\s*[-/]\s*([3-9]|1[0-9]|2[0-5])$/.test(text)) return true
  return false
}

function looksLikeRandomToken(value) {
  const text = clean(value, 500)
  if (text.length < 12) return false
  if (/\s/.test(text)) return false
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return false
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters.length < 10) return false
  const hasLower = /[a-z]/.test(text)
  const hasUpper = /[A-Z]/.test(text)
  const hasDigit = /\d/.test(text)
  const vowelRatio = (letters.match(/[aeiou]/gi) || []).length / Math.max(1, letters.length)
  return hasLower && hasUpper && (hasDigit || vowelRatio < 0.28)
}

function isLikelyBotSubmission(enquiry) {
  const fields = [enquiry.name, enquiry.playerName, enquiry.playerAge, enquiry.playerLevel, enquiry.message]
  return fields.filter(looksLikeRandomToken).length >= 3
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

function airtableConfig() {
  const token = process.env.AIRTABLE_API_TOKEN || process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  const table = process.env.AIRTABLE_WAIVER_TABLE || process.env.AIRTABLE_WAIVER_TABLE_ID || DEFAULT_WAIVER_TABLE
  if (!token || !baseId) throw new Error('Airtable is not configured.')
  return { token, baseId, table }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function airtableRequest(path, init = {}) {
  const { token, baseId, table } = airtableConfig()
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = {} }
  if (!response.ok) throw new Error(data?.error?.message || `Airtable request failed: ${response.status}`)
  return data
}

async function findExistingWaiverRecord({ playerFullName, email, term }) {
  const formula = `AND(LOWER({Email})='${escapeFormulaValue(email.toLowerCase())}',LOWER({Player Full Name})='${escapeFormulaValue(playerFullName.toLowerCase())}',{Term}='${escapeFormulaValue(term)}')`
  const params = new URLSearchParams({
    maxRecords: '1',
    filterByFormula: formula,
  })
  const data = await airtableRequest(`?${params.toString()}`, { method: 'GET' })
  return data.records?.[0]?.id || null
}

function buildWaiverSummary(body) {
  const parts = [
    'Parent/guardian confirms the player details and medical information supplied are accurate.',
    'Parent/guardian understands football training involves physical activity and accepts the normal risks involved in participation.',
    'Parent/guardian confirms the player is fit to participate, unless medical notes have been listed on this form.',
    'Parent/guardian authorises Joner Football staff to seek urgent medical assistance if needed during a session.',
    'Parent/guardian accepts the Term 2 payment commitment and understands that missed sessions, late arrival or non-attendance do not automatically remove the payment commitment.',
  ]
  const medical = clean(body.medicalNotes, 1200)
  if (medical) parts.push(`Medical notes supplied: ${medical}`)
  return parts.join('\n')
}

async function handlePlayerWaiver(body, res) {
  const submitted = {
    playerFullName: clean(body.playerFullName, 180),
    dob: clean(body.dob, 80),
    parentName: clean(body.parentName, 180),
    currentClub: clean(body.currentClub, 180),
    email: clean(body.email, 220).toLowerCase(),
    mobileNumber: clean(body.mobileNumber, 80),
    playerMobileNumber: clean(body.playerMobileNumber, 80),
    medicalNotes: clean(body.medicalNotes, 1200),
    term: clean(body.term, 80) || 'Term 2',
    paymentCommitmentAccepted: body.paymentCommitmentAccepted === true || body.paymentCommitmentAccepted === 'true' || body.paymentCommitmentAccepted === 'on',
    waiverAccepted: body.waiverAccepted === true || body.waiverAccepted === 'true' || body.waiverAccepted === 'on',
    parentSignature: clean(body.parentSignature, 180),
  }

  if (!submitted.playerFullName || !submitted.dob || !submitted.parentName || !submitted.email || !submitted.mobileNumber) {
    return res.status(400).json({ success: false, error: 'Please complete all required player and parent fields.' })
  }
  const emailCheck = await validateEmailQuality(submitted.email, { label: 'parent email' })
  if (!emailCheck.ok) {
    return res.status(400).json({ success: false, error: emailCheck.error || 'Please enter a valid parent email address.' })
  }
  submitted.email = emailCheck.email
  if (!submitted.paymentCommitmentAccepted || !submitted.waiverAccepted || !submitted.parentSignature) {
    return res.status(400).json({ success: false, error: 'Please accept the waiver, payment commitment and add the parent/guardian signature.' })
  }

  const signedAt = new Date().toISOString()
  const fields = {
    'Player Full Name': submitted.playerFullName,
    DOB: submitted.dob,
    'Parent Name': submitted.parentName,
    'Current Club': submitted.currentClub,
    Email: submitted.email,
    'Mobile Number': submitted.mobileNumber,
    'Player Mobile Number': submitted.playerMobileNumber,
    'Medical Notes': submitted.medicalNotes || 'None supplied',
    Term: submitted.term,
    'Spot Confirmed': 'Submitted',
    'Payment Commitment Accepted': 'Yes',
    'Waiver Accepted': 'Yes',
    'Waiver Summary': buildWaiverSummary(submitted),
    'Parent/Guardian Signature': submitted.parentSignature,
    'Date Signed': signedAt,
    'Internal Notes': `Submitted from jonerfootball.com/player-waiver on ${signedAt}`,
  }

  const existingId = await findExistingWaiverRecord(submitted)
  if (existingId) {
    await airtableRequest(`/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    })
    return res.status(200).json({ success: true, updated: true })
  }

  await airtableRequest('', {
    method: 'POST',
    body: JSON.stringify({ fields }),
  })
  return res.status(200).json({ success: true, created: true })
}


function duplicateKey(enquiry) {
  return [
    enquiry.type,
    enquiry.email,
    enquiry.phone,
    enquiry.clubTeam,
    enquiry.numberOfPlayers,
    enquiry.numberOfCoaches,
    enquiry.location,
  ].map((part) => clean(part, 240).toLowerCase().replace(/\s+/g, ' ')).join('|')
}

function pruneDuplicateBuckets(now = Date.now()) {
  for (const [key, entry] of duplicateBuckets.entries()) {
    if (now - entry.createdAt > DUPLICATE_WINDOW_MS) duplicateBuckets.delete(key)
  }
}

function isDuplicateSubmission(enquiry) {
  const now = Date.now()
  pruneDuplicateBuckets(now)
  const existing = duplicateBuckets.get(duplicateKey(enquiry))
  return Boolean(existing && now - existing.createdAt <= DUPLICATE_WINDOW_MS)
}

function rememberSubmission(enquiry) {
  pruneDuplicateBuckets()
  duplicateBuckets.set(duplicateKey(enquiry), { createdAt: Date.now() })
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
    const type = clean(body.enquiryType, 80)
    const protection = await protectForm(req, res, type === 'player-waiver' ? 'player-waiver' : 'contact-enquiry', body)
    if (!protection.ok) return protection.response

    if (type === 'player-waiver') return await handlePlayerWaiver(body, res)

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

    const emailCheck = await validateEmailQuality(enquiry.email)
    if (!emailCheck.ok) {
      return res.status(400).json({ success: false, error: emailCheck.error || 'Please enter a valid email address.' })
    }
    enquiry.email = emailCheck.email

    if ((type === 'training-sydney' || type === 'game-analysis' || type === 'joners-juniors') && (!enquiry.playerName || !enquiry.playerAge)) {
      return res.status(400).json({ success: false, error: 'Please add the player name and age.' })
    }

    if ((type === 'training-sydney' || type === 'game-analysis' || type === 'joners-juniors') && !looksLikePlayerAge(enquiry.playerAge)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid player age.' })
    }

    if (isLikelyBotSubmission(enquiry)) {
      return res.status(400).json({ success: false, error: 'Please check the enquiry details and try again.' })
    }

    if (type === 'coaching-role' && (!enquiry.coachingExperience || !enquiry.qualifications)) {
      return res.status(400).json({ success: false, error: 'Please add your coaching experience and qualifications.' })
    }

    const duplicate = isDuplicateSubmission(enquiry)
    if (duplicate) return res.status(200).json({ success: true, duplicate: true })
    await sendEmail(enquiry)
    rememberSubmission(enquiry)
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
