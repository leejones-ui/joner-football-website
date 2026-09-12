import assert from 'node:assert/strict'
import handler from '../api/attribution-report.js'
process.env.ATTRIBUTION_REPORT_TOKEN='test-report-token'
process.env.KV_REST_API_URL='https://kv.invalid'
process.env.KV_REST_API_TOKEN='test-only'
delete process.env.USCREEN_API_KEY
const calls=[]
const rows=Array.from({length:80},(_,i)=>({sale_id:`payment:${i}`,payment_id:`payment:${i}`,occurred_at:'2026-09-10T00:00:00Z',offer_id:'3',uscreen_user_id:String(i),amount:999,currency:'GBP',payment_status:'paid',kind:'payment',payment_verification:{verified:true,userId:String(i),offerId:'3',invoiceId:String(i),amount:10,currency:'USD'}}))
globalThis.fetch=async(_url,options)=>{
 const cmd=JSON.parse(options.body);calls.push(cmd)
 let result=null
 if(cmd[0]==='SCAN') result=['0',cmd[3].includes(':archive:')?rows.slice(40).map(r=>r.sale_id):rows.slice(0,40).map(r=>r.sale_id)]
 if(cmd[0]==='MGET') result=cmd.slice(1).map(key=>key.startsWith('jf:meta:')?null:JSON.stringify(rows.find(r=>r.sale_id===key)))
 if(cmd[0]==='LRANGE'||cmd[0]==='HGETALL') result=[]
 if(!['SCAN','MGET','GET','LRANGE','HGETALL'].includes(cmd[0])) throw Error(`Unexpected mutation ${cmd[0]}`)
 return {ok:true,json:async()=>({result})}
}
let code,body
await handler({method:'GET',headers:{authorization:'Bearer test-report-token'},query:{from:'2026-09-01',to:'2026-09-12',limit:10}},{status(c){code=c;return this},json(b){body=b;return b}})
assert.equal(code,200);assert.equal(body.sales.length,10);assert.equal(body.range_totals.paid_invoices,80);assert.deepEqual(body.range_totals.revenue_by_currency,{USD:800});assert.equal(body.summary.totals.payments,null)
assert.equal(body.sales[0].amount,10);assert.equal(body.coverage.archives_included,true)
console.log('PASS: archive-inclusive totals independent of 10 displayed rows; verified money only; no report writes')
