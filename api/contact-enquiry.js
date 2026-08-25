import { cleanString, protectForm } from './_security.js'
import { validateEmailFormat, validateEmailQuality } from './_email-quality.js'
import { extractAttribution, extractMetaIdentity } from './_attribution.js'

const FALLBACK_RECIPIENT_EMAIL = process.env.CONTACT_FORM_RECIPIENT_EMAIL || 'leejones@jonerfootball.com'
export const JONERS_JUNIORS_RECIPIENT_EMAIL = 'jonersjuniors@jonerfootball.com'
export const TEAM_SUBSCRIPTIONS_RECIPIENT_EMAILS = ['teams@jonerfootball.com', 'Reswin@jonerfootball.com']
const duplicateBuckets = new Map()
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_WAIVER_TABLE = 'JFP Waiver & Player Info'
const DEFAULT_TEAM_SUBSCRIPTIONS_SHEET_ID = '1KB5m7KwQPM7D0ctBY7H23x-2oUYSaiX-GJV0jlyYBvw'
export const TEAM_SUBSCRIPTIONS_SHEET = process.env.TEAM_SUBSCRIPTIONS_SHEET_TAB || 'Hot Leads'
export const TEAM_SUBSCRIPTIONS_HEADERS = [
  'Submitted At',
  'Lead ID',
  'Priority',
  'Due Date',
  'Action',
  'Status',
  'Name',
  'Email',
  'Phone',
  'Club / Team',
  'Number Of Players',
  'Number Of Coaches',
  'Location',
  'Owner',
  'Last Contact',
  'Next Action',
  'Source',
  'Message',
  'Notes',
]

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
  'joners-juniors': JONERS_JUNIORS_RECIPIENT_EMAIL,
  'coaching-role': process.env.CONTACT_COACHING_EMAIL || FALLBACK_RECIPIENT_EMAIL,
  'team-subscriptions': TEAM_SUBSCRIPTIONS_RECIPIENT_EMAILS.join(','),
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

export function isAccepted(value) {
  if (value === true) return true
  return ['true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase())
}

export function normaliseProgramme(value) {
  const programme = clean(value, 80).toLowerCase().replace(/[^a-z]/g, '')
  return programme === 'jonersjuniors' || programme === 'juniors' ? 'Joners Juniors' : 'JFP'
}

export function buildLeadAttribution(body = {}, submittedAt = new Date().toISOString()) {
  const utm = extractAttribution(body)
  const eventTime = Math.floor(Date.parse(submittedAt) / 1000) || Math.floor(Date.now() / 1000)
  const meta = extractMetaIdentity(body, eventTime)
  const campaign = clean(body.campaign_name || utm.utm_campaign, 240)
  const adSet = clean(body.adset_name || utm.utm_term, 240)
  const ad = clean(body.ad_name || utm.utm_content, 240)
  const rawSource = clean(utm.utm_source, 180)
  const rawMedium = clean(utm.utm_medium, 180)
  const hasMetaClick = Boolean(meta.fbclid || meta.fbc)
  const isMetaSource = hasMetaClick || /^(facebook|instagram|meta|fb|ig)(?:$|[\s_-])/i.test(rawSource)
  const hasPaidSignal = Boolean(
    hasMetaClick || body.campaign_id || body.adset_id || body.ad_id ||
    /(?:paid|cpc|ppc|display|retarget)/i.test(rawMedium)
  )
  const trafficSource = isMetaSource
    ? (hasPaidSignal ? 'Facebook / Instagram Ads' : 'Facebook / Instagram Organic')
    : (rawSource || (clean(body.referrer, 1200) ? 'Referral / untagged' : 'Direct / untagged'))

  return {
    trafficSource,
    utmSource: rawSource,
    utmMedium: clean(utm.utm_medium, 180),
    campaign,
    campaignId: clean(body.campaign_id || body.utm_id, 180),
    adSet,
    adSetId: clean(body.adset_id, 180),
    ad,
    adId: clean(body.ad_id, 180),
    placement: clean(body.placement, 180),
    fbclid: clean(meta.fbclid, 500),
    landingPage: clean(body.landing_page || body.landingPage, 1200),
    referrer: clean(body.referrer, 1200),
  }
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
      authorization: `Bearer ${token}`,
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

async function ensureTeamSubscriptionsSheet(sheetId) {
  const title = TEAM_SUBSCRIPTIONS_SHEET
  const meta = await sheetsFetch(`${sheetId}?fields=sheets.properties.title`)
  const exists = meta.sheets?.some((sheet) => sheet.properties?.title === title)
  if (!exists) {
    await sheetsFetch(`${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    })
  }

  const headerRange = `${encodeURIComponent(title)}!A1:S1`
  const current = await sheetsFetch(`${sheetId}/values/${headerRange}`)
  const currentHeaders = current.values?.[0] || []
  const missingHeaders = TEAM_SUBSCRIPTIONS_HEADERS.some((header, index) => currentHeaders[index] !== header)
  if (missingHeaders) {
    await sheetsFetch(`${sheetId}/values/${headerRange}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [TEAM_SUBSCRIPTIONS_HEADERS] }),
    })
  }
}

