import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  updateCell,
  appendRow,
  readSheetRange,
  appendOperationalCampRow,
  registrationFromRow,
  rowFromRegistration,
  sendRegistrationEmail,
  clean,
} from './_camp-automation.js'

function authorized(req, body) {
  const secret = process.env.CAMP_PAYMENT_ADMIN_SECRET
  if (!secret) return false
  return body.secret === secret || req.headers['x-camp-payment-secret'] === secret
}

function campTabForRegistration(registration) {
  const explicit = clean(registration.sheetTab || '', 120)
  const explicitText = explicit.toLowerCase()
  if (explicitText.includes('houston')) return 'Texas Houston (June)'
  if (explicitText.includes('dallas')) return 'Texas Dallas (June)'
  if (explicitText.includes('sydney')) return 'Sydney big 1 (July)'
  if (explicit) return explicit
  const text = `${registration.camp} ${registration.source}`.toLowerCase()
  if (text.includes('houston')) return 'Texas Houston (June)'
  if (text.includes('dallas')) return 'Texas Dallas (June)'
  if (text.includes('sydney')) return 'Sydney big 1 (July)'
  if (text.includes('joner') && text.includes('junior')) return 'Joners Juniors'
  return clean(registration.camp || '', 120)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    if (!authorized(req, body)) return res.status(401).json({ success: false, error: 'Unauthorized' })

    const registrationId = clean(body.registrationId, 120)
    if (!registrationId) return res.status(400).json({ success: false, error: 'registrationId is required.' })

    const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID
    const pendingRows = await readRows(sheetId, PENDING_SHEET)
    let found = null
    let rowNumber = 0
    for (let i = 1; i < pendingRows.length; i++) {
      if (pendingRows[i]?.[1] === registrationId) {
        found = registrationFromRow(pendingRows[i])
        rowNumber = i + 1
        break
      }
    }

    if (!found) return res.status(404).json({ success: false, error: 'Registration not found in pending sheet.' })
    if (!found.email) return res.status(400).json({ success: false, error: 'Registration has no parent email.' })

    found.paymentStatus = 'paid'
    await updateCell(sheetId, PENDING_SHEET, rowNumber, 'C', 'paid')

    const paidRow = rowFromRegistration(found, 'paid')

    const paidRows = await readRows(sheetId, PAID_SHEET)
    const alreadyInPaidSheet = paidRows.slice(1).some((row) => row[1] === registrationId)
    if (!alreadyInPaidSheet) await appendRow(sheetId, PAID_SHEET, paidRow)

    const campTab = campTabForRegistration(found)
    let campSheet = 'not-configured'
  if (campTab) {
    const campRows = await readSheetRange(sheetId, campTab, 'A:J')
    const alreadyInCampTab = campRows.slice(1).some((row) => row[1] === registrationId)
    const alreadyInOperationalTab = campRows.slice(1).some((row) => {
      const email = String(row[5] || '').toLowerCase()
      const phone = String(row[6] || '')
      return email && email === String(found.email || '').toLowerCase() && phone === String(found.mobile || '')
    })
    if (!alreadyInCampTab && !alreadyInOperationalTab) await appendOperationalCampRow(sheetId, campTab, found)
    campSheet = alreadyInCampTab ? 'already-present' : campTab
  }

    const email = await sendRegistrationEmail({ sheetId, registration: found, type: 'paid-confirmation' })

    return res.status(200).json({
      success: true,
      registrationId,
      email,
      paidSheet: alreadyInPaidSheet ? 'already-present' : 'appended',
      campSheet,
    })
  } catch (error) {
    console.error('Camp payment confirm failed:', error)
    return res.status(500).json({ success: false, error: 'Could not confirm camp payment.' })
  }
}
