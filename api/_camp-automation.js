import { sendCampTransactionalEmail } from './_camp-email-templates.js'

export const DEFAULT_SHEET_ID = '1SbGmivi3yqFaBKoMAhoNd5ufUga99DaQBj2noXNJr4k'
export const PENDING_SHEET = 'Leads Pending Payment'
export const PAID_SHEET = 'Paid Camp Registrations'
export const EMAIL_LOG_SHEET = 'Camp Email Log'

export const HEADERS = [
  'Submitted At', 'Registration ID', 'Payment Status', 'Camp', 'Player First Name', 'Player Surname',
  'Parent Name', 'Email', 'Age', 'Mobile', 'Previous Camp', 'Club Level', 'Source', 'Medical History',
  'Jersey Size', 'Extra Info', 'Number Of Days', 'Agreement Accepted', 'Payment Method', 'Payment Link', 'Target Sheet Tab',
  'Net Amount AUD After Fees', 'Stripe Checkout Session ID', 'Stripe Payment ID / Refund Link', 'Heard About Camp',
]

export const LOG_HEADERS = ['Sent At', 'Registration ID', 'Email Type', 'Recipient Email', 'Camp', 'Status']

const CAMP_PAID_NOTIFICATION_EMAIL = process.env.CAMP_PAID_NOTIFICATION_EMAIL || process.env.CAMP_SIGNUP_EMAIL || 'joner1on1info@gmail.com'

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

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

export async function sheetNumericId(sheetId, title) {
  const meta = await sheetsFetch(`${sheetId}?fields=sheets.properties(sheetId,title)`)
  const sheet = meta.sheets?.find((entry) => entry.properties?.title === title)
  return sheet?.properties?.sheetId
}

export async function resolveSheetTitle(sheetId, title) {
  const wanted = clean(title || '', 160)
  if (!wanted) return wanted
  const meta = await sheetsFetch(`${sheetId}?fields=sheets.properties.title`)
  const titles = meta.sheets?.map((entry) => entry.properties?.title).filter(Boolean) || []
  return titles.find((entry) => entry === wanted)
    || titles.find((entry) => clean(entry, 160).trim() === wanted.trim())
    || titles.find((entry) => clean(entry, 160).trim().toLowerCase() === wanted.trim().toLowerCase())
    || wanted
}

