import crypto from 'node:crypto'
import { readReliableRange, reliabilityKv, appendReliableSale } from './_reliability-ledger.js'
import { readInvoiceTruth } from './_invoice-truth.js'
const text = value => value == null ? '' : String(value)
export function invoiceIdentityForSale(sale, canonical) {
  if (/^\d+$/.test(text(sale.invoice_id || sale.order_id))) return text(sale.invoice_id || sale.order_id)
  // An existing canonical snapshot may provide the invoice alias, but only
  // alongside the exact same transaction, user and offer. Never date/value-match.
  if (text(canonical?.uscreenUserId) !== text(sale.uscreen_user_id) || text(canonical?.offerId) !== text(sale.offer_id)) return ''
  const transaction = text(canonical?.webhookTransactionId)
  if (!transaction || ![sale.payment_id, sale.provider_payment_id].map(text).includes(transaction)) return ''
  return /^\d+$/.test(text(canonical.uscreenOrderId)) ? text(canonical.uscreenOrderId) : ''
}
export async function reconcileInvoiceLedger({limit = 10, now = Date.now(), from = '1970-01-01T00:00:00Z'} = {}, fetchImpl = fetch) {
  const inventory = await readReliableRange({from, to:new Date(now).toISOString()}, fetchImpl)
  const candidates = inventory.sales.filter(sale => sale.kind !== 'refund' && sale.payment_verification?.verified !== true
    && (!sale.invoice_checked_at || now - Date.parse(sale.invoice_checked_at) >= 86400000))
    .sort((a,b) => (Date.parse(a.invoice_checked_at) || 0) - (Date.parse(b.invoice_checked_at) || 0) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at)).slice(0, Math.min(limit,25))
  const summary = {checked:0,verified:0,held:0,scan_complete:inventory.coverage.complete}
  for (const sale of candidates) {
    let canonical
    if (sale.uscreen_user_id) {
      const key=`jf:meta:first-paid:${crypto.createHash('sha256').update(`uscreen:${sale.uscreen_user_id}`).digest('hex')}`
      const raw=(await reliabilityKv(['GET',key],fetchImpl))?.result
      try {canonical=typeof raw === 'string'?JSON.parse(raw):raw} catch {canonical=null}
    }
    const invoiceId=invoiceIdentityForSale(sale,canonical)
    const truth=invoiceId ? await readInvoiceTruth({invoiceId,userId:sale.uscreen_user_id,offerId:sale.offer_id},fetchImpl) : {verified:false,reason:'safe-invoice-reference-required'}
    summary.checked++
    const patch={...sale,invoice_checked_at:new Date(now).toISOString(),payment_verification:truth}
    if (truth.verified) {
      Object.assign(patch,{invoice_id:truth.invoiceId,amount:truth.amount,currency:truth.currency,payment_channel:truth.channel,trial:truth.trial,product_type:truth.productType,
        occurred_at:truth.paidAt || sale.occurred_at,
        prior_reported_money:sale.prior_reported_money || {amount:sale.amount ?? null,currency:sale.currency ?? null}})
      summary.verified++
    } else summary.held++
    await appendReliableSale(patch,fetchImpl)
  }
  return summary
}
