// How long each Money programme takes to come up, and what it fetches
// (Lee, 13 Oct 2026: "when I click on JFP / holiday training etc it takes a
// while to load"). Run against the local harness with pretend network delays:
//   npm run build
//   HARNESS_LATENCY="airtable=250,stripe=300,kv=8" HOLIDAY_LOCAL_PORT=4591 node scripts/holiday-local.mjs
//   node scripts/time-jfp-money.mjs 4591
// Prints, for each server read a programme makes on its first paint, the
// time and the Airtable / Stripe / KV calls behind it: cold (first look),
// then warm (looked at a minute ago), then switching between programmes.
import { DEFAULT_CONFIG } from '../api/_jfp-store.js'
const B = `http://localhost:${Number(process.argv[2] || 4321)}`, O = { origin: B, 'content-type': 'application/json' }
const jar = new Map(); const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
async function call(p, body) {
  const r = await fetch(B + p, { method: 'POST', headers: { ...O, cookie: ck() }, body: JSON.stringify(body) })
  for (const c of (r.headers.getSetCookie?.() || [])) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v) }
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const st = await call('/api/jfp-auth', { action: 'start', audience: 'staff', email: DEFAULT_CONFIG.superAdmins[0] })
const mail = (await (await fetch(B + '/__emails')).json()).filter((e) => /sign-in code/.test(e.subject))
const vf = await call('/api/jfp-auth', { action: 'verify', challenge: st.data.challenge, code: mail.at(-1)?.subject.match(/(\d{6})/)?.[1] })
if (vf.status !== 200) { console.error('could not sign in'); process.exit(1) }
const calls = async (reset) => (await fetch(`${B}/__calls${reset ? '?reset=1' : ''}`)).json()

// What each programme asks the server for before it can draw.
// (Asked with nothing to do, so nothing is read or cached by the asking.)
const has = async (action) => !/Unknown action/.test((await call('/api/jfp-portal-data', { action })).data.error || '')
const READS = [
  ['JFP (first paint)', { action: 'money', quick: true }],
  ['JFP (latest, in the background)', { action: 'money' }],
  ['JFP bank transfers to check', { action: 'bankCheck' }],
  ['Joners Juniors', { action: 'juniorsMoney' }],
  ['Holiday training', { action: 'holidayMoney' }],
]
// Since 13 Oct 2026 each first paint asks for its quick reading.
const NEW = await has('bankProUndo')
if (NEW) {
  READS.splice(3, 2, ['Joners Juniors (first paint)', { action: 'juniorsMoney', quick: true }], ['Joners Juniors (latest, behind it)', { action: 'juniorsMoney' }], ['Holiday training (first paint)', { action: 'holidayMoney', quick: true }])
  READS.push(['Pro sessions (first paint)', { action: 'proMoney', quick: true }], ['Pro sessions (latest, behind it)', { action: 'proMoney' }], ['Camps', { action: 'campsMoney' }], ['Camps Stripe check (first paint)', { action: 'campsStripe', year: new Date().getFullYear(), quick: true }])
}

async function time(body) {
  await calls(true)
  const t = performance.now()
  const r = await call('/api/jfp-portal-data', body)
  const ms = Math.round(performance.now() - t)
  return { ms, status: r.status, ...(await calls(true)) }
}
const row = (label, x) => console.log(`${label.padEnd(34)} ${String(x.ms).padStart(6)} ms  ${String(x.status).padEnd(4)} airtable ${String(x.airtable || 0).padStart(3)}  stripe ${String(x.stripe || 0).padStart(3)}  kv ${String(x.kv || 0).padStart(3)}`)
const out = { cold: {}, warm: {} }
console.log('--- cold (nothing cached on the server)')
for (const [label, body] of READS) { out.cold[label] = await time(body); row(label, out.cold[label]) }
console.log('--- warm (looked at a moment ago)')
for (const [label, body] of READS) { out.warm[label] = await time(body); row(label, out.warm[label]) }
// Lee comes back to Money 10 minutes later: every kept reading is 10 minutes old.
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
for (const key of ['jfp:stripe-payments:v2', 'jfp:juniors-money', 'jfp:juniors-stripe', 'holiday:stripe-payments:v2', 'jfp:roster-cache', 'jfp:ledger-cache', 'jfp:camps-cache']) {
  const raw = await kv(['GET', key])
  let v
  try { v = JSON.parse(raw) } catch { continue }
  if (!v || typeof v !== 'object' || !v.at) continue
  v.at = typeof v.at === 'number' ? v.at - 600000 : new Date(Date.parse(v.at) - 600000).toISOString()
  await kv(['SET', key, JSON.stringify(v)])
}
console.log('--- 10 minutes later (every kept reading 10 minutes old)')
out.later = {}
for (const [label, body] of READS) { out.later[label] = await time(body); row(label, out.later[label]) }
console.log(JSON.stringify(out))
