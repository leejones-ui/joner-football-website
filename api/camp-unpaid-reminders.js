import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  registrationFromRow,
  sendRegistrationEmail,
  emailAlreadySentInRows,
  logEmail,
  EMAIL_LOG_SHEET,
  LOG_HEADERS,
} from './_camp-automation.js'

const REMINDER_STAGES = [
  { type: 'internal-unpaid-admin-20m', label: '20 minutes internal admin alert', minutes: 20, maxMinutes: 60, internalOnly: true },
  { type: 'unpaid-reminder-1h', label: '1 hour', minutes: 60 },
  { type: 'unpaid-reminder-24h', label: '24 hours', minutes: 24 * 60 },
  { type: 'unpaid-reminder-7d', label: '7 days', minutes: 7 * 24 * 60 },
]

const CAMP_SIGNUP_EMAIL = process.env.CAMP_SIGNUP_EMAIL || 'joner1on1info@gmail.com'

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function adminRow(label, value) {
  return `<tr><td style="font-weight:bold;">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
}

async function sendInternalUnpaidAdminAlert({ sheetId, registration, emailLogRows }) {
  const apiKey = process.env.BREVO_API_KEY
  const recipients = parseEmailList(CAMP_SIGNUP_EMAIL)
  if (!apiKey || !recipients.length) return { skipped: true }

  const results = []
  for (const recipient of recipients) {
    const type = `internal-unpaid-admin-20m-${recipient}`
    const alreadySent = emailLogRows
      ? emailAlreadySentInRows(emailLogRows, registration.registrationId, type)
      : false
    if (alreadySent) {
      results.push({ email: recipient, skipped: true, reason: 'already-sent' })
      continue
    }

    const html = `
      <h2>Camp form submitted, payment not completed yet</h2>
      <p>This lead is still unpaid after 20+ minutes. The customer has not been sent this internal admin alert.</p>
      <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
        ${adminRow('Registration ID', registration.registrationId)}
        ${adminRow('Camp', registration.camp)}
        ${adminRow('Player first name', registration.playerFirstName)}
        ${adminRow('Player surname', registration.playerSurname)}
        ${adminRow('Parent name', registration.parentName)}
        ${adminRow('Email', registration.email)}
        ${adminRow('Mobile', registration.mobile)}
        ${adminRow('Number of days', registration.numberOfDays)}
        ${adminRow('Jersey size', registration.jerseySize)}
        ${adminRow('Payment link', registration.paymentLink)}
        ${adminRow('Submitted at', registration.submittedAt)}
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
        to: [{ email: recipient, name: 'Joner Football Camps' }],
        replyTo: { email: registration.email, name: registration.parentName || registration.playerFirstName || registration.email },
        subject: `NOT PAID YET camp signup: ${registration.playerFirstName} ${registration.playerSurname} for ${registration.camp}`,
        htmlContent: html,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.warn('Internal unpaid admin alert failed:', text)
      results.push({ email: recipient, skipped: false, failed: true })
      continue
    }

    await logEmail(sheetId, registration, type, 'sent', recipient)
    results.push({ email: recipient, skipped: false, failed: false })
  }

  return { skipped: false, sent: true, admin: results }
}

function isAuthorized(req) {
  const cronSecret = process.env.CRON_SECRET
  const manualSecret = process.env.CAMP_REMINDER_SECRET
  const auth = req.headers.authorization || ''
  const headerSecret = req.headers['x-camp-reminder-secret'] || ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (manualSecret && headerSecret === manualSecret) return true
  return false
}

function minutesSince(value) {
  const t = Date.parse(value || '')
  if (!Number.isFinite(t)) return 0
  return (Date.now() - t) / 60000
}

function internalAdminAlertAlreadySent(rows = [], registrationId, type) {
  return rows.slice(1).some((row) => row[1] === registrationId && String(row[2] || '').startsWith(type) && row[5] === 'sent')
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })

  const url = new URL(req.url, `https://${req.headers.host || 'jonerfootball.com'}`)
  const dryRun = url.searchParams.get('dryRun') === '1'
  const remindersEnabled = String(process.env.CAMP_REMINDERS_ENABLED || '').toLowerCase() === 'true'
  if (!dryRun && !remindersEnabled) {
    return res.status(200).json({ success: true, disabled: true, message: 'Camp unpaid reminders are disabled. Set CAMP_REMINDERS_ENABLED=true to send.' })
  }
  const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID

  try {
    const [pendingRows, paidRows, emailLogRows] = await Promise.all([
      readRows(sheetId, PENDING_SHEET),
      readRows(sheetId, PAID_SHEET),
      readRows(sheetId, EMAIL_LOG_SHEET, LOG_HEADERS),
    ])
    const paidIds = new Set(paidRows.slice(1).map((row) => row[1]).filter(Boolean))
    const candidates = []
    const stageCounts = Object.fromEntries(REMINDER_STAGES.map((stage) => [stage.type, 0]))

    for (let i = 1; i < pendingRows.length; i++) {
      const registration = registrationFromRow(pendingRows[i])
      if (!registration.registrationId || !registration.email) continue
      if (String(registration.paymentStatus || '').toLowerCase() === 'paid') continue
      if (paidIds.has(registration.registrationId)) continue

      const ageMinutes = minutesSince(registration.submittedAt)
      for (const stage of REMINDER_STAGES) {
        if (ageMinutes < stage.minutes) continue
        if (stage.maxMinutes && ageMinutes >= stage.maxMinutes) continue
        const alreadySent = stage.internalOnly
          ? internalAdminAlertAlreadySent(emailLogRows, registration.registrationId, stage.type)
          : emailAlreadySentInRows(emailLogRows, registration.registrationId, stage.type)
        if (alreadySent) continue
        candidates.push({ registration, stage, ageMinutes: Math.round(ageMinutes) })
        stageCounts[stage.type] += 1
        break
      }
    }

    const results = []
    if (!dryRun) {
      for (const candidate of candidates) {
        try {
          const email = candidate.stage.internalOnly
            ? await sendInternalUnpaidAdminAlert({ sheetId, registration: candidate.registration, emailLogRows })
            : await sendRegistrationEmail({ sheetId, registration: candidate.registration, type: candidate.stage.type, emailLogRows })
          results.push({ registrationId: candidate.registration.registrationId, reminder: candidate.stage.type, email })
        } catch (error) {
          console.warn('Unpaid reminder failed:', candidate.registration.registrationId, candidate.stage.type, error?.message || error)
          results.push({ registrationId: candidate.registration.registrationId, reminder: candidate.stage.type, error: 'send-failed' })
        }
      }
    }

    return res.status(200).json({ success: true, dryRun, stages: REMINDER_STAGES, candidates: candidates.length, stageCounts, results })
  } catch (error) {
    console.error('Camp unpaid reminders failed:', error)
    return res.status(500).json({ success: false, error: 'Could not process unpaid reminders.' })
  }
}
