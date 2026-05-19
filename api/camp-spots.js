const DEFAULT_SHEET_ID = '1SbGmivi3yqFaBKoMAhoNd5ufUga99DaQBj2noXNJr4k'
const PAID_SHEET = 'Paid Camp Registrations'
const CAMP_COLUMN_INDEX = 3 // column D ("Camp") in the registration schema

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) }
    catch (_) { return null }
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
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
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

async function readSheetRange(sheetId, range, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) return [] // tab missing or empty range
    const text = await res.text()
    throw new Error(`Sheet read failed: ${text}`)
  }
  const data = await res.json()
  return data.values || []
}

function countMatches(rows, campLower) {
  let n = 0
  for (let i = 1; i < rows.length; i++) {
    const v = rows[i]?.[CAMP_COLUMN_INDEX]
    if (typeof v === 'string' && v.trim().toLowerCase() === campLower) n++
  }
  return n
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const camp = (url.searchParams.get('camp') || '').trim()
  const baselineRaw = url.searchParams.get('baseline')
  const baseline = Math.max(0, parseInt(baselineRaw || '0', 10) || 0)

  if (!camp) return res.status(400).json({ success: false, error: 'camp query param is required' })
  if (!baseline) return res.status(400).json({ success: false, error: 'baseline query param is required and must be > 0' })

  res.setHeader('Cache-Control', 'no-store, max-age=0')

  const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID

  try {
    const token = await getGoogleAccessToken()
    const paid = await readSheetRange(sheetId, `${PAID_SHEET}!A:X`, token)
    const campLower = camp.toLowerCase()
    // Spots are reduced only after Stripe/payment confirmation writes to
    // Paid Camp Registrations. A form fill alone must not reduce scarcity.
    const taken = countMatches(paid, campLower)
    const spots = Math.max(0, baseline - taken)
    return res.status(200).json({ success: true, camp, baseline, taken, spots })
  } catch (error) {
    console.error('camp-spots error:', error?.message || error)
    // Fail soft, surface baseline so the UI never breaks the page
    return res.status(200).json({ success: false, camp, baseline, taken: 0, spots: baseline, error: 'sheet-unavailable' })
  }
}
