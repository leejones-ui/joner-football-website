import {kvCommand} from './_holiday-store.js';
import {createAuthStore,cookieToken} from './_jfp-auth.js';
import {canReadJfpFinance,coachHoursView} from './_jfp-access.js';
import {readAirtable,financeRows,TERM4} from './_jfp-airtable.js';
const auth=createAuthStore(kvCommand);
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(process.env.JFP_PORTAL_ENABLED!=='true')return res.status(503).json({error:'JFP portal is not open yet.'});
 try{
  const principal=await auth.principal(cookieToken(req));
  if(!principal)return res.status(401).json({error:'Please sign in.'});
  if(principal.role==='coach'){
   // Only staff-approved sessions may be written to this store. Missing is not an empty timetable.
   const raw=await kvCommand(['GET','jfp:approved-coach-sessions']);
   if(!raw)return res.status(503).json({error:'Your timetable is awaiting staff verification.'});
   const data=JSON.parse(raw);
   if(!Array.isArray(data.sessions)||!data.verifiedAt)throw Error('Invalid timetable');
   return res.status(200).json({kind:'coach',updatedAt:data.verifiedAt,sessions:coachHoursView(principal,data.sessions)});
  }
  if(!canReadJfpFinance(principal))return res.status(403).json({error:'Access denied'});
  const rows=financeRows(await readAirtable(TERM4,['fldwPPvzlaC8fLWQX','fldFualnOIeJbATEj','fldzySMYukELqetWq','fldZgiARU3XZFcKA7','fldB85HZDOrMBegAk','fldcW1qrB2Gzf7Z75','fld8ZLJNwzXufAxwK','fldwkwHTf8SCFONjs']));
  return res.status(200).json({kind:'admin',updatedAt:new Date().toISOString(),rows,totalsVerified:false,notice:'Registration records only. Programme revenue totals await transaction-level reconciliation to avoid counting shared family payments twice.'});
 }catch{return res.status(503).json({error:'Programme data is temporarily unavailable. No cached financial totals are shown.'});}
}
