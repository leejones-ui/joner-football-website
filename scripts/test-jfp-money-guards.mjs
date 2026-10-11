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
// Stripe payment link (no booking id): the webhook records it in Airtable on its own.
const list2 = (await call('/api/jfp-portal-data', { action: 'playersList' })).data.players || []
const solo = list2.find((p) => p.email && p.feeAud > (p.paidAud || 0) && !/^paid$/i.test(p.paymentStatus || '') && p.rowId !== owing.rowId && list2.filter((x) => x.email === p.email).length === 1)
ok('found a single unpaid family for the link test', Boolean(solo))
const seeded = await (await fetch(B + '/__stripe-seed', { method: 'POST', body: JSON.stringify({ email: solo.email, name: solo.parent, cents: Math.round((solo.feeAud - (solo.paidAud || 0)) * 100), fire: true }) })).json()
const after2 = (await call('/api/jfp-portal-data', { action: 'playersList', fresh: true })).data.players.find((p) => p.rowId === solo.rowId)
ok('a payment link payment is in Airtable without anyone pressing a button', /^paid$/i.test(after2.paymentStatus || '') && Math.round(after2.paidAud * 100) === Math.round(solo.feeAud * 100), JSON.stringify({ s: after2.paymentStatus, paid: after2.paidAud, id: seeded.id }))
const tg = await (await fetch(B + '/__telegram')).json()
ok('Lee is told on Telegram what was recorded', JSON.stringify(tg).includes('Recorded in Airtable automatically'))
const again2 = await fetch(B + '/__stripe-seed', { method: 'POST', body: JSON.stringify({ email: 'stranger@example.com', name: 'Someone Else', cents: 85000, fire: true }) })
const tg2 = await (await fetch(B + '/__telegram')).json()
ok('a payment from an email on no row is flagged, not recorded', again2.ok && JSON.stringify(tg2).includes('not matched to a player'))
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\n${pass} money guard checks passed`)
process.exit(fail ? 1 : 0)
