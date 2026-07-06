import { protectForm } from './_security.js'
import { validateEmailFormat, validateEmailQuality } from './_email-quality.js'
import { sendRegistrationEmail } from './_camp-automation.js'
import { campPaymentConfig, selectedDayKey, siteUrl } from './_camp-payment-options.js'

const DEFAULT_SHEET_ID = '1SbGmivi3yqFaBKoMAhoNd5ufUga99DaQBj2noXNJr4k'
const PENDING_SHEET = 'Leads Pending Payment'
const PAID_SHEET = 'Paid Camp Registrations'
const HOT_APP_LEADS_BREVO_LIST_ID = 2
const USA_CAMP_BREVO_LIST_ID = 5
const SYDNEY_CAMP_BREVO_LIST_ID = 6
const CAMP_SIGNUP_EMAIL = process.env.CAMP_SIGNUP_EMAIL || 'joner1on1info@gmail.com'
const APP_CTA_URL = 'https://jonerfootball.com/app'

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
  'Net Amount AUD After Fees',
  'Stripe Checkout Session ID',
  'Stripe Payment ID / Refund Link',
  'Heard About Camp',
]

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

function validEmail(value) {
  return validateEmailFormat(value).ok
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

function parseEmailList(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '')
  return raw
    .split(',')
    .map((email) => clean(email, 200).toLowerCase())
    .filter((email) => email && validEmail(email))
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

  const headerRange = `${encodeURIComponent(title)}!A1:Y1`
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
    registration.paymentStatus,
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
    '',
    '',
    '',
    registration.heardAboutCamp,
  ]

  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(PENDING_SHEET)}!A:Y:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
}

function brevoListsForRegistration(registration) {
  const ids = new Set([HOT_APP_LEADS_BREVO_LIST_ID])

  if (Array.isArray(registration.brevoListIds)) {
    registration.brevoListIds.forEach((id) => {
      const n = Number(id)
      if (n > 0) ids.add(n)
    })
  }

  if (registration.brevoListId) ids.add(registration.brevoListId)

  const destination = `${registration.destination} ${registration.location} ${registration.camp}`.toLowerCase()
  if (destination.includes('sydney') || destination.includes('australia') || destination.includes('aus')) ids.add(SYDNEY_CAMP_BREVO_LIST_ID)
  if (destination.includes('usa') || destination.includes('america') || destination.includes('texas') || destination.includes('california') || destination.includes('san diego')) ids.add(USA_CAMP_BREVO_LIST_ID)
  if (ids.size === 1) ids.add(USA_CAMP_BREVO_LIST_ID)

  return Array.from(ids).filter((id) => Number.isFinite(id) && id > 0)
}

function campSignupRecipients(registration) {
  if (registration.notificationEmails?.length) {
    return registration.notificationEmails.map((email) => ({ email, name: 'Joner Football Camps' }))
  }

  const base = String(CAMP_SIGNUP_EMAIL || '')
  const isJuniors = `${registration.camp} ${registration.destination} ${registration.sheetTab} ${registration.source}`.toLowerCase().includes('joner') && `${registration.camp} ${registration.destination} ${registration.sheetTab} ${registration.source}`.toLowerCase().includes('junior')
  const value = isJuniors
    ? process.env.JONERS_JUNIORS_SIGNUP_EMAILS || 'ligia@jonerfootball.com,trainingenquiries@jonerfootball.com'
    : base
  return String(value || 'leejones@jonerfootball.com')
    .split(',')
    .map((email) => clean(email, 200).toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, name: 'Joner Football Camps' }))
}

function defaultCampSheetTab(registration) {
  const text = `${registration.camp} ${registration.destination} ${registration.source}`.toLowerCase()
  if (text.includes('houston')) return 'Texas Houston (June)'
  if (text.includes('dallas')) return 'Texas Dallas (June)'
  if (text.includes('san diego')) return 'San Diego (June)'
  if (text.includes('sydney')) return 'Sydney big 1 (July)'
  if (text.includes('joner') && text.includes('junior')) return 'Joners Juniors'
  return registration.camp || 'Camp Registrations'
}

