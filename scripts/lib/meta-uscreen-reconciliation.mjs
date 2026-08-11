function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function money(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : NaN
}

export function reconcileAttributedConversions({ metaReport, uscreenRecords }) {
  const conversions = Array.isArray(metaReport?.conversions) ? metaReport.conversions : []
  const records = Array.isArray(uscreenRecords?.records) ? uscreenRecords.records : []
  const byEventId = new Map(records.map((record) => [text(record?.eventId || record?.metaEvent?.event_id), record]))
  const failures = []
  const reconciled = []

  for (const conversion of conversions) {
    const eventId = text(conversion?.event_id)
    const campaignId = text(conversion?.campaign_id)
    const adsetId = text(conversion?.adset_id)
    const adId = text(conversion?.ad_id)
    if (!eventId || !campaignId || !adsetId || !adId) {
      failures.push({ eventId: eventId || 'missing', reason: 'meta-attribution-identity-incomplete' })
      continue
    }
    const record = byEventId.get(eventId)
    if (!record || record.status !== 'sent' || !record.reconciliation?.historyComplete || !record.reconciliation?.invoiceId) {
      failures.push({ eventId, reason: 'no-authoritative-uscreen-reconciliation' })
      continue
    }
    const metaValue = money(conversion.value)
    const uscreenValue = money(record.reconciliation.value)
    const metaCurrency = text(conversion.currency).toUpperCase()
    const uscreenCurrency = text(record.reconciliation.currency).toUpperCase()
    if (!Number.isFinite(metaValue) || Math.abs(metaValue - uscreenValue) > 0.000001 || metaCurrency !== uscreenCurrency) {
      failures.push({ eventId, reason: 'value-or-currency-mismatch' })
      continue
    }
    reconciled.push({
      eventId,
      invoiceId: record.reconciliation.invoiceId,
      value: uscreenValue,
      currency: uscreenCurrency,
      campaignId,
      adsetId,
      adId,
      valueInSpendCurrency: money(conversion.value_in_spend_currency),
    })
  }

  if (failures.length) return { ok: false, failures, reconciledCount: reconciled.length, conversionCount: conversions.length }

  const spend = money(metaReport?.spend)
  const spendCurrency = text(metaReport?.spend_currency).toUpperCase()
  const sourceRevenue = Object.fromEntries(
    [...new Set(reconciled.map((item) => item.currency))].map((currency) => [
      currency,
      Number(reconciled.filter((item) => item.currency === currency).reduce((sum, item) => sum + item.value, 0).toFixed(2)),
    ]),
  )
  const allConverted = reconciled.every((item) => Number.isFinite(item.valueInSpendCurrency))
  const convertedRevenue = allConverted
    ? reconciled.reduce((sum, item) => sum + item.valueInSpendCurrency, 0)
    : NaN

  return {
    ok: true,
    conversionCount: reconciled.length,
    sourceRevenue,
    spend: Number.isFinite(spend) ? spend : undefined,
    spendCurrency: spendCurrency || undefined,
    cpa: Number.isFinite(spend) && reconciled.length ? Number((spend / reconciled.length).toFixed(2)) : undefined,
    roas: Number.isFinite(spend) && spend > 0 && Number.isFinite(convertedRevenue)
      ? Number((convertedRevenue / spend).toFixed(4))
      : undefined,
    roasBlockedReason: Number.isFinite(convertedRevenue) ? undefined : 'missing-meta-value-in-spend-currency',
  }
}
