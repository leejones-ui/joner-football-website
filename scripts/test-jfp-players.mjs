// The Players tab: list, search fields, filters, the full record, and adding a
// player with no group. Run against the local harness (fake Airtable, no sends):
//   npm run build && node scripts/holiday-local.mjs   (in one terminal)
//   node scripts/test-jfp-players.mjs                 (in another)
const B='http://localhost:4321', O={origin:B,'content-type':'application/json'}
const jar=new Map(); const ck=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ')
async function call(p,body){const r=await fetch(B+p,{method:'POST',headers:{...O,cookie:ck()},body:JSON.stringify(body)})
  for(const c of (r.headers.getSetCookie?.()||[])){const[k,v]=c.split(';')[0].split('=');jar.set(k,v)}
  return {status:r.status,data:await r.json().catch(()=>({}))}}
let pass=0,fail=0
const ok=(n,c,x='')=>{if(c){pass++;console.log('ok -',n)}else{fail++;console.log('FAIL -',n,x)}}
// sign in as Lee, reading the code out of the harness mailbox like the other suites
const emails=async()=>(await fetch(B+'/__emails')).json()
const st=await call('/api/jfp-auth',{action:'start',audience:'staff',email:'leejones@jonerfootball.com'})
const mail=(await emails()).filter(e=>e.to.includes('leejones@jonerfootball.com')&&/sign-in code/.test(e.subject))
const code=mail.at(-1)?.subject.match(/(\d{6})/)?.[1]
const vf=await call('/api/jfp-auth',{action:'verify',challenge:st.data.challenge,code})
ok('signed in as admin', vf.status===200, JSON.stringify(vf.data).slice(0,120))
// players list
const pl=await call('/api/jfp-portal-data',{action:'playersList'})
ok('playersList returns players', pl.status===200 && Array.isArray(pl.data.players), JSON.stringify(pl.data).slice(0,160))
const n0=pl.data.players?.length||0
ok('players have the fields the tab needs', pl.data.players?.[0] && ['rowId','name','groupLabel','paymentStatus','waiver','inGroup','email'].every(k=>k in pl.data.players[0]))
ok('filter lists come back', Array.isArray(pl.data.groups)&&Array.isArray(pl.data.coaches))
// add a player with no group
const add=await call('/api/jfp-portal-data',{action:'addPlayerNoGroup',name:'ZZ Test Player',parent:'Test Parent',email:'test@example.com',note:'automated test'})
ok('addPlayerNoGroup writes a row', add.status===200 && add.data.rowId, JSON.stringify(add.data).slice(0,160))
const pl2=await call('/api/jfp-portal-data',{action:'playersList'})
const added=(pl2.data.players||[]).find(p=>p.name==='ZZ Test Player')
ok('the new player appears in the list', Boolean(added))
ok('the new player is NOT in a group', added && added.inGroup===false, JSON.stringify(added||{}).slice(0,160))
ok('list grew by exactly one', (pl2.data.players?.length||0)===n0+1)
// validation
const bad=await call('/api/jfp-portal-data',{action:'addPlayerNoGroup',name:'ab'})
ok('a short name is refused', bad.status===400)
const bade=await call('/api/jfp-portal-data',{action:'addPlayerNoGroup',name:'Valid Name',email:'not-an-email'})
ok('a bad email is refused', bade.status===400)
console.log(fail?`\n${fail} FAILED, ${pass} passed`:`\n${pass} Players tab checks passed`)
process.exit(fail?1:0)
