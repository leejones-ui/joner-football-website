// Taking money from a family's card is Lee and Ligia only (Lee, 17 Oct 2026).
// The Hermes agent key may read the auto-charge panel and the switches, but
// never charge a saved card, run auto charge, or flip any switch.
//   node scripts/holiday-local.mjs 4321 (after npm run build), then
//   node scripts/test-jfp-hermes-money.mjs 4321
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()

const KEY = `jfpa_${crypto.randomBytes(32).toString('base64url')}`
async function H(action, body = {}) {
  const res = await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jfp-agent-key': KEY, 'x-jfp-confirmed': 'lee-said-yes' }, body: JSON.stringify({ ...body, action }) })
  let data = {}; try { data = await res.json() } catch {}
  return { status: res.status, data }
}
await kv(['SET', 'jfp:agent:hermes', JSON.stringify({ hash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true })])

await test('Hermes can read the auto-charge panel and the switches', async () => {
  assert.equal((await H('me')).status, 200)
  assert.equal((await H('autoChargePanel')).status, 200)
  const s = await H('savedPaySettings')
  assert.equal(s.status, 200, JSON.stringify(s.data))
})

await test('Hermes cannot flip the card or auto-charge switches', async () => {
  const before = (await H('savedPaySettings')).data.savedPay
  const r = await H('savedPaySettings', { set: { cards: true, autoCharge: true } })
  assert.equal(r.status, 403, JSON.stringify(r.data))
  assert.match(r.data.error, /Lee or Ligia/)
  assert.deepEqual((await H('savedPaySettings')).data.savedPay, before)
})

await test('Hermes cannot run auto charge, switch a player on, or charge a saved card', async () => {
  for (const [action, body] of [
    ['autoChargeRun', { confirm: true }],
    ['autoChargeSwitch', { rowId: 'recAny', on: true }],
    ['chargeSavedPay', { confirm: true, agreed: true, chargeId: 'CHG-any' }],
  ]) {
    const r = await H(action, body)
    assert.equal(r.status, 403, `${action}: ${JSON.stringify(r.data)}`)
  }
})

console.log(`\n${passed} Hermes card-money checks passed`)
