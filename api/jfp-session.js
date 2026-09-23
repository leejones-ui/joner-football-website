import { kvCommand } from './_holiday-store.js';
import { createAuthStore, cookieToken, cookieHeader, sameOrigin } from './_jfp-auth.js';
const auth=createAuthStore(kvCommand);
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(process.env.JFP_PORTAL_ENABLED!=='true') return res.status(503).json({error:'JFP portal is not open yet.'});
  try {
    if(req.method==='GET') {
      const user=await auth.principal(cookieToken(req));
      return user ? res.status(200).json({user:{name:user.name,role:user.role}}) : res.status(401).json({error:'Please sign in.'});
    }
    if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    if(!sameOrigin(req,process.env.JFP_PORTAL_ORIGIN)) return res.status(403).json({error:'Invalid request origin'});
    let body; try {body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'Invalid request'});}
    if(body?.logout===true){await auth.logout(cookieToken(req));res.setHeader('Set-Cookie',cookieHeader('',0));return res.status(200).json({ok:true});}
    const token=await auth.login(body?.username,body?.password,req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown');
    if(!token) return res.status(401).json({error:'Username or password is incorrect.'});
    // Revoke the prior browser session on successful reauthentication.
    await auth.logout(cookieToken(req));
    res.setHeader('Set-Cookie',cookieHeader(token));
    return res.status(200).json({ok:true});
  }catch(error){if(error.message==='Rate limited'){res.setHeader('Retry-After','900');return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});}return res.status(503).json({error:'Sign-in temporarily unavailable.'});}
}
