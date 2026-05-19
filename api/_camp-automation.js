import { sendCampTransactionalEmail } from './_camp-email-templates.js'

export const DEFAULT_SHEET_ID = '1SbGmivi3yqFaBKoMAhoNd5ufUga99DaQBj2noXNJr4k'
export const PENDING_SHEET = 'Leads Pending Payment'
export const PAID_SHEET = 'Paid Camp Registrations'
export const EMAIL_LOG_SHEET = 'Camp Email Log'

export const HEADERS = [
  'Submitted At', 'Registration ID', 'Payment Status', 'Camp', 'Player First Name', 'Player Surname',
  'Parent Name', 'Email', 'Age', 'Mobile', 'Previous Camp', 'Club Level', 'Source', 'Medical History',
  'Jersey Size', 'Extra Info', 'Number Of Days', 'Agreement Accepted', 'Payment Method', 'Payment Link', 'Target Sheet Tab',
  'Net Amount AUD After Fees', 'Stripe Checkout Session ID', 'Stripe Payment ID / Refund Link',
]

export const LOG_HEADERS = ['Sent At', 'Registration ID', 'Email Type', 'Recipient Email', 'Camp', 'Status']

export function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try { return JSON.parse(raw) } catch (error) {
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) } catch (innerError) { return null }
  }
}

async function getGoogleAccessToken() {
  const account = parseServiceAccount()
  if (!account?.client_email || !account?.private_key) throw new Error('Google Sheets service account is not configured.')
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
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Could not authenticate Google Sheets.')
  return data.access_token
}

export async function sheetsFetch(path, options = {}) {
  const token = await getGoogleAccessToken()
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch (error) { data = {} }
  if (!response.ok) throw new Error(data.error?.message || 'Google Sheets request failed.')
  return data
}

export async function ensureSheetTab(sheetId, title, headers) {
  const meta = await sheetsFetch(`${sheetId}?fields=sheets.properties.title`)
  const exists = meta.sheets?.some((sheet) => sheet.properties?.title === title)
  if (!exists) {
    await sheetsFetch(`${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) })
  }
  const endCol = String.fromCharCode(64 + headers.length)
  const headerRange = `${encodeURIComponent(title)}!A1:${endCol}1`
  const current = await sheetsFetch(`${sheetId}/values/${headerRange}`)
  const currentHeaders = current.values?.[0] || []
  const missing = headers.some((header, index) => currentHeaders[index] !== header)
  if (missing) {
    await sheetsFetch(`${sheetId}/values/${headerRange}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [headers] }) })
  }
}

export async function readRows(sheetId, tab, headers = HEADERS) {
  await ensureSheetTab(sheetId, tab, headers)
  const data = await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!A:Z`)
  return data.values || []
}

export async function appendRow(sheetId, tab, row, headers = HEADERS, valueInputOption = 'RAW') {
  await ensureSheetTab(sheetId, tab, headers)
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!A:Z:append?valueInputOption=${encodeURIComponent(valueInputOption)}&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
}

export async function readSheetRange(sheetId, tab, range = 'A:Z') {
  const data = await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!${range}`)
  return data.values || []
}

function amountFromRegistration(registration) {
  if (registration.paidAmount) return clean(registration.paidAmount, 80)
  const value = clean(registration.numberOfDays || registration.extraInfo || '', 120)
  const match = value.match(/\$\s?\d+(?:\.\d{2})?(?:\s?(?:USD|AUD))?/i)
  return match ? match[0].replace(/\s+/, ' ') : value
}

function campDaysFromRegistration(registration) {
  const value = `${registration.numberOfDays || ''} ${registration.extraInfo || ''}`.toLowerCase()
  const explicit = value.match(/\b([123])\s*day/)
  const days = explicit ? Number(explicit[1]) : 3
  return [true, days >= 2, days >= 3]
}

export function operationalCampRowFromRegistration(registration) {
  const playerName = clean(`${registration.playerFirstName || ''} ${registration.playerSurname || ''}`.trim(), 180)
  const nameWithAge = registration.age ? `${playerName} (${registration.age})` : playerName
  const [day1, day2, day3] = campDaysFromRegistration(registration)
  return [
    nameWithAge,
    registration.jerseySize || '',
    day1,
    day2,
    day3,
    registration.email || '',
    registration.mobile || '',
    amountFromRegistration(registration),
    'stripe',
    registration.previousCamp || '',
  ]
}

export async function appendOperationalCampRow(sheetId, tab, registration) {
  const row = operationalCampRowFromRegistration(registration)
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!A:J:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
}