async function sendCampSignupEmail(registration) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { skipped: true }
  const recipients = campSignupRecipients(registration)
  if (!recipients.length) return { skipped: true }

  const html = `
    <h2>New camp signup</h2>
    <p><strong>${escapeHtml(registration.camp)}</strong></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${campRow('Registration ID', registration.registrationId)}
      ${campRow('Payment status', registration.paymentStatusLabel)}
      ${campRow('Camp', registration.camp)}
      ${campRow('Player first name', registration.playerFirstName)}
      ${campRow('Player surname', registration.playerSurname)}
      ${campRow('Parent name', registration.parentName)}
      ${campRow('Email', registration.email)}
      ${campRow('Age', registration.age)}
      ${campRow('Mobile', registration.mobile)}
      ${campRow('Done camp before', registration.previousCamp)}
      ${campRow('Heard about camp', registration.heardAboutCamp)}
      ${campRow('Request type', registration.requestType)}
      ${campRow('Small group nights', registration.requestNights)}
      ${campRow('Club level', registration.clubLevel)}
      ${campRow('Number of days', registration.numberOfDays)}
      ${campRow('Jersey size', registration.jerseySize)}
      ${campRow('Medical history', registration.medicalHistory)}
      ${campRow('Extra info', registration.extraInfo)}
      ${campRow('Payment method', registration.paymentMethod)}
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
      to: recipients,
      replyTo: { email: registration.email, name: registration.parentName || registration.playerFirstName },
      subject: `${registration.requestOnly ? 'REQUEST' : registration.paymentStatus === 'paid' ? 'PAID' : 'NOT PAID YET'} camp signup: ${registration.playerFirstName} ${registration.playerSurname} for ${registration.camp}`,
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

async function sendCampInterestReply(registration) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { skipped: true }

  const parent = escapeHtml(registration.parentName || 'there')
  const player = escapeHtml(registration.playerFirstName || 'your player')
  const requestType = escapeHtml(registration.requestType || 'camp / small group training')

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:660px;background:#111111;border:1px solid #252525;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 26px 10px;">
                <p style="margin:0 0 10px;color:#e8000d;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:1.8px;text-transform:uppercase;">Joner Football San Diego</p>
                <h1 style="margin:0 0 18px;color:#ffffff;font-size:30px;line-height:1.08;font-weight:900;text-transform:uppercase;">Request received</h1>
              </td>
            </tr>
            <tr><td style="padding:0 26px 8px;">
              <p style="margin:0 0 16px;color:#e8e8e8;font-size:16px;line-height:1.65;">Hi ${parent},</p>
              <p style="margin:0 0 16px;color:#e8e8e8;font-size:16px;line-height:1.65;">Thank you for your interest in the Joner Football San Diego camp and small group training. We have received the request for ${player}.</p>
              <p style="margin:0 0 16px;color:#ffffff;font-size:17px;line-height:1.55;font-weight:800;">Request type: ${requestType}</p>
              <p style="margin:0 0 20px;color:#d8d8d8;font-size:15px;line-height:1.65;">All payment is handled through Obed Gamino at Leon FC. Obed and the Joner Football team will follow up with next steps.</p>
            </td></tr>
            <tr><td style="padding:0 26px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;border:1px solid #2b2b2b;border-radius:12px;"><tr><td style="padding:24px;text-align:center;">
                <p style="margin:0 0 8px;color:#e8000d;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;">Train before camp</p>
                <h2 style="margin:0 0 12px;color:#ffffff;font-size:23px;line-height:1.2;font-weight:900;">Want ${player} to arrive sharper?</h2>
                <p style="margin:0 0 20px;color:#d8d8d8;font-size:15px;line-height:1.65;">Download the Joner Football App and start with the free section before camp. It helps players understand the detail, rhythm and standards we coach.</p>
                <a href="${APP_CTA_URL}" style="background:#e8000d;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;line-height:20px;padding:16px 24px;border-radius:8px;display:inline-block;text-transform:uppercase;letter-spacing:.04em;text-align:center;">Download the app</a>
              </td></tr></table>
            </td></tr>
            <tr><td style="padding:26px;background:#0b0b0b;border-top:1px solid #252525;">
              <p style="margin:0 0 4px;color:#ffffff;font-size:15px;line-height:1.6;font-weight:800;">Lee Jones</p>
              <p style="margin:0;color:#bdbdbd;font-size:14px;line-height:1.6;">Joner Football</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: process.env.CAMP_EMAIL_SENDER_NAME || 'Joner Football Camps',
        email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com',
      },
      to: [{ email: registration.email, name: registration.parentName || registration.playerFirstName || registration.email }],
      replyTo: { email: process.env.CAMP_REPLY_TO_EMAIL || process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com', name: 'Joner Football' },
      subject: 'San Diego camp request received',
      htmlContent: html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.warn('Camp interest auto-reply failed:', text)
    return { skipped: false, failed: true }
  }

  return { skipped: false, failed: false }
}

async function addToBrevo(registration) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { skipped: true }

  const listIds = brevoListsForRegistration(registration)

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
        HEARD_ABOUT_CAMP: registration.heardAboutCamp || '',
        DONE_CAMP_BEFORE: registration.previousCamp || '',
      },
      listIds,
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

async function createStripeCheckoutSession(req, registration) {
  const campName = String(registration.camp || '').toLowerCase()
  if (campName.includes('joners juniors')) return null

  const config = campPaymentConfig(registration.camp, registration.destination)
  if (!config || registration.paymentMethod !== 'Stripe') return null

  const secret = config.secretEnv
    ? process.env[config.secretEnv]
    : (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY)
  if (!secret) {
    if (config.secretEnv) {
      console.warn(`${config.secretEnv} is not configured. Falling back to submitted/static camp payment link.`)
      return null
    }
    throw new Error('STRIPE_SECRET_KEY is not configured.')
  }

  const dayKey = selectedDayKey(registration.numberOfDays)
  const amount = config.amounts[dayKey]
  if (!amount) throw new Error('Camp price is not configured.')

  const dayLabel = dayKey === 'three' ? '3 Days' : dayKey === 'two' ? '2 Days' : '1 Day'
  const baseUrl = siteUrl(req)
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'payment',
      allow_promotion_codes: 'true',
      success_url: `${baseUrl}${config.successPath}&registration_id=${encodeURIComponent(registration.registrationId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}${config.cancelPath}&registration_id=${encodeURIComponent(registration.registrationId)}`,
      customer_email: registration.email,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': config.currency,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': `${config.displayName} - ${dayLabel}`,
      'line_items[0][price_data][product_data][metadata][camp]': registration.camp,
      'metadata[registrationId]': registration.registrationId,
      'metadata[camp]': registration.camp,
      'metadata[destination]': registration.destination,
      'metadata[numberOfDays]': registration.numberOfDays,
      'metadata[playerName]': `${registration.playerFirstName} ${registration.playerSurname}`.trim(),
      'payment_intent_data[metadata][registrationId]': registration.registrationId,
      'payment_intent_data[metadata][camp]': registration.camp,
      'payment_intent_data[metadata][numberOfDays]': registration.numberOfDays,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.url) throw new Error(data.error?.message || 'Could not create Stripe Checkout session.')
  return data
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
      brevoListIds: Array.isArray(body.brevoListIds) ? body.brevoListIds.map(Number).filter(Boolean) : clean(body.brevoListIds || '', 80).split(',').map((id) => Number(id.trim())).filter(Boolean),
      playerFirstName: clean(body.playerFirstName, 80),
      playerSurname: clean(body.playerSurname, 80),
      parentName: clean(body.parentName, 120),
      email: clean(body.email, 160).toLowerCase(),
      age: clean(body.age, 30),
      mobile: clean(body.mobile, 60),
      previousCamp: clean(body.previousCamp || body.doneCampBefore || body.doneBefore, 20),
      clubLevel: clean(body.clubLevel, 160),
      source: clean(body.source, 160),
      heardAboutCamp: clean(body.heardAboutCamp || body.heardAbout || body.hearAbout || '', 160),
      medicalHistory: clean(body.medicalHistory, 600),
      jerseySize: clean(body.jerseySize, 40),
      extraInfo: clean(body.extraInfo, 600),
      numberOfDays: clean(body.numberOfDays, 40),
      agreementAccepted: body.agreementAccepted === true || body.agreementAccepted === 'true' || body.agreementAccepted === 'on',
      paymentMethod: clean(body.paymentMethod, 30) || 'Stripe',
      paymentLink: clean(body.paymentLink || process.env.CAMP_DEFAULT_PAYMENT_LINK || 'https://app.jonerfootball.com', 500),
      paymentStatus: clean(body.paymentStatus || 'not_paid_pending_payment', 40),
      sheetTab: clean(body.sheetTab || body.googleSheetTab || body.targetSheetTab, 120),
      requestOnly: body.requestOnly === true || body.requestOnly === 'true' || body.paymentStatus === 'request_only',
      requestType: clean(body.requestType || body.interestType || '', 160),
      requestNights: clean(body.requestNights || body.smallGroupNights || '', 160),
      notificationEmails: parseEmailList(body.notificationEmails || body.notifyEmails || ''),
      sendImmediateNotification: body.sendImmediateNotification === true || body.sendImmediateNotification === 'true',
      sendInterestReply: body.sendInterestReply === true || body.sendInterestReply === 'true',
    }
    if (!registration.sheetTab) registration.sheetTab = defaultCampSheetTab(registration)

    if (!registration.playerFirstName) return res.status(400).json({ success: false, error: 'Player first name is required.' })
    if (!registration.playerSurname) return res.status(400).json({ success: false, error: 'Player surname is required.' })
    const emailCheck = await validateEmailQuality(registration.email, { label: 'parent email' })
    if (!emailCheck.ok) return res.status(400).json({ success: false, error: emailCheck.error || 'Enter a valid email address.' })
    registration.email = emailCheck.email
    if (!registration.age) return res.status(400).json({ success: false, error: 'Player age is required.' })
    if (!registration.mobile) return res.status(400).json({ success: false, error: 'Mobile number is required.' })
    if (!registration.jerseySize) return res.status(400).json({ success: false, error: 'Jersey size is required.' })
    if (!registration.numberOfDays) return res.status(400).json({ success: false, error: 'Number of days is required.' })
    if (!registration.agreementAccepted) return res.status(400).json({ success: false, error: 'Training agreement must be accepted.' })

    registration.paymentStatus = registration.paymentStatus === 'paid' ? 'paid' : 'not_paid_pending_payment'
    registration.paymentStatusLabel = registration.requestOnly
      ? 'REQUEST ONLY - payment through Obed Gamino at Leon FC'
      : registration.paymentStatus === 'paid'
        ? 'PAID'
        : 'NOT PAID YET, payment link selected and sent to parent'

    let checkoutSession = null
    try {
      checkoutSession = await createStripeCheckoutSession(req, registration)
      if (checkoutSession?.url) registration.paymentLink = checkoutSession.url
    } catch (checkoutError) {
      console.warn('Camp Stripe Checkout creation failed; falling back to submitted payment link:', checkoutError?.message || checkoutError)
      checkoutSession = null
    }

    await appendPendingRegistration(registration)

    let brevo = { skipped: true }
    try {
      brevo = await addToBrevo(registration)
    } catch (brevoError) {
      console.warn('Brevo camp lead capture crashed:', brevoError?.message || brevoError)
      brevo = { skipped: false, failed: true }
    }

    let notification = { skipped: true, reason: 'delayed-unpaid-admin-alert' }
    if (registration.paymentStatus === 'paid' || registration.requestOnly || registration.sendImmediateNotification) {
      try {
        notification = await sendCampSignupEmail(registration)
      } catch (notificationError) {
        console.warn('Camp signup notification crashed:', notificationError?.message || notificationError)
        notification = { skipped: false, failed: true }
      }
    }
    let customerEmail = { skipped: true, reason: 'paid-confirmation-only' }
    if (registration.requestOnly || registration.sendInterestReply) {
      try {
        customerEmail = await sendCampInterestReply(registration)
      } catch (customerEmailError) {
        console.warn('Camp interest auto-reply crashed:', customerEmailError?.message || customerEmailError)
        customerEmail = { skipped: false, failed: true }
      }
    }

    return res.status(200).json({
      success: true,
      registrationId: registration.registrationId,
      paymentLink: registration.paymentLink,
      brevo,
      notification,
      customerEmail,
      checkoutSessionId: checkoutSession?.id || null,
    })
  } catch (error) {
    console.error('Camp registration failed:', error)
    const message = error?.message || 'Could not save registration. Please try again.'
    return res.status(500).json({ success: false, error: message })
  }
}
