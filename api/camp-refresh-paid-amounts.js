import {
  DEFAULT_SHEET_ID,
  PAID_SHEET,
  readRows,
  updateCell,
  readSheetRange,
  findOperationalCampLayout,
  columnLetter,
  registrationFromRow,
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

async function stripeGet(key, path, params = null) {
  const query = params ? `?${params.toString()}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || `Stripe lookup failed with ${response.status}`)
  return data
}

async function retrieveSession(sessionId) {
  const keys = [process.env.STRIPE_SECRET_KEY, process.env.STRIPE_SECRET_KEY_SYDNEY].filter(Boolean)
  let lastError = null
  for (const key of keys) {
    try {
      const sessionParams = new URLSearchParams()
      sessionParams.append('expand[]', 'payment_intent.latest_charge.balance_transaction')
      const session = await stripeGet(key, `checkout/sessions/${encodeURIComponent(sessionId)}`, sessionParams)
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      if (paymentIntentId) {
        const paymentIntentParams = new URLSearchParams()
        paymentIntentParams.append('expand[]', 'latest_charge.balance_transaction')
        session.payment_intent = await stripeGet(key, `payment_intents/${encodeURIComponent(paymentIntentId)}`, paymentIntentParams)
        const charge = session.payment_intent?.latest_charge
        if (typeof charge === 'string') {
          const chargeParams = new URLSearchParams()
          chargeParams.append('expand[]', 'balance_transaction')
          session.payment_intent.latest_charge = await stripeGet(key, `charges/${encodeURIComponent(charge)}`, chargeParams)
        }
      }
      return session
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('Could not retrieve Stripe session')
}

function internalAudAmountFromSession(session) {
  const transaction = session?.payment_intent?.latest_charge?.balance_transaction
  const transactionNet = Number(transaction?.net)
  const transactionCurrency = String(transaction?.currency || '').toUpperCase()
  if (transactionCurrency === 'AUD' && Number.isFinite(transactionNet)) {
    return `$${(transactionNet / 100).toFixed(2)} AUD`
  }
  return ''
}

async function updateOperationalAmount(sheetId, registration, amount) {
  const campTab = campTabForRegistration(registration)
  if (!campTab || !amount) return { skipped: true, reason: 'no-tab-or-amount' }
  const campRows = await readSheetRange(sheetId, campTab, 'A:Z')
  const layout = findOperationalCampLayout(campRows)
  if (!layout) return { skipped: true, reason: 'layout-not-found', campTab }

  let operationalRowNumber = 0
  for (let index = layout.rowIndex + 1; index < campRows.length; index += 1) {
    const row = campRows[index] || []
    const email = String(row[layout.emailCol] || '').toLowerCase()
    const phone = layout.numberCol >= 0 ? String(row[layout.numberCol] || '') : ''
    const emailMatches = email && email === String(registration.email || '').toLowerCase()
    const phoneMatches = !phone || !registration.mobile || phone === String(registration.mobile || '')
    if (emailMatches && phoneMatches) {
      operationalRowNumber = index + 1
      break
    }
  }
  if (!operationalRowNumber) return { skipped: true, reason: 'operational-row-not-found', campTab }

  const normalisedHeaders = layout.headers.map((header) => clean(header || '', 80).toLowerCase().replace(/[^a-z0-9]/g, ''))
  const amountCol = normalisedHeaders.findIndex((value) => value === 'amount' || value === 'paid')
  if (amountCol < 0) return { skipped: true, reason: 'amount-column-not-found', campTab }

  await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(amountCol), amount)
  return { updated: true, campTab, rowNumber: operationalRowNumber }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    if (!authorized(req, body)) return res.status(401).json({ success: false, error: 'Unauthorized' })

    const sheetId = process.env.CAMP_REGISTRATION_SHEET_ID || DEFAULT_SHEET_ID
    const registrationIds = Array.isArray(body.registrationIds) ? body.registrationIds.map((id) => clean(id, 120)).filter(Boolean) : []
    const email = clean(body.email || '', 180).toLowerCase()
    const rows = await readRows(sheetId, PAID_SHEET)
    const results = []

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] || []
      const registration = registrationFromRow(row)
      const matchesRegistration = registrationIds.length && registrationIds.includes(registration.registrationId)
      const matchesEmail = email && String(registration.email || '').toLowerCase() === email
      if (!matchesRegistration && !matchesEmail) continue
      if (!registration.stripeCheckoutSessionId) {
        results.push({ registrationId: registration.registrationId, updated: false, reason: 'missing-session-id' })
        continue
      }
      const session = await retrieveSession(registration.stripeCheckoutSessionId)
      const netAmount = internalAudAmountFromSession(session)
      if (!netAmount) {
        results.push({ registrationId: registration.registrationId, updated: false, reason: 'net-not-available' })
        continue
      }
      await updateCell(sheetId, PAID_SHEET, i + 1, 'V', netAmount)
      registration.paidAmount = netAmount
      const operational = await updateOperationalAmount(sheetId, registration, netAmount)
      results.push({ registrationId: registration.registrationId, updated: true, amount: netAmount, operational })
    }

    return res.status(200).json({ success: true, count: results.length, results })
  } catch (error) {
    console.error('Camp refresh paid amounts failed:', error)
    return res.status(500).json({ success: false, error: 'Could not refresh paid amounts.' })
  }
}