export async function updateCell(sheetId, tab, rowNumber, colLetter, value, valueInputOption = 'RAW') {
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!${colLetter}${rowNumber}:${colLetter}${rowNumber}?valueInputOption=${encodeURIComponent(valueInputOption)}`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[value]] }),
  })
}

export function registrationFromRow(row = []) {
  return {
    submittedAt: row[0] || '', registrationId: row[1] || '', paymentStatus: row[2] || '', camp: row[3] || '',
    playerFirstName: row[4] || '', playerSurname: row[5] || '', parentName: row[6] || '', email: row[7] || '',
    age: row[8] || '', mobile: row[9] || '', previousCamp: row[10] || '', clubLevel: row[11] || '', source: row[12] || '',
    medicalHistory: row[13] || '', jerseySize: row[14] || '', extraInfo: row[15] || '', numberOfDays: row[16] || '',
    agreementAccepted: row[17] || '', paymentMethod: row[18] || '', paymentLink: row[19] || '', sheetTab: row[20] || '',
    paidAmount: row[21] || '', stripeCheckoutSessionId: row[22] || '', stripePaymentIntentId: row[23] || '',
    stripePaymentIntentSheetValue: row[23] || '',
  }
}

export function rowFromRegistration(registration, paymentStatus = registration.paymentStatus) {
  return [
    registration.submittedAt, registration.registrationId, paymentStatus, registration.camp, registration.playerFirstName,
    registration.playerSurname, registration.parentName, registration.email, registration.age, registration.mobile,
    registration.previousCamp, registration.clubLevel, registration.source, registration.medicalHistory, registration.jerseySize,
    registration.extraInfo, registration.numberOfDays, registration.agreementAccepted, registration.paymentMethod,
    registration.paymentLink, registration.sheetTab, registration.paidAmount || '',
    registration.stripeCheckoutSessionId || '', registration.stripePaymentIntentSheetValue || registration.stripePaymentIntentId || '',
  ]
}

export function emailDataFromRegistration(registration) {
  const camp = registration.camp || 'Joner Football Elite Camp'
  const lower = `${camp} ${registration.sheetTab} ${registration.source}`.toLowerCase()
  const isSydney = lower.includes('sydney')
  const isHouston = lower.includes('houston')
  const isDallas = lower.includes('dallas')
  return {
    parentName: registration.parentName || 'there',
    playerFirstName: registration.playerFirstName,
    playerSurname: registration.playerSurname,
    campName: camp,
    destination: isSydney ? 'Sydney' : isHouston ? 'Houston' : isDallas ? 'Dallas' : registration.sheetTab || 'your camp',
    campDates: isSydney ? 'July 14-16, 2026' : isHouston ? 'June 26-28, 2026' : isDallas ? 'June 30-July 2, 2026' : 'Confirmed camp dates',
    campTimes: isSydney ? '9am to 12pm' : isHouston || isDallas ? '7am to 10am' : 'Confirmed camp times',
    campLocation: isSydney
      ? 'Rydalmere Park, Sydney'
      : isHouston
        ? '17822 Hufsmith Kohrville Rd, Tomball, TX 77375'
        : isDallas
          ? '4220 E Melissa Rd, Melissa, TX 75454'
          : registration.sheetTab || registration.camp,
    numberOfDays: registration.numberOfDays,
    jerseySize: registration.jerseySize,
    paymentLink: registration.paymentLink,
  }
}

export async function emailAlreadySent(sheetId, registrationId, type) {
  const rows = await readRows(sheetId, EMAIL_LOG_SHEET, LOG_HEADERS)
  return rows.slice(1).some((row) => row[1] === registrationId && row[2] === type && row[5] === 'sent')
}

export async function logEmail(sheetId, registration, type, status = 'sent') {
  await appendRow(sheetId, EMAIL_LOG_SHEET, [new Date().toISOString(), registration.registrationId, type, registration.email, registration.camp, status], LOG_HEADERS)
}

export async function sendRegistrationEmail({ sheetId, registration, type }) {
  if (await emailAlreadySent(sheetId, registration.registrationId, type)) return { skipped: true, reason: 'already-sent' }
  const template = String(type || '').startsWith('unpaid-reminder') || type === 'signup-payment-link' ? 'unpaid' : 'confirmed'
  await sendCampTransactionalEmail({
    toEmail: registration.email,
    toName: registration.parentName || registration.playerFirstName || registration.email,
    template,
    data: emailDataFromRegistration(registration),
  })
  await logEmail(sheetId, registration, type, 'sent')
  return { skipped: false, sent: true }
}
