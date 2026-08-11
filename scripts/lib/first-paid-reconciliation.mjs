const WEB_ORIGINS = new Set(['web'])
const WEB_PROVIDERS = new Set(['stripe'])
const REFUND_STATUSES = new Set(['refunded', 'partially_refunded', 'chargeback', 'disputed'])

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function fail(reason, extra = {}) {
  return { eligible: false, reason, ...extra }
}

function paymentTime(payment) {
  const raw = payment?.paid_at || payment?.created_at
  const parsed = raw ? Date.parse(String(raw)) : NaN
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function paymentAmount(payment) {
  const amount = Number(payment?.amount)
  return Number.isFinite(amount) ? amount : NaN
}

function planOriginForPayment(user, payment) {
  const sourceId = text(payment?.source_id)
  const history = Array.isArray(user?.plan_history) ? user.plan_history : []
  const matching = history.filter((plan) => text(plan?.plan_id) === sourceId)
  if (!matching.length) return ''
  const paidAt = paymentTime(payment)
  const bounded = matching.filter((plan) => {
    const startedAt = Date.parse(plan?.started_at || '')
    const endedAt = Date.parse(plan?.ended_at || '')
    const afterStart = !Number.isFinite(startedAt) || paidAt >= startedAt - (10 * 60 * 1000)
    const beforeEnd = !Number.isFinite(endedAt) || paidAt <= endedAt + (10 * 60 * 1000)
    return afterStart && beforeEnd
  })
  if (bounded.length > 0) {
    const selected = bounded.sort((left, right) => {
      const rightStart = Date.parse(right?.started_at || '')
      const leftStart = Date.parse(left?.started_at || '')
      return (Number.isFinite(rightStart) ? rightStart : Number.NEGATIVE_INFINITY)
        - (Number.isFinite(leftStart) ? leftStart : Number.NEGATIVE_INFINITY)
    })[0]
    return text(selected?.origin).toLowerCase()
  }
  const origins = [...new Set(matching.map((plan) => text(plan?.origin).toLowerCase()).filter(Boolean))]
  return origins.length === 1 ? origins[0] : ''
}

export function reconcileAuthoritativeFirstPaid({ expectedUserId, invoiceId, evidence }) {
  const userId = text(expectedUserId)
  const targetInvoice = text(invoiceId)
  if (!userId || !targetInvoice) return fail('identity-or-invoice-missing')
  if (!evidence || evidence.history_complete !== true || (evidence.next_cursor !== null && evidence.next_cursor !== undefined)) {
    return fail('payment-history-incomplete')
  }
  if (text(evidence?.user?.id) !== userId) return fail('uscreen-user-mismatch')
  if (!Array.isArray(evidence.payments)) return fail('payment-history-missing')
  if (Array.isArray(evidence.user?.plan_history) && evidence.user.plan_history.length >= 50) {
    return fail('plan-history-may-be-truncated')
  }

  const invoiceRows = evidence.payments.filter((payment) => text(payment?.provider_invoice_id) === targetInvoice)
  if (!invoiceRows.length) return fail('invoice-not-found')
  if (invoiceRows.some((payment) => REFUND_STATUSES.has(text(payment?.status).toLowerCase()))) {
    return fail('invoice-refunded')
  }

  const selected = invoiceRows.find((payment) => (
    text(payment?.status).toLowerCase() === 'paid'
    && text(payment?.kind).toLowerCase() === 'subscription'
    && paymentAmount(payment) > 0
  ))
  if (!selected) return fail('not-positive-paid-invoice')

  const positivePaidSubscriptions = evidence.payments
    .filter((payment) => (
      text(payment?.status).toLowerCase() === 'paid'
      && text(payment?.kind).toLowerCase() === 'subscription'
      && paymentAmount(payment) > 0
    ))
    .sort((a, b) => paymentTime(a) - paymentTime(b) || text(a?.id).localeCompare(text(b?.id)))

  if (!positivePaidSubscriptions.length) return fail('not-positive-paid-invoice')
  if (text(positivePaidSubscriptions[0]?.provider_invoice_id) !== targetInvoice) {
    return fail('renewal-not-first-paid')
  }

  const channel = planOriginForPayment(evidence.user, selected)
  const provider = text(selected.provider).toLowerCase()
  if (!WEB_ORIGINS.has(channel) || !WEB_PROVIDERS.has(provider)) {
    return fail('non-web-purchase', { channel: channel || 'unknown', provider: provider || 'unknown' })
  }

  const currency = text(selected.currency).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return fail('authoritative-currency-invalid')
  const amountMinor = paymentAmount(selected)
  const value = amountMinor / 100
  if (!Number.isFinite(value) || value <= 0) return fail('not-positive-paid-invoice')

  return {
    eligible: true,
    reason: 'verified-first-paid-web',
    userId,
    invoiceId: targetInvoice,
    paymentId: text(selected.id),
    offerId: text(selected.source_id),
    channel,
    provider,
    currency,
    value,
    paidAt: text(selected.paid_at || selected.created_at),
  }
}
