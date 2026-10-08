// Isolated route tests against a fake KV provider. No live data or credentials.
import assert from 'node:assert/strict'
import handler, { criteriaPatch, CRITERIA_SCRIPT } from '../api/jfp-admin.js'
import { REQUIREMENTS, keys, validateGroup, normaliseConfig, clean } from '../api/_jfp-store.js'

const token = 'test-only-'.repeat(8)
const originalFetch = globalThis.fetch
const originalToken = process.env.JFP_ADMIN_TOKEN
const originalUrl = process.env.KV_REST_API_URL
const originalKV = process.env.KV_REST_API_TOKEN
process.env.JFP_ADMIN_TOKEN = token
process.env.KV_REST_API_URL = 'https://isolated.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'
const initial = { id: 'test', day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 4, mode: 'direct', requirements: [], requirementsText: '', customField: { keep: true }, updatedAt: 'unchanged' }
let rows, audits, writes, conflict, ambiguous
function reset() { rows = new Map([['test', JSON.stringify(initial)]]); audits = []; writes = 0; conflict = false; ambiguous = false }
globalThis.fetch = async (_url, init) => {
  const cmd = JSON.parse(init.body)
  let result
  if (cmd[0] === 'GET') result = null
  else if (cmd[0] === 'HGET') result = rows.get(cmd[2]) ?? null
  else if (cmd[0] === 'HGETALL') result = [...rows.entries()].flat()
  else if (cmd[0] === 'EVAL') {
    assert.equal(cmd[1], CRITERIA_SCRIPT)
    assert.equal(cmd[3], keys.groups()); assert.equal(cmd[4], keys.audit())
    const items = JSON.parse(cmd[5])
    if (conflict) result = ['conflict', 'test']
    else {
      for (const item of items) assert.equal(rows.get(item.id), item.before)
      for (const item of items) { rows.set(item.id, item.after); audits.push(JSON.parse(item.audit)); writes++ }
      if (ambiguous) throw new Error('simulated timeout after commit')
      result = ['ok']
    }
  } else throw new Error(`Unexpected command ${cmd[0]}`)
  return { ok: true, json: async () => ({ result }) }
}
async function call(body, method = 'POST', auth = `Bearer ${token}`) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(s) { this.code = s; return this }, json(b) { this.body = b; return this } }
  await handler({ method, headers: { authorization: auth }, body }, res)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  return res
}
const request = groups => ({ action: 'setCriteria', groups })
let passed = 0
async function test(name, fn) { reset(); await fn(); passed++; console.log(`PASS ${name}`) }
try {
  assert.equal(typeof clean, 'function'); assert.ok(Object.keys(REQUIREMENTS).length)
  assert.equal(validateGroup(initial, normaliseConfig({}), initial).ok, true)
  assert.equal(validateGroup({ ...initial, day: 'bad' }, normaliseConfig({}), initial).ok, false)
  await test('disabled without configured token', async () => { delete process.env.JFP_ADMIN_TOKEN; assert.equal((await call({})).code, 503); process.env.JFP_ADMIN_TOKEN = token })
  await test('missing and wrong credentials rejected', async () => { for (const auth of ['', 'Bearer wrong', token, ['Bearer bad']]) assert.equal((await call({}, 'GET', auth)).code, 401); assert.equal(writes, 0) })
  await test('methods restricted', async () => { assert.equal((await call({}, 'DELETE')).code, 405); assert.equal(writes, 0) })
  await test('GET excludes unrelated fields', async () => { const r = await call(null, 'GET'); assert.equal(r.code, 200); assert.equal(r.body.groups[0].customField, undefined); assert.equal(writes, 0) })
  await test('invalid JSON and body types rejected', async () => { for (const b of ['{', 'null', [], null, {}, { action: 'groups' }]) assert.equal((await call(b)).code, 400) })
  await test('invalid batch sizes rejected', async () => { for (const g of [[], null, Array(101).fill({ id: 'test', requirements: [] })]) assert.equal((await call(request(g))).code, 400) })
  await test('malformed items and unrestricted fields rejected', async () => { for (const item of [null, [], { id: 'test' }, { id: 'test', capacity: 99, requirements: [] }, { id: 'test', requirements: 'club' }, { id: 'test', requirements: ['__proto__'] }, { id: 'test', requirements: ['toString'] }, { id: 'test', requirementsText: 4 }, { id: 'test', requirementsText: 'x'.repeat(1201) }, { id: 'test ', requirements: [] }]) assert.equal((await call(request([item]))).code, 400); assert.equal(writes, 0) })
  await test('duplicate ids rejected before writes', async () => { assert.equal((await call(request([{ id: 'test', requirements: [] }, { id: 'test', requirements: [] }]))).code, 400); assert.equal(writes, 0) })
  await test('missing row rejects complete batch', async () => { assert.equal((await call(request([{ id: 'test', requirementsText: 'changed' }, { id: 'missing', requirements: [] }]))).code, 404); assert.equal(writes, 0) })
  await test('invalid existing group rejected', async () => { rows.set('test', JSON.stringify({ ...initial, day: 'bad' })); assert.equal((await call(request([{ id: 'test', requirementsText: 'changed' }]))).code, 400); assert.equal(writes, 0) })
  await test('only criteria fields change, audit is explicit', async () => {
    const requirement = Object.keys(REQUIREMENTS)[0]
    const r = await call(request([{ id: 'test', requirements: [requirement, requirement], requirementsText: '  Lee says\r\nhello  ' }]))
    assert.equal(r.code, 200); assert.equal(r.body.changed, 1)
    const saved = JSON.parse(rows.get('test'))
    assert.deepEqual(saved, { ...initial, requirements: [requirement], requirementsText: 'Lee says\nhello' })
    assert.equal(audits.length, 1); assert.equal(audits[0].action, 'group.criteria'); assert.match(audits[0].by, /shared admin token/)
  })
  await test('identical retries do not write or audit twice', async () => { const b = request([{ id: 'test', requirementsText: 'changed' }]); await call(b); assert.equal((await call(b)).body.changed, 0); assert.equal(writes, 1); assert.equal(audits.length, 1) })
  await test('conflicts return 409 with no writes', async () => { conflict = true; assert.equal((await call(request([{ id: 'test', requirementsText: 'changed' }]))).code, 409); assert.equal(writes, 0) })
  await test('ambiguous commit instructs reconciliation, not blind retry', async () => { ambiguous = true; const r = await call(request([{ id: 'test', requirementsText: 'changed' }])); assert.equal(r.code, 503); assert.match(r.body.error, /unconfirmed/); assert.equal(writes, 1) })
  console.log(`${passed} isolated admin tests passed; no live data accessed.`)
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries({ JFP_ADMIN_TOKEN: originalToken, KV_REST_API_URL: originalUrl, KV_REST_API_TOKEN: originalKV })) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
