import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeRows,readAirtable} from '../api/_jfp-airtable.js';
test('unverified fees and net values remain unknown, including misleading stored values',()=>{
 const [r]=financeRows([{id:'a',fields:{fldzySMYukELqetWq:850,fld8ZLJNwzXufAxwK:0,fldwkwHTf8SCFONjs:850}}]);
 assert.equal(r.grossPaidAud,850);assert.equal(r.stripeFeeAud,null);assert.equal(r.netCollectedAud,null);
});
test('explicit verified zero fees and net are preserved',()=>{
 const [r]=financeRows([{id:'a',fields:{fldcW1qrB2Gzf7Z75:'Non-Stripe — verified',fld8ZLJNwzXufAxwK:0,fldwkwHTf8SCFONjs:850}}]);
 assert.equal(r.stripeFeeAud,0);assert.equal(r.netCollectedAud,850);
});
test('Airtable pagination reads all records with field projection',async()=>{
 let calls=0;const fetcher=async(url)=>{calls++;assert.ok(url.includes('fields%5B%5D=x'));return {ok:true,json:async()=>calls===1?{records:[{id:'a'}],offset:'next'}:{records:[{id:'b'}]}};};
 assert.equal((await readAirtable('table',['x'],{fetcher,token:'test-only'})).length,2);assert.equal(calls,2);
});
test('Airtable errors fail closed without partial financial totals',async()=>{
 await assert.rejects(()=>readAirtable('table',[],{token:''}),/not configured/);
 await assert.rejects(()=>readAirtable('table',[],{token:'test-only',fetcher:async()=>({ok:false})}),/read failed/);
});
