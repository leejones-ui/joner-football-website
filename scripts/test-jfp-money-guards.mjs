// Money guards found in the 9 Oct stress test: a payment cannot be recorded
// twice (double click / two staff), cannot exceed what is owing by mistake, and
// cannot be dated in the future. Run against the local harness (fake Airtable):
//   npm run build && node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-money-guards.mjs            (another)
const B = 'http://localhost:4321', O = { origin: B, 'content-type': 'application/json' }
const jar = new Map(); const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
async function call(p, body) {
  const r = await fetch(B + p, { method: 'POST', headers: { ...O, cookie: ck() }, body: JSON.stringify(body) })
  for (const c of (r.headers.getSetCookie?.() || [])) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v) }
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok -', n) } else { fail++; console.log('FAIL -', n, x) } }
const st = await call('/api/jfp-auth', { action: 'start', audience: 'staff', email: 'leejones@jonerfootball.com' })
const mail = (await (await fetch(B + '/__emails')).json()).filter((e) => e.to.includes('leejones@jonerfootball.com') && /sign-in code/.test(e.subject))
const vf = await call('/api/jfp-auth', { action: 'verify', challenge: st.data.challenge, code: mail.at(-1)?.subject.match(/(\d{6})/)?.[1] })
ok('signed in as admin', vf.status === 200)
const list = (await call('/api/jfp-portal-data', { action: 'playersList' })).data.players || []
const owing = list.find((p) => p.feeAud > 0 && p.feeAud - (p.paidAud || 0) > 0 && !/^paid$/i.test(p.paymentStatus || ''))
ok('found a player who owes money', Boolean(owing), JSON.stringify(list[0] || {}).slice(0, 200))
const fee = Math.round((owing.feeAud - (owing.paidAud || 0)) * 100)
const paidBefore = Math.round((owing.paidAud || 0) * 100)
const over = await call('/api/jfp-portal-data', { action: 'markPaid', rowId: owing.rowId, amountCents: fee + 100000, method: 'Cash' })
ok('more than is owing is refused', over.status === 400, JSON.stringify(over.data))
const future = await call('/api/jfp-portal-data', { action: 'recordPayment', rowId: owing.rowId, amountCents: fee, method: 'Cash', date: '2031-01-01' })
ok('a payment dated in the future is refused', future.status === 400, JSON.stringify(future.data))
const [a, b] = await Promise.all([1, 2].map(() => call('/api/jfp-portal-data', { action: 'markPaid', rowId: owing.rowId, amountCents: fee, method: 'Cash' })))
ok('two at the same moment: exactly one is recorded', [a.status, b.status].sort().join() === '200,409', `${a.status} ${b.status}`)
const after = (await call('/api/jfp-portal-data', { action: 'playersList' })).data.players.find((p) => p.rowId === owing.rowId)
ok('the row is paid once, not twice', Math.round(after.paidAud * 100) === paidBefore + fee, `${after.paidAud} vs ${(paidBefore + fee) / 100}`)
const again = await call('/api/jfp-portal-data', { action: 'markPaid', rowId: owing.rowId, amountCents: fee, method: 'Cash' })
ok('pressing it again is refused', again.status === 409 || again.status === 400, `${again.status}`)
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\n${pass} money guard checks passed`)
process.exit(fail ? 1 : 0)