export function buildTeamSubscriptionRow(enquiry) {
  const submittedAt = String(enquiry.submittedAt || new Date().toISOString())
  const leadId = `web_${submittedAt.replace(/\D/g, '').slice(0, 14)}_${base64url(enquiry.email).slice(0, 8)}`
  const attribution = enquiry.attribution || {}
  const attributionNotes = [
    ['Traffic Source', attribution.trafficSource],
    ['UTM Source', attribution.utmSource],
    ['UTM Medium', attribution.utmMedium],
    ['Campaign', attribution.campaign],
    ['Campaign ID', attribution.campaignId],
    ['Ad Set', attribution.adSet],
    ['Ad Set ID', attribution.adSetId],
    ['Ad', attribution.ad],
    ['Ad ID', attribution.adId],
    ['Placement', attribution.placement],
    ['Facebook Click ID', attribution.fbclid],
    ['Landing Page', attribution.landingPage],
    ['Referrer', attribution.referrer],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join(' | ')
  return [
    submittedAt,
    leadId,
    'P1',
    submittedAt.slice(0, 10),
    'Reply and qualify',
    'New enquiry',
    enquiry.name,
    enquiry.email,
    enquiry.phone,
    enquiry.clubTeam,
    enquiry.numberOfPlayers,
    enquiry.numberOfCoaches,
    enquiry.location,
    'Lee / Reswin',
    '',
    'Reply with team pricing and setup questions',
    'jonerfootball.com/teams',
    enquiry.message || 'Team subscription enquiry',
    attributionNotes,
  ]
}

async function appendTeamSubscriptionLead(enquiry) {
  if (enquiry.type !== 'team-subscriptions') return
  const sheetId = process.env.TEAM_SUBSCRIPTIONS_SHEET_ID || DEFAULT_TEAM_SUBSCRIPTIONS_SHEET_ID
  if (!sheetId) throw new Error('Team subscriptions sheet is not configured.')
  await ensureTeamSubscriptionsSheet(sheetId)
  const row = buildTeamSubscriptionRow(enquiry)
  await sheetsFetch(`${sheetId}/values/${encodeURIComponent(TEAM_SUBSCRIPTIONS_SHEET)}!A:S:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  })
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

function numberInRange(value, min, max) {
  const text = clean(value, 40)
  if (!/^\d{1,4}$/.test(text)) return false
  const number = Number(text)
  return Number.isInteger(number) && number >= min && number <= max
}

function isLikelyBotSubmission(enquiry) {
  const fields = [
    enquiry.name,
    enquiry.location,
    enquiry.clubTeam,
    enquiry.playerName,
    enquiry.playerAge,
    enquiry.playerLevel,
    enquiry.message,
  ]
  return fields.filter(looksLikeRandomToken).length >= 2
}

export function isLikelyBotTeamSubmission(enquiry) {
  if (enquiry.type !== 'team-subscriptions') return false
  // Large clubs can legitimately submit four-digit player counts. Keep a
  // generous sanity ceiling for bot protection without rejecting real clubs.
  if (!numberInRange(enquiry.numberOfPlayers, 1, 10000)) return true
  if (!numberInRange(enquiry.numberOfCoaches, 1, 1000)) return true
  const identityFields = [enquiry.name, enquiry.location, enquiry.clubTeam]
  if (identityFields.filter(looksLikeRandomToken).length >= 1) return true
  if (/^[a-z]{1,3}\d{6,}$/i.test(enquiry.name)) return true
  return false
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

async function findExistingWaiverRecord({ playerFullName, email, term, programme }) {
  const programmeFormula = programme === 'JFP'
    ? `OR({Programme}='JFP',{Programme}=BLANK())`
    : `{Programme}='${escapeFormulaValue(programme)}'`
  const formula = `AND(LOWER({Parent Email})='${escapeFormulaValue(email.toLowerCase())}',LOWER({Player Full Name})='${escapeFormulaValue(playerFullName.toLowerCase())}',{Term}='${escapeFormulaValue(term)}',${programmeFormula})`
  const params = new URLSearchParams({
    maxRecords: '1',
    filterByFormula: formula,
  })
  const data = await airtableRequest(`?${params.toString()}`, { method: 'GET' })
  return data.records?.[0]?.id || null
}

function buildWaiverSummary(body) {
  const term = clean(body.term, 80) || 'Term 3 2026'
  const programme = normaliseProgramme(body.programme)
  const parts = [
    `Joner Football Programme Waiver and Agreement accepted for ${programme}, ${term}.`,
    'Parent/guardian confirms the player details, emergency contact details and medical information supplied are accurate.',
    'Parent/guardian understands football training includes running, striking the ball, changes of direction, physical contact, group activity and normal physical risk.',
    'Parent/guardian confirms the player is fit to participate unless medical notes have been listed on this form.',
    'Parent/guardian authorises Joner Football staff to seek urgent medical assistance or emergency treatment if needed during a session.',
    'Parent/guardian understands that once a spot is confirmed, the player is locked in for the full term and payment is required.',
    'Parent/guardian understands payment must be made before the term starts unless Dean or Ligia approve another arrangement in writing.',
    'Parent/guardian understands no make-up sessions are offered for missed sessions, late arrival or non-attendance.',
    'Parent/guardian understands the waiver must be completed before the player trains or kicks a ball.',
  ]
  const medical = clean(body.medicalNotes, 1200)
  if (medical) parts.push(`Medical notes supplied: ${medical}`)
  return parts.join('\n')
}

async function handlePlayerWaiver(body, res) {
  const submitted = {
    programme: normaliseProgramme(body.programme),
    playerFullName: clean(body.playerFullName, 180),
    dob: clean(body.dob, 80),
    parentName: clean(body.parentName, 180),
    currentClub: clean(body.currentClub, 180),
    email: clean(body.email, 220).toLowerCase(),
    mobileNumber: clean(body.mobileNumber, 80),
    playerMobileNumber: clean(body.playerMobileNumber, 80),
    medicalNotes: clean(body.medicalNotes, 1200),
    emergencyContactName: clean(body.emergencyContactName, 180),
    emergencyContactPhone: clean(body.emergencyContactPhone, 80),
    term: clean(body.term, 80) || 'Term 3 2026',
    paymentCommitmentAccepted: isAccepted(body.paymentCommitmentAccepted),
    noMakeUpAccepted: isAccepted(body.noMakeUpAccepted),
    emergencyTreatmentPermission: isAccepted(body.emergencyTreatmentPermission),
    mediaPermission: isAccepted(body.mediaPermission),
    waiverAccepted: isAccepted(body.waiverAccepted),
    parentSignature: clean(body.parentSignature, 180),
  }

  if (!submitted.playerFullName || !submitted.dob || !submitted.parentName || !submitted.email || !submitted.mobileNumber || !submitted.emergencyContactName || !submitted.emergencyContactPhone) {
    return res.status(400).json({ success: false, error: 'Please complete all required player, parent and emergency contact fields.' })
  }
  const emailCheck = await validateEmailQuality(submitted.email, { label: 'parent email' })
  if (!emailCheck.ok) {
    return res.status(400).json({ success: false, error: emailCheck.error || 'Please enter a valid parent email address.' })
  }
  submitted.email = emailCheck.email
  if (!submitted.paymentCommitmentAccepted || !submitted.noMakeUpAccepted || !submitted.emergencyTreatmentPermission || !submitted.waiverAccepted || !submitted.parentSignature) {
    return res.status(400).json({ success: false, error: 'Please accept the waiver, payment terms, no make-up sessions, emergency treatment permission and add the parent/guardian signature.' })
  }

  const signedAt = new Date().toISOString()
  const fields = {
    'Programme': submitted.programme,
    'Player Full Name': submitted.playerFullName,
    'Date of Birth': submitted.dob,
    'Parent/Guardian Name': submitted.parentName,
    'Parent Email': submitted.email,
    'Parent Mobile Number': submitted.mobileNumber,
    'Player Mobile Number': submitted.playerMobileNumber,
    'Current Club': submitted.currentClub,
    'Medical Notes': submitted.medicalNotes || 'None supplied',
    'Emergency Contact Name': submitted.emergencyContactName,
    'Emergency Contact Phone': submitted.emergencyContactPhone,
    Term: submitted.term,
    'Waiver Version': 'Joner Football Term 3 2026 combined waiver v3',
    'Waiver Accepted - Full Terms': true,
    'No Make-Up Sessions Accepted': true,
    'Payment Terms Accepted - Full Term': true,
    'Emergency Treatment Permission': true,
    'Media Permission': Boolean(submitted.mediaPermission),
    'Parent/Guardian Signature': submitted.parentSignature,
    'Signed Date': signedAt.slice(0, 10),
    'Form Review Status': 'Needs Review',
    'Spot Confirmed': true,
    'JFP Program Waiver and Agreement': buildWaiverSummary(submitted),
    'Joner Football Programme Waiver and Agreement': buildWaiverSummary(submitted),
    'Internal Notes': `${submitted.programme} submission from jonerfootball.com/player-waiver on ${signedAt}`,
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
      ${enquiry.type === 'team-subscriptions' ? row('Traffic source', enquiry.attribution.trafficSource) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('UTM source / medium', [enquiry.attribution.utmSource, enquiry.attribution.utmMedium].filter(Boolean).join(' / ')) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Campaign', enquiry.attribution.campaign) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Ad set', enquiry.attribution.adSet) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Ad', enquiry.attribution.ad) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Campaign / ad IDs', [enquiry.attribution.campaignId, enquiry.attribution.adSetId, enquiry.attribution.adId].filter(Boolean).join(' / ')) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Placement', enquiry.attribution.placement) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Facebook click captured', enquiry.attribution.fbclid ? 'Yes' : 'No') : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Landing page', enquiry.attribution.landingPage) : ''}
      ${enquiry.type === 'team-subscriptions' ? row('Referrer', enquiry.attribution.referrer) : ''}
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
    const submittedAt = new Date().toISOString()
    const enquiry = {
      submittedAt,
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
      attribution: buildLeadAttribution(body, submittedAt),
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

    if (isLikelyBotSubmission(enquiry) || isLikelyBotTeamSubmission(enquiry)) {
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
    try {
      await appendTeamSubscriptionLead(enquiry)
    } catch (sheetError) {
      console.error('Team subscription sheet append failed:', sheetError)
    }
    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Contact enquiry failed:', error)
    return res.status(500).json({ success: false, error: 'Enquiry could not be sent. Please try again.' })
  }
}
