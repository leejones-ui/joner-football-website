import { protectForm } from './_security.js'

const DEFAULT_SHEET_ID = '1SbGmivi3yqFaBKoMAhoNd5ufUga99DaQBj2noXNJr4k'
const PENDING_SHEET = 'Leads Pending Payment'
const PAID_SHEET = 'Paid Camp Registrations'
const USA_CAMP_BREVO_LIST_ID = 5
const SYDNEY_CAMP_BREVO_LIST_ID = 6
const CAMP_SIGNUP_EMAIL = process.env.CAMP_SIGNUP_EMAIL || 'joner1on1info@gmail.com'

const HEADERS = [
  'Submitted At',
  'Registration ID',
  'Payment Status',
  'Camp',
  'Player First Name',
  'Player Surname',
  'Parent Name',
  'Email',
  'Age',
  'Mobile',
  'Previous Camp',
  'Club Level',
  'Source',
  'Medical History',
  'Jersey Size',
  'Extra Info',
  'Number Of Days',
  'Agreement Accepted',
  'Payment Method',
  'Payment Link',
  'Target Sheet Tab',
]

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
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

function campRow(label, value) {
  if (!value) return ''
  return `<tr><td style="font-weight:bold;vertical-align:top;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch (innerError) {
      return null
    }
  }
}

async function getGoogleAccessToken() {
  const account = parseServiceAccount()
  if (!account?.client_email || !account?.private_key) {
    throw new Error('Google Sheets service account is not configured.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`
  const crypto = await import('node:crypto')
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })

  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Could not authenticate Google Sheets.')
  return data.access_token
}

async function sheetsFetch(path, options = {}) {
  const token = await getGoogleAccessToken()
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch (error) { data = {} }
  if (!response.ok) throw new Error(data.error?.message || 'Google Sheets request failed.')
  return data
}

async function ensureSheetTab(sheetId, title) {
  const meta = await sheetsFetch(`${sheetId}?fields=sheets.properties.title`)
  const exists = meta.sheets?.some((sheet) => sheet.properties?.title === title)
  if (!exists) {
    await sheetsFetch(`${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    })
  }

  const headerRange = `${encodeURIComponent(title)}!A1:U1`
  const current = await sheetsFetch(`${sheetId}/values/${headerRange}`)
  const currentHeaders = current.values?.[0] || []
  const missingHeaders = HEADERS.some((header, index) => currentHeaders[index] !== header)
  if (missingHeaders) {
    await sheetsFetch(`${sheetId}/values/${headerRange}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [HEADERS] }),
    })
  }
}

async function appendPendingRegistration(registration) {
  const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID
  await ensureSheetTab(sheetId, PENDING_SHEET)
  await ensureSheetTab(sheetId, PAID_SHEET)

  const row = [
    registration.submittedAt,
    registration.registrationId,
    'pending',
    registration.camp,
    registration.playerFirstName,
    registration.playerSurname,
    registration.parentName,
    registration.email,
    registration.age,
    registration.mobile,
    registration.previousCamp,
    registration.clubLevel,
    registration.source,
    registration.medicalHistory,
    registration.jerseySize,
    registration.extraInfo,
    registration.numberOfDays,
    registration.agreementAccepted ? 'yes' : 'no',
    registration.paymentMethod,
    registration.paymentLink,
    registration.sheetTab,
  ]

  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(PENDING_SHEET)}!A:U:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
}

function brevoListForRegistration(registration) {
  if (registration.brevoListId) return registration.brevoListId

  const destination = `${registration.destination} ${registration.location} ${registration.camp}`.toLowerCase()
  if (destination.includes('sydney') || destination.includes('australia') || destination.includes('aus')) return SYDNEY_CAMP_BREVO_LIST_ID
  if (destination.includes('usa') || destination.includes('america') || destination.includes('texas') || destination.includes('california')) return USA_CAMP_BREVO_LIST_ID
  return USA_CAMP_BREVO_LIST_ID
}

