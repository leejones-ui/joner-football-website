import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  registrationFromRow,
  sendRegistrationEmail,
} from './_camp-automation.js'

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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized' })

  const url = new URL(req.url, `https://${req.headers.host || 'jonerfootball.com'}`)
  const minAgeMinutes = Math.max(15, Number(url.searchParams.get('minAgeMinutes') || process.env.CAMP_UNPAID_REMINDER_MINUTES || 60))
  const dryRun = url.searchParams.get('dryRun') === '1'
  const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID

  try {
    const [pendingRows, paidRows] = await Promise.all([
      readRows(sheetId, PENDING_SHEET),
      readRows(sheetId, PAID_SHEET),
    ])
    const paidIds = new Set(paidRows.slice(1).map((row) => row[1]).filter(Boolean))
    const candidates = []

    for (let i = 1; i < pendingRows.length; i++) {
      const registration = registrationFromRow(pendingRows[i])
      if (!registration.registrationId || !registration.email) continue
      if (String(registration.paymentStatus || '').toLowerCase() === 'paid') continue
      if (paidIds.has(registration.registrationId)) continue
      if (minutesSince(registration.submittedAt) < minAgeMinutes) continue
      candidates.push(registration)
    }

    const results = []
    if (!dryRun) {
      for (const registration of candidates) {
        try {
          const email = await sendRegistrationEmail({ sheetId, registration, type: 'unpaid-reminder' })
          results.push({ registrationId: registration.registrationId, email })
        } catch (error) {
          console.warn('Unpaid reminder failed:', registration.registrationId, error?.message || error)
          results.push({ registrationId: registration.registrationId, error: 'send-failed' })
        }
      }
    }

    return res.status(200).json({ success: true, dryRun, minAgeMinutes, candidates: candidates.length, results })
  } catch (error) {
    console.error('Camp unpaid reminders failed:', error)
    return res.status(500).json({ success: false, error: 'Could not process unpaid reminders.' })
  }
}
