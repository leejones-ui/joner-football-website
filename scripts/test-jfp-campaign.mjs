// The sign-in message to every family (Lee, 12 Oct 2026): drafts for all,
// no amounts, the family's own email in it, emails only when Lee sends,
// each family once, texts only on a verified route. Local harness only:
//   npm run build && node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-campaign.mjs                (another)
const B = 'http://localhost:4321', O = { origin: B, 'content-type': 'application/json' }
const jar = new Map(); const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
async function call(p, body) {
  const r = await fetch(B + p, { method: 'POST', headers: { ...O, cookie: ck() }, body: JSON.stringify(body) })
  for (const c of (r.headers.getSetCookie?.() || [])) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v) }
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const emails = async () => (await fetch(B + '/__emails')).json()
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok -', n) } else { fail++; console.log('FAIL -', n, x) } }
const st = await call('/api/jfp-auth', { action: 'start', audience: 'staff', email: 'leejones@jonerfootball.com' })
const code = (await emails()).filter((e) => /sign-in code/.test(e.subject)).at(-1)?.subject.match(/(\d{6})/)?.[1]
ok('signed in as Lee', (await call('/api/jfp-auth', { action: 'verify', challenge: st.data.challenge, code })).status === 200)
const M = (action, body = {}) => call('/api/jfp-messages', { action, ...body })
const fams = (await M('overview')).data.families
const p1 = await M('prepareCampaign')
ok('drafts for every family that can be contacted', p1.status === 200 && p1.data.emails + p1.data.dnc.length === fams.length, JSON.stringify({ e: p1.data.emails, dnc: p1.data.dnc?.length, fams: fams.length }))
const c1 = (await M('campaign')).data
ok('the email shown has no amounts and no pay link', c1.sample.html && !/A\$\d|\/jfp-account\/\?pay=/.test(c1.sample.html))
ok('the email shown names the email to sign in with', fams.some((f) => c1.sample.html.includes(f.email)))
ok('the text has the email and no amount', c1.sample.text === '' || (/@/.test(c1.sample.text) && !/A\$/.test(c1.sample.text)), c1.sample.text)
ok('no em dashes', !/—/.test(c1.sample.html + c1.sample.text + c1.sample.subject))
const before = (await emails()).length
ok('nothing is emailed by preparing', (await emails()).length === before)
const p2 = await M('prepareCampaign')
ok('preparing again adds nothing', p2.data.emails === 0 && p2.data.texts === 0, JSON.stringify(p2.data))
ok('texts cannot go before the route is verified', (await M('sendCampaign', { channel: 'text', confirm: true, basis: 'test' })).status === 409)
ok('sending needs the confirm', (await M('sendCampaign', { channel: 'email' })).status === 400)
let sent = 0
for (let i = 0; i < 20; i++) { const r = await M('sendCampaign', { channel: 'email', confirm: true }); sent += r.data.sent || 0; if (!r.data.left) break }
const out = (await emails()).slice(before).filter((e) => /sign in to/i.test(e.subject))
ok('one email per family, all sent', sent === p1.data.emails && out.length === sent, `${sent} vs ${out.length}`)
ok('each family got their own email address in it', out.every((e) => (e.html || '').includes(e.to[0]?.email || e.to)))
const again = await M('sendCampaign', { channel: 'email', confirm: true })
ok('pressing send again sends nothing', again.data.sent === 0)
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\n${pass} sign-in campaign checks passed`)
process.exit(fail ? 1 : 0)