export async function deleteSheetRow(sheetId, tab, rowNumber) {
  const numericId = await sheetNumericId(sheetId, tab)
  if (!Number.isFinite(numericId) || rowNumber <= 1) return { skipped: true, reason: 'invalid-row-or-tab' }
  await sheetsFetch(`${sheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId: numericId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    }),
  })
  return { skipped: false, deleted: true, rowNumber }
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
    registration.heardAboutCamp || '',
  ]
}

export function columnLetter(index) {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function normaliseHeader(value) {
  return clean(value || '', 80).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function operationalCampValueByHeader(header, registration) {
  const key = normaliseHeader(header)
  const row = operationalCampRowFromRegistration(registration)
  const values = {
    name: row[0],
    player: row[0],
    jersey: row[1],
    jerseysize: row[1],
    day1: row[2],
    dayone: row[2],
    day2: row[3],
    daytwo: row[3],
    day3: row[4],
    daythree: row[4],
    email: row[5],
    emailaddress: row[5],
    number: row[6],
    phone: row[6],
    mobile: row[6],
    amount: row[7],
    aud: row[7],
    amountaud: row[7],
    netaud: row[7],
    netamountaud: row[7],
    netamountaudafterfees: row[7],
    audafterfees: row[7],
    paid: row[7],
    method: row[8],
    paymentmethod: row[8],
    donebefore: row[9],
    previouscamp: row[9],
    beenbefore: row[9],
    heardaboutcamp: registration.heardAboutCamp || '',
    heardabout: registration.heardAboutCamp || '',
    whereheard: registration.heardAboutCamp || '',
    wheredidyouhearaboutcamp: registration.heardAboutCamp || '',
    wheredidyouhearaboutthecamp: registration.heardAboutCamp || '',
    source: registration.heardAboutCamp || '',
  }
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ''
}

export function findOperationalCampLayout(rows = []) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || []
    const normalised = row.map(normaliseHeader)
    const nameCol = normalised.findIndex((value) => value === 'name' || value === 'player')
    const jerseyCol = normalised.findIndex((value) => value === 'jersey' || value === 'jerseysize')
    const day1Col = normalised.findIndex((value) => value === 'day1' || value === 'dayone')
    const emailCol = normalised.findIndex((value) => value === 'email' || value === 'emailaddress')
    if (nameCol >= 0 && jerseyCol >= 0 && day1Col >= 0 && emailCol >= 0) {
      return { rowIndex, rowNumber: rowIndex + 1, headers: row, nameCol, emailCol, numberCol: normalised.findIndex((value) => value === 'number' || value === 'phone' || value === 'mobile') }
    }
  }
  return null
}


export async function ensureOperationalMarketingColumns(sheetId, tab, layout) {
  if (!layout) return layout
  const normalised = layout.headers.map(normaliseHeader)
  const needsDone = !normalised.some((value) => ['donebefore', 'previouscamp', 'beenbefore', 'donecampbefore'].includes(value))
  const needsHeard = !normalised.some((value) => ['heardaboutcamp', 'heardabout', 'whereheard', 'wheredidyouhearaboutcamp', 'wheredidyouhearaboutthecamp', 'source'].includes(value))
  if (!needsDone && !needsHeard) return layout

  const headers = [...layout.headers]
  if (needsDone) headers.push('Done before?')
  if (needsHeard) headers.push('Heard About Camp')

  const startCol = columnLetter(layout.headers.length)
  const endCol = columnLetter(headers.length - 1)
  const values = headers.slice(layout.headers.length)
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!${startCol}${layout.rowNumber}:${endCol}${layout.rowNumber}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [values] }),
  })

  return { ...layout, headers }
}

export async function appendOperationalCampRow(sheetId, tab, registration) {
  const rows = await readSheetRange(sheetId, tab, 'A:Z')
  let layout = findOperationalCampLayout(rows)

  if (layout) {
    layout = await ensureOperationalMarketingColumns(sheetId, tab, layout)
    const firstBlankPlayerIndex = rows.slice(layout.rowIndex + 1).findIndex((existingRow) => !clean(existingRow?.[layout.nameCol] || '', 180))
    const targetRowNumber = firstBlankPlayerIndex >= 0 ? layout.rowNumber + firstBlankPlayerIndex + 1 : rows.length + 1
    const startCol = columnLetter(layout.nameCol)
    const endCol = columnLetter(Math.max(layout.headers.length - 1, layout.nameCol))
    const values = layout.headers.slice(layout.nameCol).map((header) => operationalCampValueByHeader(header, registration))

    await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!${startCol}${targetRowNumber}:${endCol}${targetRowNumber}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ values: [values] }),
    })
    return { mode: firstBlankPlayerIndex >= 0 ? 'filled-blank-row' : 'appended-after-layout', rowNumber: targetRowNumber, startCol }
  }

  const row = operationalCampRowFromRegistration(registration)
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(tab)}!A:K:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
  return { mode: 'appended-fallback' }
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
    stripePaymentIntentSheetValue: row[23] || '', heardAboutCamp: row[24] || '',
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
    registration.heardAboutCamp || '',
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
  return emailAlreadySentInRows(rows, registrationId, type)
}

export function emailAlreadySentInRows(rows = [], registrationId, type) {
  return rows.slice(1).some((row) => row[1] === registrationId && row[2] === type && row[5] === 'sent')
}

export async function logEmail(sheetId, registration, type, status = 'sent', recipientEmail = registration.email) {
  await appendRow(sheetId, EMAIL_LOG_SHEET, [new Date().toISOString(), registration.registrationId, type, recipientEmail, registration.camp, status], LOG_HEADERS)
}

export async function sendRegistrationEmail({ sheetId, registration, type, emailLogRows = null }) {
  const template = String(type || '').startsWith('unpaid-reminder') || type === 'signup-payment-link' ? 'unpaid' : 'confirmed'
  const data = emailDataFromRegistration(registration)

  let customer = { skipped: true }
  const customerAlreadySent = emailLogRows
    ? emailAlreadySentInRows(emailLogRows, registration.registrationId, type)
    : await emailAlreadySent(sheetId, registration.registrationId, type)
  if (customerAlreadySent) {
    customer = { skipped: true, reason: 'already-sent' }
  } else {
    customer = await sendCampTransactionalEmail({
      toEmail: registration.email,
      toName: registration.parentName || registration.playerFirstName || registration.email,
      template,
      data,
    })
    await logEmail(sheetId, registration, type, 'sent', registration.email)
  }

  const adminResults = []
  if (template === 'confirmed') {
    for (const adminEmail of parseEmailList(CAMP_PAID_NOTIFICATION_EMAIL)) {
      const adminType = `${type || 'paid-confirmation'}-admin-${adminEmail}`
      const adminAlreadySent = emailLogRows
        ? emailAlreadySentInRows(emailLogRows, registration.registrationId, adminType)
        : await emailAlreadySent(sheetId, registration.registrationId, adminType)
      if (adminAlreadySent) {
        adminResults.push({ email: adminEmail, skipped: true, reason: 'already-sent' })
        continue
      }
      const admin = await sendCampTransactionalEmail({
        toEmail: adminEmail,
        toName: 'Joner Football Camps',
        template: 'confirmed',
        data: {
          ...data,
          subject: `PAID camp signup: ${clean(registration.playerFirstName)} ${clean(registration.playerSurname)} for ${clean(registration.camp)}`,
        },
      })
      await logEmail(sheetId, registration, adminType, 'sent', adminEmail)
      adminResults.push({ email: adminEmail, ...admin })
    }
  }

  return { skipped: false, sent: true, customer, admin: adminResults }
}
