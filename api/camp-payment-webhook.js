import { verifyStripeWebhook } from './_stripe-webhook.js'
import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  updateCell,
  appendRow,
  registrationFromRow,
  rowFromRegistration,
  sendRegistrationEmail,
  clean,
} from './_camp-automation.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

async function verifyCampPaymentWebhook(rawBody, signatureHeader) {
  const secrets = [
    process.env.STRIPE_CAMP_WEBHOOK_SECRET,
    process.env.STRIPE_CAMP_WEBHOOK_SECRET_SYDNEY,
  ].filter(Boolean)

  if (!secrets.length) throw new Error('Stripe camp webhook secret is not configured.')

  let lastError = null
  for (const secret of secrets) {
    try {
      await verifyStripeWebhook(rawBody, signatureHeader, secret)
      return true
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Invalid Stripe signature.')
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && Object.keys(req.body).length) return JSON.stringify(req.body)

  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function registrationIdFromSession(session) {
  return clean(
    session?.metadata?.registrationId ||
    session?.payment_intent?.metadata?.registrationId ||
    session?.client_reference_id ||
    '',
    120
  )
}

function campTabForRegistration(registration) {
  const explicit = clean(registration.sheetTab || '', 120)
  if (explicit) return explicit
  const text = `${registration.camp} ${registration.source}`.toLowerCase()
  if (text.includes('houston')) return 'Houston'
  if (text.includes('dallas')) return 'Dallas'
  if (text.includes('sydney')) return 'Sydney big 1 (July)'
  if (text.includes('joner') && text.includes('junior')) return 'Joners Juniors'
  return clean(registration.camp || '', 120)
}

async function confirmPaidRegistration(registrationId) {
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

  if (!found) {
    const paidRows = await readRows(sheetId, PAID_SHEET)
    const alreadyPaid = paidRows.slice(1).find((row) => row[1] === registrationId)
    if (alreadyPaid) return { registrationId, status: 'already-paid' }
    throw new Error(`Registration not found: ${registrationId}`)
  }

  found.paymentStatus = 'paid'
  await updateCell(sheetId, PENDING_SHEET, rowNumber, 'C', 'paid')

  const paidRow = rowFromRegistration(found, 'paid')

  const paidRows = await readRows(sheetId, PAID_SHEET)
  const alreadyInPaidSheet = paidRows.slice(1).some((row) => row[1] === registrationId)
  if (!alreadyInPaidSheet) await appendRow(sheetId, PAID_SHEET, paidRow)

  const campTab = campTabForRegistration(found)
  let campSheet = 'not-configured'
  if (campTab) {
    const campRows = await readRows(sheetId, campTab)
    const alreadyInCampTab = campRows.slice(1).some((row) => row[1] === registrationId)
    if (!alreadyInCampTab) await appendRow(sheetId, campTab, paidRow)
    campSheet = alreadyInCampTab ? 'already-present' : campTab
  }

  const email = await sendRegistrationEmail({ sheetId, registration: found, type: 'paid-confirmation' })
  return {
    registrationId,
    status: 'paid-confirmed',
    paidSheet: alreadyInPaidSheet ? 'already-present' : 'appended',
    campSheet,
    email,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)
    await verifyCampPaymentWebhook(rawBody, req.headers['stripe-signature'])
    const event = JSON.parse(rawBody)

    const handledTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])
    let result = { ignored: true, type: event.type }

    if (handledTypes.has(event.type)) {
      const session = event.data.object
      const paymentStatus = String(session.payment_status || '').toLowerCase()
      if (paymentStatus && paymentStatus !== 'paid') {
        result = { ignored: true, reason: 'not-paid', paymentStatus }
      } else {
        const registrationId = registrationIdFromSession(session)
        if (!registrationId) throw new Error('Stripe session missing registrationId metadata.')
        result = await confirmPaidRegistration(registrationId)
      }
    }

    return res.status(200).json({ received: true, result })
  } catch (error) {
    console.error('Camp payment webhook failed:', error)
    return res.status(400).json({ success: false, error: error.message || 'Webhook failed.' })
  }
}
