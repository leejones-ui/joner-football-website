const BASE='apphU4R0BtVIu5YqT';
export const TERM4='tbl6OIjkU6UsQCeZV';
export async function readAirtable(table, fields, {fetcher=fetch, token=process.env.JFP_AIRTABLE_TOKEN}={}) {
 if(!token)throw Error('JFP Airtable connection is not configured');
 const records=[];let offset='';
 do {
  const params=new URLSearchParams({pageSize:'100',returnFieldsByFieldId:'true'});
  for(const field of fields)params.append('fields[]',field);
  if(offset)params.set('offset',offset);
  const response=await fetcher(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}?${params}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
  if(!response.ok)throw Error('Airtable read failed');
  const data=await response.json();if(!Array.isArray(data.records))throw Error('Invalid Airtable response');
  records.push(...data.records);offset=data.offset||'';
  if(records.length>10000)throw Error('Airtable result exceeds limit');
 }while(offset);
 return records;
}
export function financeRows(records) {
 return records.map(({id,fields:f})=>({
  id,player:f.fldwPPvzlaC8fLWQX||'',
  feeAud:typeof f.fldFualnOIeJbATEj==='number'?f.fldFualnOIeJbATEj:null,
  grossPaidAud:typeof f.fldzySMYukELqetWq==='number'?f.fldzySMYukELqetWq:null,
  balanceAud:typeof f.fldZgiARU3XZFcKA7==='number'?f.fldZgiARU3XZFcKA7:null,
  status:f.fldB85HZDOrMBegAk||'Unspecified',
  reconciliation:f.fldcW1qrB2Gzf7Z75||'Pending verification',
  stripeFeeAud:['Verified','Non-Stripe — verified'].includes(f.fldcW1qrB2Gzf7Z75)&&typeof f.fld8ZLJNwzXufAxwK==='number'?f.fld8ZLJNwzXufAxwK:null,
  netCollectedAud:['Verified','Non-Stripe — verified'].includes(f.fldcW1qrB2Gzf7Z75)&&typeof f.fldwkwHTf8SCFONjs==='number'?f.fldwkwHTf8SCFONjs:null,
 }));
}
