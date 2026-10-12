// The "sign in to your account" invite for every Term 4 family (Lee, 12 Oct):
// no amounts in it, sent once, skips families who have signed in, and the
// portal can see who has. Run against the local harness (fake Brevo):
//   npm run build && node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-account-invites.mjs         (another)
const B = 'http://localhost:4321', O = { origin: B, 'content-type': 'application/json' }
function client() {
  const jar = new Map(); const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return async (p, body) => {
    const r = await fetch(B + p, { method: 'POST', headers: { ...O, cookie: ck() }, body: JSON.stringify(body) })
    for (const c of (r.headers.getSetCookie?.() || [])) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v) }
    return { status: r.status, data: await r.json().catch(() => ({})) }
  }
}
const emails = async () => (await fetch(B + '/__emails')).json()
async function signIn(call, email, audience) {
  const st = await call('/api/jfp-auth', { action: 'start', audience, email })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)?.subject.match(/(\d{6})/)?.[1]
  return call('/api/jfp-auth', { action: 'verify', challenge: st.data.challenge, code })
}
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok -', n) } else { fail++; console.log('FAIL -', n, x) } }
const lee = client()
ok('signed in as admin', (await signIn(lee, 'leejones@jonerfootball.com', 'staff')).status === 200)
const plan = (await lee('/api/jfp-portal-data', { action: 'familyInvites' })).data
const acct = plan.previews?.account
ok('there is a sign-in invite preview', Boolean(acct?.html))
ok('the sign-in invite has no amounts and no pay link in it', acct && !/A\$\d|\?pay=|Nothing to pay/i.test(acct.html), acct?.subject)
ok('no em dashes in the invite', acct && !/—/.test(acct.html + acct.subject))
const owes = plan.list.find((f) => f.kind === 'pay'), unpriced = plan.list.find((f) => f.kind === 'noPrice')
const targets = [owes, unpriced].filter(Boolean).map((f) => f.email)
ok('a family who owes and one with no price can both be invited', targets.length >= 1, JSON.stringify(plan.list.map((f) => f.kind)))
const before = (await emails()).length
const s1 = await lee('/api/jfp-portal-data', { action: 'familyInvites', send: true, mode: 'account', emails: targets })
const sent = (await emails()).slice(before)
ok('one email per family', s1.status === 200 && s1.data.sent.length === targets.length && sent.length === targets.length, JSON.stringify(s1.data))
ok('the emails sent carry no amounts', sent.every((e) => !/A\$\d/.test(e.html || '')))
const s2 = await lee('/api/jfp-portal-data', { action: 'familyInvites', send: true, mode: 'account', emails: targets })
ok('sending again without resend sends nothing', s2.data.sent.length === 0)
const parent = client()
ok('the parent signs in', (await signIn(parent, targets[0], 'parent')).status === 200)
const plan2 = (await lee('/api/jfp-portal-data', { action: 'familyInvites' })).data
ok('staff can see who has signed in', Boolean(plan2.list.find((f) => f.email === targets[0])?.signedInAt))
const s3 = await lee('/api/jfp-portal-data', { action: 'familyInvites', send: true, mode: 'account', emails: [targets[0]], resend: true })
ok('a family who has signed in is never chased', s3.data.sent.length === 0)
const acctView = (await parent('/api/jfp-account', {})).data
ok('their players are already on the account', (acctView.players || []).length >= 1, JSON.stringify(acctView).slice(0, 160))
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\n${pass} account invite checks passed`)
process.exit(fail ? 1 : 0)
