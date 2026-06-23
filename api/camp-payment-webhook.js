import { verifyStripeWebhook } from './_stripe-webhook.js'
import {
  DEFAULT_SHEET_ID,
  PENDING_SHEET,
  PAID_SHEET,
  readRows,
  updateCell,
  appendRow,
  readSheetRange,
  deletePendingRegistrationRow,
  appendOperationalCampRow,
  findOperationalCampLayout,
  ensureOperationalMarketingColumns,
  resolveSheetTitle,
  columnLetter,
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

function stripeSecretKeys() {
  return [
    process.env.STRIPE_SECRET_KEY,
    process.env.STRIPE_SECRET_KEY_SYDNEY,
  ].filter(Boolean)
}

async function retrieveStripeCheckoutSession(sessionId) {
  const keys = stripeSecretKeys()

  let lastError = null
  for (const key of keys) {
    try {
      const params = new URLSearchParams()
      params.append('expand[]', 'payment_intent.latest_charge.balance_transaction')
      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data?.id === sessionId) {
        await hydrateSessionFinancials(data, key)
        data._stripeDashboardAccountId = await retrieveStripeAccountId(key)
        return data
      }
      lastError = new Error(data?.error?.message || `Stripe lookup failed with ${response.status}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Could not verify Checkout Session with Stripe.')
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  const keys = stripeSecretKeys()

  let lastError = null
  const params = new URLSearchParams()
  params.append('expand[]', 'latest_charge.balance_transaction')

  for (const key of keys) {
    try {
      const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data?.id === paymentIntentId) {
        const wrapper = { payment_intent: data }
        await hydrateSessionFinancials(wrapper, key)
        data._stripeDashboardAccountId = await retrieveStripeAccountId(key)
        return data
      }
      lastError = new Error(data?.error?.message || `Stripe PaymentIntent lookup failed with ${response.status}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Could not verify PaymentIntent with Stripe.')
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

async function hydrateSessionFinancials(session, key) {
  const paymentIntentId = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id
  if (!paymentIntentId) return session

  const paymentIntentParams = new URLSearchParams()
  paymentIntentParams.append('expand[]', 'latest_charge.balance_transaction')

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const paymentIntent = await stripeGet(key, `payment_intents/${encodeURIComponent(paymentIntentId)}`, paymentIntentParams)
    session.payment_intent = paymentIntent

    const charge = paymentIntent?.latest_charge
    const balanceTransaction = charge?.balance_transaction
    if (balanceTransaction && typeof balanceTransaction === 'object') return session

    if (charge && typeof charge === 'object' && typeof balanceTransaction === 'string') {
      charge.balance_transaction = await stripeGet(key, `balance_transactions/${encodeURIComponent(balanceTransaction)}`)
      return session
    }

    if (typeof charge === 'string') {
      const chargeParams = new URLSearchParams()
      chargeParams.append('expand[]', 'balance_transaction')
      paymentIntent.latest_charge = await stripeGet(key, `charges/${encodeURIComponent(charge)}`, chargeParams)
      if (paymentIntent.latest_charge?.balance_transaction) return session
    }

    // Stripe can create/finalise the balance transaction a few seconds after
    // Checkout completes. Wait briefly so Lee's operational Sheet gets the
    // true net AUD after fees rather than the gross customer-facing amount.
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return session
}

async function retrieveStripeAccountId(secretKey) {
  try {
    const response = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const data = await response.json().catch(() => ({}))
    return response.ok && data?.id ? data.id : ''
  } catch (error) {
    console.warn('Could not retrieve Stripe account ID for dashboard link:', error?.message)
    return ''
  }
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

function registrationIdFromPaymentIntent(paymentIntent) {
  return clean(paymentIntent?.metadata?.registrationId || '', 120)
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

function paidAmountFromSession(session) {
  const amount = Number(session?.amount_total ?? session?.amount_received ?? session?.amount)
  const currency = String(session?.currency || '').toUpperCase()
  if (!Number.isFinite(amount) || amount <= 0) return ''
  const major = amount / 100
  return currency ? `$${major.toFixed(2)} ${currency}` : `$${major.toFixed(2)}`
}

function internalAudAmountFromSession(session) {
  const paymentIntent = session?.payment_intent || session
  const transaction = paymentIntent?.latest_charge?.balance_transaction
  const transactionNet = Number(transaction?.net)
  const transactionCurrency = String(transaction?.currency || '').toUpperCase()

  // Lee's camp operational tabs track the true net AUD received after Stripe fees.
  // Stripe's balance transaction is the safest source because it carries Stripe's
  // actual conversion and fee data. For USA payments, Stripe converts the USD
  // payment into the account settlement currency, so `net` is the number Lee
  // wants for profit tracking.
  if (transactionCurrency === 'AUD' && Number.isFinite(transactionNet)) {
    return `$${(transactionNet / 100).toFixed(2)} AUD`
  }

  // Fallback only: if Stripe has not exposed the balance transaction yet, keep
  // the exact paid AUD total from Checkout. A later webhook resend can fill net.
  const checkoutCurrency = String(session?.currency || paymentIntent?.currency || '').toUpperCase()
  const checkoutAmount = Number(session?.amount_total ?? paymentIntent?.amount_received ?? paymentIntent?.amount)
  if (checkoutCurrency === 'AUD' && Number.isFinite(checkoutAmount)) {
    return `$${(checkoutAmount / 100).toFixed(2)} AUD`
  }

  return paidAmountFromSession(session)
}

function stripePaymentIntentDashboardUrl(paymentIntentId, accountId = '') {
  const cleanPaymentIntentId = clean(paymentIntentId || '', 120)
  const cleanAccountId = clean(accountId || '', 80)
  if (!cleanPaymentIntentId) return ''
  if (cleanAccountId) {
    return `https://dashboard.stripe.com/${encodeURIComponent(cleanAccountId)}/payments/${encodeURIComponent(cleanPaymentIntentId)}`
  }
  return `https://dashboard.stripe.com/payments/${encodeURIComponent(cleanPaymentIntentId)}`
}

function stripePaymentIntentSheetValue(paymentIntentId, accountId = '') {
  const cleanPaymentIntentId = clean(paymentIntentId || '', 120)
  const url = stripePaymentIntentDashboardUrl(cleanPaymentIntentId, accountId)
  if (!cleanPaymentIntentId || !url) return ''
  return `=HYPERLINK("${url.replace(/"/g, '""')}", "${cleanPaymentIntentId.replace(/"/g, '""')}")`
}

async function confirmPaidRegistration(registrationId, paymentDetails = {}) {
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
    let paidRowNumber = 0
    const alreadyPaid = paidRows.slice(1).find((row, index) => {
      if (row[1] === registrationId) {
        paidRowNumber = index + 2
        return true
      }
      return false
    })
    if (alreadyPaid) {
      found = registrationFromRow(alreadyPaid)
      found.paymentStatus = 'paid'
      if (paymentDetails.paidAmount) found.paidAmount = paymentDetails.paidAmount
      if (paymentDetails.stripeCheckoutSessionId) found.stripeCheckoutSessionId = paymentDetails.stripeCheckoutSessionId
      if (paymentDetails.stripePaymentIntentId) found.stripePaymentIntentId = paymentDetails.stripePaymentIntentId
      if (paymentDetails.stripePaymentIntentSheetValue) found.stripePaymentIntentSheetValue = paymentDetails.stripePaymentIntentSheetValue

      if (found.paidAmount) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'V', found.paidAmount)
      if (found.heardAboutCamp) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'Y', found.heardAboutCamp)
      if (found.stripeCheckoutSessionId) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'W', found.stripeCheckoutSessionId)
      if (found.stripePaymentIntentSheetValue || found.stripePaymentIntentId) {
        await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'X', found.stripePaymentIntentSheetValue || found.stripePaymentIntentId, 'USER_ENTERED')
      }

      const campTab = await resolveSheetTitle(sheetId, campTabForRegistration(found))
      let campSheet = 'not-configured'
      if (campTab) {
        const campRows = await readSheetRange(sheetId, campTab, 'A:Z')
        let layout = findOperationalCampLayout(campRows)
        if (layout) layout = await ensureOperationalMarketingColumns(sheetId, campTab, layout)
        let operationalRowNumber = 0
        if (layout) {
          for (let index = layout.rowIndex + 1; index < campRows.length; index += 1) {
            const row = campRows[index] || []
            const email = String(row[layout.emailCol] || '').toLowerCase()
            const phone = layout.numberCol >= 0 ? String(row[layout.numberCol] || '') : ''
            const emailMatches = email && email === String(found.email || '').toLowerCase()
            const phoneMatches = !phone || !found.mobile || phone === String(found.mobile || '')
            if (emailMatches && phoneMatches) {
              operationalRowNumber = index + 1
              break
            }
          }
          if (operationalRowNumber) {
            const normalisedHeaders = layout.headers.map((header) => clean(header || '', 80).toLowerCase().replace(/[^a-z0-9]/g, ''))
            const amountCol = normalisedHeaders.findIndex((value) => ['amount', 'paid', 'aud', 'amountaud', 'netaud', 'netamountaud', 'netamountaudafterfees', 'audafterfees'].includes(value))
            const doneCol = normalisedHeaders.findIndex((value) => ['donebefore', 'previouscamp', 'beenbefore', 'donecampbefore'].includes(value))
            const heardCol = normalisedHeaders.findIndex((value) => ['heardaboutcamp', 'heardabout', 'whereheard', 'wheredidyouhearaboutcamp', 'wheredidyouhearaboutthecamp', 'source'].includes(value))
            if (amountCol >= 0) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(amountCol), found.paidAmount)
            if (doneCol >= 0 && found.previousCamp) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(doneCol), found.previousCamp)
            if (heardCol >= 0 && found.heardAboutCamp) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(heardCol), found.heardAboutCamp)
          }
        }
        campSheet = operationalRowNumber ? 'amount-updated' : 'already-paid-no-operational-row-match'
      }

      return { registrationId, status: 'already-paid-updated', paidSheet: 'amount-updated', campSheet }
    }
    throw new Error(`Registration not found: ${registrationId}`)
  }

  found.paymentStatus = 'paid'
  if (paymentDetails.paidAmount) found.paidAmount = paymentDetails.paidAmount
  if (paymentDetails.stripeCheckoutSessionId) found.stripeCheckoutSessionId = paymentDetails.stripeCheckoutSessionId
  if (paymentDetails.stripePaymentIntentId) found.stripePaymentIntentId = paymentDetails.stripePaymentIntentId
  if (paymentDetails.stripePaymentIntentSheetValue) found.stripePaymentIntentSheetValue = paymentDetails.stripePaymentIntentSheetValue
  await updateCell(sheetId, PENDING_SHEET, rowNumber, 'C', 'paid')

  const paidRow = rowFromRegistration(found, 'paid')

  const paidRows = await readRows(sheetId, PAID_SHEET)
  let paidRowNumber = 0
  const alreadyInPaidSheet = paidRows.slice(1).some((row, index) => {
    if (row[1] === registrationId) {
      paidRowNumber = index + 2
      return true
    }
    return false
  })
  if (!alreadyInPaidSheet) {
    await appendRow(sheetId, PAID_SHEET, paidRow, undefined, 'USER_ENTERED')
  } else {
    if (found.paidAmount) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'V', found.paidAmount)
    if (found.heardAboutCamp) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'Y', found.heardAboutCamp)
    if (found.stripeCheckoutSessionId) await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'W', found.stripeCheckoutSessionId)
    if (found.stripePaymentIntentSheetValue || found.stripePaymentIntentId) {
      await updateCell(sheetId, PAID_SHEET, paidRowNumber, 'X', found.stripePaymentIntentSheetValue || found.stripePaymentIntentId, 'USER_ENTERED')
    }
  }

  const campTab = await resolveSheetTitle(sheetId, campTabForRegistration(found))
  let campSheet = 'not-configured'
  if (campTab) {
    const campRows = await readSheetRange(sheetId, campTab, 'A:Z')
    let layout = findOperationalCampLayout(campRows)
    if (layout) layout = await ensureOperationalMarketingColumns(sheetId, campTab, layout)
    let alreadyInOperationalTab = false
    let operationalRowNumber = 0

    if (layout) {
      for (let index = layout.rowIndex + 1; index < campRows.length; index += 1) {
        const row = campRows[index] || []
        const email = String(row[layout.emailCol] || '').toLowerCase()
        const phone = layout.numberCol >= 0 ? String(row[layout.numberCol] || '') : ''
        const emailMatches = email && email === String(found.email || '').toLowerCase()
        const phoneMatches = !phone || !found.mobile || phone === String(found.mobile || '')
        if (emailMatches && phoneMatches) {
          alreadyInOperationalTab = true
          operationalRowNumber = index + 1
          break
        }
      }
    }

    if (alreadyInOperationalTab && layout) {
      const normalisedHeaders = layout.headers.map((header) => clean(header || '', 80).toLowerCase().replace(/[^a-z0-9]/g, ''))
      const amountCol = normalisedHeaders.findIndex((value) => ['amount', 'paid', 'aud', 'amountaud', 'netaud', 'netamountaud', 'netamountaudafterfees', 'audafterfees'].includes(value))
      const doneCol = normalisedHeaders.findIndex((value) => ['donebefore', 'previouscamp', 'beenbefore', 'donecampbefore'].includes(value))
      const heardCol = normalisedHeaders.findIndex((value) => ['heardaboutcamp', 'heardabout', 'whereheard', 'wheredidyouhearaboutcamp', 'wheredidyouhearaboutthecamp', 'source'].includes(value))
      if (amountCol >= 0 && found.paidAmount) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(amountCol), found.paidAmount)
      if (doneCol >= 0 && found.previousCamp) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(doneCol), found.previousCamp)
      if (heardCol >= 0 && found.heardAboutCamp) await updateCell(sheetId, campTab, operationalRowNumber, columnLetter(heardCol), found.heardAboutCamp)
    }
    if (!alreadyInOperationalTab) await appendOperationalCampRow(sheetId, campTab, found)
    campSheet = alreadyInOperationalTab ? 'already-present' : campTab
  }

  const email = await sendRegistrationEmail({ sheetId, registration: found, type: 'paid-confirmation' })
  let pendingCleanup = { skipped: true }
  try {
    pendingCleanup = await deletePendingRegistrationRow(sheetId, registrationId, rowNumber)
  } catch (cleanupError) {
    console.warn('Could not remove paid registration from pending sheet:', cleanupError?.message || cleanupError)
    pendingCleanup = { skipped: false, failed: true }
  }
  return {
    registrationId,
    status: 'paid-confirmed',
    paidSheet: alreadyInPaidSheet ? 'already-present' : 'appended',
    campSheet,
    pendingCleanup,
    email,
  }
}

