import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {reconcileInvoiceLedger} from '../api/_invoice-ledger-reconciliation.js'
process.env.KV_REST_API_URL='https://kv.invalid';process.env.KV_REST_API_TOKEN='test';process.env.USCREEN_API_KEY='test'
const saleKey='jfa:reliability:sale:payment:ch_exact'
const canonicalKey=`jf:meta:first-paid:${crypto.createHash('sha256').update('uscreen:2').digest('hex')}`
const sale={sale_id:'payment:ch_exact',payment_id:'ch_exact',provider_payment_id:'ch_exact',uscreen_user_id:'2',offer_id:'3',kind:'payment',amount:252.58,currency:'GBP',occurred_at:'2026-09-08T16:28:35Z',acquisition:'unknown'}
const canonical={status:'sent',uscreenUserId:'2',offerId:3,webhookTransactionId:'ch_exact',uscreenOrderId:'101',metaEvent:{custom_data:{value:252.58,currency:'GBP'}},metaResponse:{status:200,body:'{"events_received":1}'}}
const store=new Map([[saleKey,JSON.stringify(sale)],[canonicalKey,JSON.stringify(canonical)]])
let invoices=0
const fetchMock=async(url,options)=>{
 if(String(url).includes('/invoices/101')) { invoices++;return {ok:true,json:async()=>({id:101,user_id:2,product_id:3,amount:22731,currency:'USD',status:'paid',trial:false,product_type:'recurring',paid_at:1788884915,origin:'stripe'})} }
 assert.equal(url,'https://kv.invalid','Only invoice reads and ledger commands are permitted; never Meta')
 const [cmd,...args]=JSON.parse(options.body)
 let result=null
 if(cmd==='SCAN')result=['0',args[2].includes(':sale:')?[saleKey]:[]]
 else if(cmd==='GET')result=store.get(args[0])??null
 else if(cmd==='MGET')result=args.map(key=>key.startsWith('jfa:reliability:payment:')?'1':store.get(key)??null)
 else if(cmd==='SET'){
  assert.notEqual(args[0],canonicalKey,'Accepted event must be immutable')
  if(args.includes('NX') && store.has(args[0]))result=null
  else {store.set(args[0],args[1]);result='OK'}
 }else if(cmd==='ZADD')result=1
 else throw Error(`Unexpected command ${cmd}`)
 return {ok:true,json:async()=>({result})}
}
const now=Date.parse('2026-09-12T12:00:00Z')
const result=await reconcileInvoiceLedger({now},fetchMock)
assert.equal(result.verified,1)
const corrected=JSON.parse(store.get(saleKey))
assert.equal(corrected.amount,227.31);assert.equal(corrected.currency,'USD');assert.equal(corrected.acquisition,'unknown')
assert.equal(corrected.prior_reported_money.amount,252.58);assert.equal(corrected.payment_verification.verified,true)
assert.equal(store.get(canonicalKey),JSON.stringify(canonical))
const second=await reconcileInvoiceLedger({now},fetchMock)
assert.equal(second.checked,0);assert.equal(invoices,1)
console.log('PASS: historical money corrected from safe invoice alias; original money retained; acquisition and accepted Meta event unchanged; repeat pass idempotent')
