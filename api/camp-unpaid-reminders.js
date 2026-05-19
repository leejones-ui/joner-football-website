import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  registrationFromRow,
  sendRegistrationEmail,
  emailAlreadySent,
} from './_camp-automation.js'

const REMINDER_STAGES = [
  { type: 'unpaid-reminder-1h', label: '1 hour', minutes: 60 },
  { type: 'unpaid-reminder-24h', label: '24 hours', minutes: 24 * 60 },
  { type: 'unpaid-reminder-7d', label: '7 days', minutes: 7 * 24 * 60 },
]

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
  const dryRun = url.searchParams.get('dryRun') === '1'
  const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID

  try {
    const [pendingRows, paidRows] = await Promise.all([
      readRows(sheetId, PENDING_SHEET),
      readRows(sheetId, PAID_SHEET),
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
        const alreadySent = await emailAlreadySent(sheetId, registration.registrationId, stage.type)
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
          const email = await sendRegistrationEmail({ sheetId, registration: candidate.registration, type: candidate.stage.type })
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