export default async function handler(req, res) {
  if (req.query?.legacy === 'wc_stripe') {
    return res.status(200).json({
      received: true,
      endpoint: 'legacy-wc-stripe',
      status: 'ignored_retired_woocommerce_endpoint',
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)
    const event = JSON.parse(rawBody)

    let signatureVerified = false
    try {
      await verifyCampPaymentWebhook(rawBody, req.headers['stripe-signature'])
      signatureVerified = true
    } catch (signatureError) {
      console.warn('Camp payment webhook signature failed; falling back to Stripe server-side lookup:', signatureError?.message)
    }

    const handledTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded'])
    let result = { ignored: true, type: event.type }

    if (event.type === 'payment_intent.succeeded') {
      const eventPaymentIntent = event.data.object
      const paymentIntent = await retrieveStripePaymentIntent(eventPaymentIntent?.id)
      const registrationId = registrationIdFromPaymentIntent(paymentIntent)
      if (!registrationId) {
        result = { ignored: true, reason: 'missing-registrationId-metadata', type: event.type }
      } else {
        result = await confirmPaidRegistration(registrationId, {
          paidAmount: internalAudAmountFromSession(paymentIntent),
          stripePaymentIntentId: paymentIntent.id,
          stripePaymentIntentSheetValue: stripePaymentIntentSheetValue(paymentIntent.id, paymentIntent._stripeDashboardAccountId),
        })
        if (!signatureVerified) result.signatureVerification = 'stripe-payment-intent-lookup'
      }
    } else if (handledTypes.has(event.type)) {
      const eventSession = event.data.object
      const session = await retrieveStripeCheckoutSession(eventSession?.id)
      const paymentStatus = String(session.payment_status || '').toLowerCase()
      if (paymentStatus && paymentStatus !== 'paid') {
        result = { ignored: true, reason: 'not-paid', paymentStatus }
      } else {
        const registrationId = registrationIdFromSession(session)
        if (!registrationId) throw new Error('Stripe session missing registrationId metadata.')
        const stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        result = await confirmPaidRegistration(registrationId, {
          paidAmount: internalAudAmountFromSession(session),
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId,
          stripePaymentIntentSheetValue: stripePaymentIntentSheetValue(stripePaymentIntentId, session._stripeDashboardAccountId),
        })
        if (!signatureVerified) result.signatureVerification = 'stripe-session-lookup'
      }
    }

    return res.status(200).json({ received: true, result })
  } catch (error) {
    console.error('Camp payment webhook failed:', error)
    return res.status(400).json({ success: false, error: error.message || 'Webhook failed.' })
  }
}
