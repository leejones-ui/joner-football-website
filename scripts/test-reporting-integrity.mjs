import assert from 'node:assert/strict'
import { buildReconciliation, addPhaseTwoThree, isTrialInvoice } from '../api/_meta-uscreen-reconciliation.js'
import { buildTrialCohort, isFreebie } from '../api/_trial-cohort.js'
globalThis.fetch = async () => { throw new Error('Network forbidden in reporting-integrity tests') }
const window = {from:'2026-09-03',to:'2026-09-11',timezone:'UTC'}
const now = new Date('2026-09-12T03:00:00Z')
const sourceHealth = {meta:true,uscreen:true,kv:true}
const base = {user_id:'fixture-user',product_type:'recurring',product_id:230699,status:'paid',trial:true,amount:0,currency:'USD',paid_at:1788616019}
const paid = {...base,id:'paid-fixture',trial:false,amount:22731,paid_at:1788884915}
const freebie = {...base,id:'freebie-fixture',product_type:'freebie',product_id:226775,trial:false}
assert.equal(isFreebie(freebie),true)
assert.equal(isTrialInvoice(freebie),false)
assert.equal(isTrialInvoice({...base,trial:false}),false)
assert.equal(isTrialInvoice({...base,trial:undefined}),false)
assert.equal(isTrialInvoice({...base,product_type:'freebie'}),false)
assert.equal(isTrialInvoice({...base,amount:undefined}),false)
assert.equal(isTrialInvoice({...base,amount:null}),false)
assert.equal(isTrialInvoice({...base,amount:''}),false)
assert.equal(isTrialInvoice({...base,status:'failed'}),false)
assert.equal(isTrialInvoice({...base,amount:999}),false)
assert.equal(isTrialInvoice(base),true)
assert.equal(isTrialInvoice({...base,product_type:undefined,product_id:undefined,kind:'subscription',source_id:230699}),true)
assert.equal(buildTrialCohort({window,now,invoices:[freebie,paid]}).summary.trials,0)
assert.equal(buildTrialCohort({window,now,invoices:[freebie,paid],includeFreebies:true}).summary.trials,0)
const normal = buildTrialCohort({window,now,invoices:[base,paid]})
assert.equal(normal.summary.trials,1);assert.equal(normal.summary.converted,1)
assert.equal(normal.rows[0].kind,'recurring');assert.equal(normal.rows[0].plan_id,'230699')
assert.equal(normal.rows[0].converted_amount,227.31)
assert.equal(buildTrialCohort({window,now,invoices:[base,{...paid,product_id:202578}]}).summary.converted,0)
assert.equal(buildTrialCohort({window,now,invoices:[{...base,product_id:undefined},paid]}).summary.converted,0)
assert.equal(buildTrialCohort({window,now,invoices:[base,{...paid,user_id:'other-user'}]}).summary.converted,0)
const reconcile = invoices => buildReconciliation({window,meta:{purchases:1},invoices,sales:[{uscreen_user_id:'fixture-user',acquisition:'meta'}],sourceHealth})
const commercial = (report,currency='AUD') => addPhaseTwoThree({report,meta:{spend:214.13,currency},sourceHealth}).commercial
const r = reconcile([paid])
assert.equal(commercial(r).confirmed_roas,null)
assert.equal(commercial(r).confirmed_roas_reason,'currency-mismatch')
assert.equal(commercial(r).confirmed_revenue_currency,'USD')
assert.equal(commercial(r,'USD').confirmed_roas,1.0616)
assert.equal(commercial(r,'USD').confirmed_roas_reason,null)
assert.equal(commercial(reconcile([{...paid,currency:undefined}]),'USD').confirmed_roas_reason,'currency-unverified')
assert.equal(commercial(r,'').confirmed_roas_reason,'currency-unverified')
const mixed = reconcile([paid,{...paid,id:'paid-gbp',amount:16780,currency:'GBP'}])
assert.deepEqual(mixed.confirmed_buyer_revenue_by_currency,{USD:227.31,GBP:167.8})
assert.equal(mixed.confirmed_buyer_revenue,null)
assert.equal(commercial(mixed).confirmed_roas,null)
assert.equal(commercial(mixed).confirmed_roas_reason,'multiple-revenue-currencies')
assert.equal(commercial(mixed).confirmed_revenue,null)
assert.equal(r.ledger_coverage.complete_campaign_history,false)
assert.equal(r.ledger_coverage.archives_included,false)
console.log('PASS reporting integrity: explicit trial/recurring semantics, freebie exclusion, same-user same-offer conversion, paid minor units, currency-safe ROAS, separate mixed revenues and honest limited-history metadata.')
