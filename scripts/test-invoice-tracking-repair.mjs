import assert from 'node:assert/strict'
import { verifyInvoice, moneyPair, verificationChecks, aggregateVerifiedSales, acquisitionCategory, saleCategory } from '../api/_invoice-truth.js'
import { readReliableRange } from '../api/_reliability-ledger.js'
const invoice = { id: 101, user_id: 2, product_id: 3, product_type: 'recurring', status: 'paid', trial: false, amount: 22731, currency: 'USD', localized_amount: 16780, localized_currency: 'GBP', original_price: 25258, discount: 2527, paid_at: 1788884915, origin: 'stripe' }
const expected = { invoiceId: '101', userId: '2', offerId: '3' }
const truth = verifyInvoice(invoice, expected)
assert.equal(truth.amount, 227.31); assert.equal(truth.currency, 'USD'); assert.equal(truth.localised.amount, 167.8)
for (const field of ['invoiceId','userId','offerId']) assert.equal(verifyInvoice(invoice,{...expected,[field]:'999'}).verified,false)
assert.equal(verifyInvoice({...invoice,status:'refunded'},expected).verified,false)
assert.equal(verifyInvoice({...invoice,amount:null},expected).verified,false)
assert.deepEqual(moneyPair(100,'JPY'),{amount:100,currency:'JPY'})
assert.deepEqual(moneyPair(1000,'KWD'),{amount:1,currency:'KWD'})
assert.equal(moneyPair(100,'XXX'),null)
assert.equal(verifyInvoice({...invoice,amount:0,trial:false,product_type:'freebie'},expected).trial,false)
assert.equal(verifyInvoice({...invoice,amount:0,trial:true},expected).trial,true)
assert.equal(verifyInvoice({...invoice,origin:'native_paypal'},expected).channel,'web')
assert.equal(verifyInvoice({...invoice,origin:'apple'},expected).channel,'native_app')
const sale = { sale_id:'p1', uscreen_user_id:'2', offer_id:'3', payment_verification:truth, kind:'payment', last_touch:{first_ad_id:'120249785829550035',utm_medium:'paid_social'} }
const canonical = { uscreenUserId:'2', uscreenOrderId:'101', reconciliation:{paymentId:'101',historyComplete:true}, metaResponse:{status:200,body:JSON.stringify({events_received:1})}, metaEvent:{custom_data:{value:252.58,currency:'GBP'}} }
let checks=verificationChecks(sale,canonical)
assert.equal(checks.ad_identified,true);assert.equal(checks.payment_verified,true);assert.equal(checks.event_accepted,true);assert.equal(checks.event_money_correct,false)
assert.equal(sale.last_touch.ad_id,undefined,'Do not invent current ad identity')
assert.equal(verificationChecks(sale,{...canonical,uscreenOrderId:'999',reconciliation:{paymentId:'999'}}).event_accepted,false)
assert.equal(verificationChecks(sale,{...canonical,metaEvent:{custom_data:{value:227.31,currency:'USD'}}}).event_money_correct,true)
assert.equal(acquisitionCategory({source:'facebook',medium:'social',acquisition:'meta'}),'organic_social')
assert.equal(acquisitionCategory({source:'facebook',acquisition:'meta'}),'unknown')
assert.equal(saleCategory({...sale,kind:'renewal'}),'renewal')
const totals=aggregateVerifiedSales([sale,{...sale,payment_verification:{...truth,invoiceId:'102',amount:13.9,currency:'GBP'}}],true)
assert.deepEqual(totals.revenue_by_currency,{USD:227.31,GBP:13.9});assert.equal(totals.roas,null)
assert.equal(aggregateVerifiedSales([sale],false).revenue_by_currency,null)
process.env.KV_REST_API_URL='https://kv.invalid'; process.env.KV_REST_API_TOKEN='test-only'
const commands=[]
const fetchMock=async(_url,options)=>{
 const cmd=JSON.parse(options.body);commands.push(cmd)
 let result
 if(cmd[0]==='SCAN') result=cmd[3].includes(':archive:')?['0',['archive']]:['0',['live']]
 else if(cmd[0]==='MGET') result=cmd.slice(1).map(key=>JSON.stringify({...sale,sale_id:key,occurred_at:'2026-09-10T00:00:00Z'}))
 else throw Error('Unexpected write')
 return {ok:true,json:async()=>({result})}
}
const range=await readReliableRange({from:'2026-09-01',to:'2026-09-12'},fetchMock)
assert.equal(range.sales.length,2);assert.equal(range.coverage.complete,true)
assert.ok(commands.every(cmd=>['SCAN','MGET'].includes(cmd[0])))
const partial=await readReliableRange({from:'2026-09-01',to:'2026-09-12',maxPages:1},fetchMock)
assert.equal(partial.coverage.complete,false)
console.log('PASS: invoice amount/discount/currency; safe joins; trial/freebie; native/web; five proof checks; currency totals; archived range; no GET-side mutations')

const {invoiceIdentityForSale} = await import('../api/_invoice-ledger-reconciliation.js')
assert.equal(invoiceIdentityForSale({uscreen_user_id:'2',offer_id:'3',payment_id:'ch_exact'},{uscreenUserId:'2',offerId:3,webhookTransactionId:'ch_exact',uscreenOrderId:'101'}),'101')
assert.equal(invoiceIdentityForSale({uscreen_user_id:'2',offer_id:'3',payment_id:'ch_other'},{uscreenUserId:'2',offerId:3,webhookTransactionId:'ch_exact',uscreenOrderId:'101'}),'')
assert.equal(invoiceIdentityForSale({uscreen_user_id:'wrong',offer_id:'3',payment_id:'ch_exact'},{uscreenUserId:'2',offerId:3,webhookTransactionId:'ch_exact',uscreenOrderId:'101'}),'')
console.log('PASS: historical invoice alias requires exact transaction, user and offer; no date/value matching')