async function sendCampSignupEmail(registration) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey || !CAMP_SIGNUP_EMAIL) return { skipped: true }

  const html = `
    <h2>New camp signup</h2>
    <p><strong>${escapeHtml(registration.camp)}</strong></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${campRow('Registration ID', registration.registrationId)}
      ${campRow('Payment status', 'pending')}
      ${campRow('Camp', registration.camp)}
      ${campRow('Player first name', registration.playerFirstName)}
      ${campRow('Player surname', registration.playerSurname)}
      ${campRow('Parent name', registration.parentName)}
      ${campRow('Email', registration.email)}
      ${campRow('Age', registration.age)}
      ${campRow('Mobile', registration.mobile)}
      ${campRow('Previous camp', registration.previousCamp)}
      ${campRow('Club level', registration.clubLevel)}
      ${campRow('Number of days', registration.numberOfDays)}
      ${campRow('Jersey size', registration.jerseySize)}
      ${campRow('Medical history', registration.medicalHistory)}
      ${campRow('Extra info', registration.extraInfo)}
      ${campRow('Payment link', registration.paymentLink)}
      ${campRow('Submitted at', registration.submittedAt)}
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
      to: [{ email: CAMP_SIGNUP_EMAIL, name: 'Joner Football Camps' }],
      replyTo: [{ email: registration.email, name: registration.parentName || registration.playerFirstName }],
      subject: `Camp signup: ${registration.playerFirstName} ${registration.playerSurname} for ${registration.camp}`,
      htmlContent: html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.warn('Camp signup notification failed:', text)
    return { skipped: false, failed: true }
  }

  return { skipped: false, failed: false }
}

async function addToBrevo(registration) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { skipped: true }

  const listId = brevoListForRegistration(registration)

  const response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      email: registration.email,
      attributes: {
        FIRSTNAME: registration.playerFirstName,
        WEBSITE_SOURCE: 'camp-registration',
        CAMP_NAME: registration.camp,
        CAMP_DESTINATION: registration.destination || registration.location || '',
      },
      listIds: [listId],
      updateEnabled: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.warn('Brevo camp lead capture failed:', text)
    return { skipped: false, failed: true }
  }

  return { skipped: false, failed: false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const protection = await protectForm(req, res, 'camp-registration', body)
    if (!protection.ok) return protection.response

    const registration = {
      submittedAt: new Date().toISOString(),
      registrationId: `CAMP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      camp: clean(body.camp || 'Camp Registration', 120),
      destination: clean(body.destination || body.campDestination || body.location, 80),
      location: clean(body.location, 120),
      brevoListId: Number(body.brevoListId || body.brevo_list_id || 0) || null,
      playerFirstName: clean(body.playerFirstName, 80),
      playerSurname: clean(body.playerSurname, 80),
      parentName: clean(body.parentName, 120),
      email: clean(body.email, 160).toLowerCase(),
      age: clean(body.age, 30),
      mobile: clean(body.mobile, 60),
      previousCamp: clean(body.previousCamp, 20),
      clubLevel: clean(body.clubLevel, 160),
      source: clean(body.source, 160),
      medicalHistory: clean(body.medicalHistory, 600),
      jerseySize: clean(body.jerseySize, 40),
      extraInfo: clean(body.extraInfo, 600),
      numberOfDays: clean(body.numberOfDays, 40),
      agreementAccepted: body.agreementAccepted === true || body.agreementAccepted === 'true' || body.agreementAccepted === 'on',
      paymentMethod: clean(body.paymentMethod, 30) || 'Stripe',
      paymentLink: clean(body.paymentLink || process.env.CAMP_DEFAULT_PAYMENT_LINK || 'https://app.jonerfootball.com', 500),
      sheetTab: clean(body.sheetTab || body.googleSheetTab || body.targetSheetTab, 120),
    }

    if (!registration.playerFirstName) return res.status(400).json({ success: false, error: 'Player first name is required.' })
    if (!registration.playerSurname) return res.status(400).json({ success: false, error: 'Player surname is required.' })
    if (!validEmail(registration.email)) return res.status(400).json({ success: false, error: 'Enter a valid email address.' })
    if (!registration.age) return res.status(400).json({ success: false, error: 'Player age is required.' })
    if (!registration.mobile) return res.status(400).json({ success: false, error: 'Mobile number is required.' })
    if (!registration.jerseySize) return res.status(400).json({ success: false, error: 'Jersey size is required.' })
    if (!registration.numberOfDays) return res.status(400).json({ success: false, error: 'Number of days is required.' })
    if (!registration.agreementAccepted) return res.status(400).json({ success: false, error: 'Training agreement must be accepted.' })

    await appendPendingRegistration(registration)
    const brevo = await addToBrevo(registration)
    const notification = await sendCampSignupEmail(registration)

    return res.status(200).json({
      success: true,
      registrationId: registration.registrationId,
      paymentLink: registration.paymentLink,
      brevo,
      notification,
    })
  } catch (error) {
    console.error('Camp registration failed:', error)
    return res.status(500).json({ success: false, error: 'Could not save registration. Please try again.' })
  }
}
