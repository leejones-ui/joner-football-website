// Payment truth is independent of acquisition and transport receipt.
const id = (v) => v == null ? '' : String(v).trim()
const minorUnits = { USD: 2, GBP: 2, AUD: 2, EUR: 2, CAD: 2, NZD: 2, JPY: 0, KRW: 0, BHD: 3, KWD: 3 }
export function moneyPair(amount, currency) {
  const code = id(currency).toUpperCase()
  if (amount === null || amount === undefined || amount === '' || !Number.isSafeInteger(Number(amount)) || !(code in minorUnits)) return null
  return { amount: Number(amount) / 10 ** minorUnits[code], currency: code }
}
export function verifyInvoice(invoice, expected) {
  if (!expected.invoiceId || !expected.userId || !expected.offerId) return { verified: false, reason: 'invoice-user-offer-required' }
  if (id(invoice?.id) !== id(expected.invoiceId) || id(invoice?.user_id) !== id(expected.userId) || id(invoice?.product_id) !== id(expected.offerId)) return { verified: false, reason: 'invoice-identity-mismatch' }
  const money = moneyPair(invoice.amount, invoice.currency)
  if (invoice.status !== 'paid' || !money || money.amount < 0) return { verified: false, reason: 'invoice-not-paid-or-money-invalid' }
  const paidAt = Number(invoice.paid_at)
  if (money.amount > 0 && (!Number.isFinite(paidAt) || paidAt <= 0)) return { verified: false, reason: 'paid-time-missing' }
  return { verified: true, source: 'uscreen-publisher-invoice', verifiedAt: new Date().toISOString(), invoiceId: id(invoice.id), userId: id(invoice.user_id), offerId: id(invoice.product_id), ...money,
    localised: moneyPair(invoice.localized_amount, invoice.localized_currency), trial: invoice.trial === true && invoice.product_type === 'recurring' && money.amount === 0,
    productType: invoice.product_type, provider: invoice.origin, paidAt: money.amount > 0 ? new Date(paidAt * 1000).toISOString() : null,
    channel: ['apple','android','amazon','roku'].includes(invoice.origin) ? 'native_app' : ['stripe','paypal','native_paypal','authorizenet','braintree'].includes(invoice.origin) ? 'web' : 'unknown' }
}
export async function readInvoiceTruth(expected, fetchImpl = fetch) {
  if (!/^\d+$/.test(id(expected.invoiceId)) || !process.env.USCREEN_API_KEY) return { verified: false, reason: 'invoice-route-unavailable' }
  try {
    const response = await fetchImpl(`https://www.uscreen.io/publisher_api/v1/invoices/${encodeURIComponent(expected.invoiceId)}`, { headers: { Authorization: process.env.USCREEN_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { verified: false, reason: 'invoice-read-failed' }
    return verifyInvoice(await response.json(), expected)
  } catch { return { verified: false, reason: 'invoice-read-failed' } }
}
export function receiptAccepted(record) {
  let body = record?.metaResponse?.body
  try { if (typeof body === 'string') body = JSON.parse(body) } catch { return false }
  return record?.metaTestEvent !== true && record?.metaResponse?.status === 200 && body?.events_received === 1
}
export function verificationChecks(sale, canonical) {
  const truth = sale.payment_verification
  const payment = truth?.verified === true && truth.amount > 0 && truth.userId === id(sale.uscreen_user_id) && truth.offerId === id(sale.offer_id)
  const joined = payment && id(canonical?.uscreenUserId) === truth.userId && (id(canonical.uscreenOrderId) === truth.invoiceId || id(canonical.reconciliation?.paymentId) === truth.invoiceId)
  const history = joined && canonical.reconciliation?.historyComplete === true && canonical.reconciliation?.paymentId === truth.invoiceId
  const touch = sale.last_touch || {}
  const ad = id(touch.ad_id || sale.ad_id || sale.ad)
  const original = id(touch.first_ad_id)
  const medium = id(touch.utm_medium || sale.medium).toLowerCase()
  const adIdentified = [ad, original].some(value => /^\d{15,20}$/.test(value)) && ['paid_social','cpc','paid'].includes(medium)
  const accepted = joined && receiptAccepted(canonical)
  return { ad_identified: adIdentified, payment_verified: payment, first_payment_verified: Boolean(history), event_accepted: Boolean(accepted), event_money_correct: Boolean(accepted && canonical.metaEvent?.custom_data?.currency === truth.currency && canonical.metaEvent?.custom_data?.value === truth.amount) }
}

export function saleCategory(sale) {
  const truth = sale.payment_verification
  const positive = truth?.verified === true && truth.amount > 0
  if (sale.kind === 'refund') return 'refund'
  if (truth?.verified !== true || truth.userId !== id(sale.uscreen_user_id) || truth.offerId !== id(sale.offer_id)) return 'unverified'
  if (truth.trial === true) return 'trial'
  if (truth.amount === 0) return truth.productType === 'freebie' ? 'freebie' : 'zero_value'
  if (positive && sale.proof_checks?.first_payment_verified) return 'first_payment'
  if (positive && sale.kind === 'renewal') return 'renewal'
  return 'paid_first_status_unverified'
}
export function acquisitionCategory(sale) {
  const checks = sale.proof_checks || verificationChecks(sale)
  if (checks.ad_identified) return 'paid_meta'
  const touch = sale.last_touch || {}
  const source = id(touch.utm_source || sale.source).toLowerCase()
  const medium = id(touch.utm_medium || sale.medium).toLowerCase()
  if (['fb','facebook','ig','instagram'].includes(source) && ['social','organic','organic_social'].includes(medium)) return 'organic_social'
  // An unlabeled Facebook source is unknown paid-vs-organic, not an ad.
  if (['meta','facebook','instagram','paid_social'].includes(id(sale.acquisition).toLowerCase())) return 'unknown'
  return ['email','organic','referral','direct'].includes(sale.acquisition) ? sale.acquisition : 'unknown'
}
export function aggregateVerifiedSales(sales, complete) {
  const out = { records: sales.length, paid_invoices: 0, first_payments: 0, renewals: 0, trials: 0, freebies: 0, unverified: 0, revenue_by_currency: {}, roas: null, roas_reason: 'Spend, acquisition and reporting windows must be reconciled in the same currency.' }
  const seen = new Set()
  for (const sale of sales) {
    const verified = sale.payment_verification
    if (verified?.verified) {
      const identity = `${verified.userId}:${verified.invoiceId}`
      if (seen.has(identity)) continue
      seen.add(identity)
    }
    const category = saleCategory(sale)
    if (category === 'trial') out.trials++
    if (category === 'freebie') out.freebies++
    if (category === 'unverified') out.unverified++
    if (['first_payment','renewal','paid_first_status_unverified'].includes(category)) {
      out.paid_invoices++
      if (category === 'first_payment') out.first_payments++
      if (category === 'renewal') out.renewals++
      const { amount, currency } = sale.payment_verification
      out.revenue_by_currency[currency] = Math.round(((out.revenue_by_currency[currency] || 0) + amount) * 1000) / 1000
    }
  }
  return complete ? { ...out, complete: true } : { complete: false, records: sales.length, paid_invoices: null, revenue_by_currency: null, reason: 'Ledger scan incomplete; totals withheld.' }
}
