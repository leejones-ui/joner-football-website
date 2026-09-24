import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCapture, captureWebsiteContact, normalisePhone, replayCapture, listCaptureOutbox, MASTER_BASE_ID, MASTER_TABLE_ID, USA_TABLE_ID } from '../api/_master-contact-capture.js'
import operator from '../api/master-contact-capture-replay.js'
const env = { ...process.env }, fetchOriginal = globalThis.fetch
const phone = '+61422123456'
const input = { phone, name: 'TEST Parent', email: 'test@example.test', endpoint: 'contact-enquiry', source: 'test', players: [{ name: 'TEST Child', dob: 'omit' }], medicalHistory: 'omit' }
let pending, locks, tables, calls, failAir, failKV, badRead
const response = data => new Response(JSON.stringify(data))
test.beforeEach(() => {
  process.env = { ...env, MASTER_CONTACT_CAPTURE_ENABLED: 'true', MASTER_CONTACT_AIRTABLE_TOKEN: 'fake', MASTER_CONTACT_BASE_ID: MASTER_BASE_ID, MASTER_CONTACT_TABLE_ID: MASTER_TABLE_ID, MASTER_CONTACT_USA_TABLE_ID: USA_TABLE_ID, KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'fake', MASTER_CONTACT_CAPTURE_REPLAY_SECRET: 'local-test' }
  pending = new Map(); locks = new Map(); tables = { [MASTER_TABLE_ID]: [], [USA_TABLE_ID]: [] }; calls = []; failAir = false; failKV = false; badRead = false
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init })
    assert.ok(init.signal, 'every capture request has a timeout')
    if (url === 'https://kv.test') {
      if (failKV) throw new Error('SECRET TRANSPORT ERROR')
      const [cmd, key, ...args] = JSON.parse(init.body)
      let result = 1
      if (cmd === 'HSETNX') { if (!pending.has(args[0])) pending.set(args[0], args[1]) }
      else if (cmd === 'HGET') result = pending.get(args[0]) || null
      else if (cmd === 'HDEL') result = Number(pending.delete(args[0]))
      else if (cmd === 'HSCAN') result = ['0', [...pending].flat()]
      else if (cmd === 'SET') { result = locks.has(key) ? null : 'OK'; if (result) locks.set(key, args[0]) }
      else if (cmd === 'EVAL') { if (locks.get(args[1]) === args[2]) locks.delete(args[1]) }
      else assert.fail(`Unexpected KV ${cmd}`)
      return response({ result })
    }
    const u = new URL(url)
    assert.equal(u.hostname, 'api.airtable.com', 'no other network services permitted')
    const [, , base, table, id] = u.pathname.split('/')
    assert.equal(base, MASTER_BASE_ID)
    assert.ok(table in tables, 'term/player/payment tables unreachable')
    if (failAir) return new Response('PRIVATE PROVIDER ERROR', { status: 503 })
    if (init.method === 'PATCH') {
      const payload = JSON.parse(init.body)
      assert.equal(payload.typecast, false)
      if (id) { const r = tables[table].find(r => r.id === id); Object.assign(r.fields, payload.fields); return response(r) }
      assert.deepEqual(payload.performUpsert, { fieldsToMergeOn: ['Master Contact Key'] })
      const fields = payload.records[0].fields
      let r = tables[table].find(r => r.fields['Master Contact Key'] === fields['Master Contact Key'])
      if (!r) { r = { id: `rec${tables[table].length}`, fields: {} }; tables[table].push(r) }
      Object.assign(r.fields, fields); return response({ records: [r] })
    }
    if (id) return response(badRead ? { id, fields: {} } : tables[table].find(r => r.id === id))
    const formula = u.searchParams.get('filterByFormula')
    return response({ records: tables[table].filter(r => formula.includes(`'${r.fields['Master Contact Key']}'`)) })
  }
})
test.afterEach(() => { process.env = { ...env }; globalThis.fetch = fetchOriginal })

test('AU national, US versus Canadian +1, strict syntax and ambiguous national review', () => {
  assert.equal(normalisePhone('0422 123 456', { country: 'AU' }).phone, phone)
  assert.equal(buildCapture({ phone: '+14155550100' }).contact.destination, 'usa')
  assert.equal(buildCapture({ phone: '+14165550100', country: 'US' }).contact.destination, 'main')
  for (const raw of ['0422 123 456', '123', 'Call +61422123456', '+61422123456 ext 1']) assert.equal(normalisePhone(raw).ok, false)
})
test('disabled and missing phone make zero calls', async () => {
  process.env.MASTER_CONTACT_CAPTURE_ENABLED = 'false'
  assert.equal((await captureWebsiteContact(input)).status, 'disabled')
  process.env.MASTER_CONTACT_CAPTURE_ENABLED = 'true'
  assert.equal((await captureWebsiteContact({ email: input.email })).status, 'skipped')
  assert.equal(calls.length, 0)
})
test('create, exact readback, repeat dedupe and safe consent', async () => {
  assert.equal((await captureWebsiteContact(input)).status, 'persisted')
  assert.equal((await captureWebsiteContact(input)).status, 'persisted')
  assert.equal(tables[MASTER_TABLE_ID].length, 1)
  const f = tables[MASTER_TABLE_ID][0].fields
  assert.equal(f['Marketing Permission'], 'Unknown - consent review required')
  assert.equal(f['Approved for Promos'], undefined)
  assert.equal(pending.size, 0)
  assert.ok(!JSON.stringify(calls).includes('medicalHistory'))
  assert.ok(f['Source Evidence'].includes('TEST Child'))
})
test('existing shared owner, blank identity, permission and long evidence preserved', async () => {
  const fields = { 'Master Contact Key': `phone:${phone}`, 'Contact Name': '', 'Recipient Name': 'Owner', 'Identity Status': '', 'Do Not Contact': true, 'Marketing Permission': 'Opted out', 'Approved for Promos': false, 'Players': ['recProtected'], 'Source Evidence': 'x'.repeat(1000) }
  tables[USA_TABLE_ID].push({ id: 'recExisting', fields: structuredClone(fields) })
  assert.equal((await captureWebsiteContact(input)).table, USA_TABLE_ID)
  for (const [k,v] of Object.entries(fields)) if (k !== 'Source Evidence') assert.deepEqual(tables[USA_TABLE_ID][0].fields[k], v)
  assert.ok(tables[USA_TABLE_ID][0].fields['Source Evidence'].startsWith(fields['Source Evidence']))
  assert.ok(tables[USA_TABLE_ID][0].fields['Source Contact Labels'].includes('TEST Parent'))
})
test('provider outage queues before write, replay verifies and removes, second replay no-op', async () => {
  failAir = true
  const r = await captureWebsiteContact(input)
  assert.equal(r.status, 'queued'); assert.equal(pending.size, 1)
  failAir = false
  assert.deepEqual((await listCaptureOutbox()).ids, [r.outboxId])
  assert.equal((await replayCapture(r.outboxId)).status, 'persisted')
  assert.equal((await replayCapture(r.outboxId)).status, 'not_found')
})
test('invalid/ambiguous numbers retained without master writes or private payload fields', async () => {
  const r = await captureWebsiteContact({ ...input, phone: '0422 123 456' })
  assert.equal(r.status, 'review_required'); assert.equal(pending.size, 1)
  assert.equal((await replayCapture(r.outboxId)).status, 'review_required')
  assert.ok(calls.every(c => c.url === 'https://kv.test'))
  assert.ok(![...pending.values()][0].includes('medicalHistory'))
})
test('queue failure is nonfatal and never silently claimed persisted', async () => {
  failKV = true
  assert.equal((await captureWebsiteContact(input)).status, 'failed')
  assert.equal(tables[MASTER_TABLE_ID].length, 0)
})
test('readback mismatch stays queued', async () => {
  badRead = true
  assert.equal((await captureWebsiteContact(input)).status, 'queued')
  assert.equal(pending.size, 1)
})
test('wrong explicit target cannot write protected tables', async () => {
  process.env.MASTER_CONTACT_TABLE_ID = 'tblTerm4'
  assert.equal((await captureWebsiteContact(input)).status, 'queued')
  assert.ok(calls.every(c => c.url === 'https://kv.test'))
})
test('duplicate endpoints across regional tables refuse identity choice', async () => {
  for (const table of Object.values(tables)) table.push({ id: 'recDuplicate', fields: { 'Master Contact Key': `phone:${phone}` } })
  assert.equal((await captureWebsiteContact(input)).status, 'queued')
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0)
})
test('concurrent captures serialize; queued loser can replay without duplicate endpoint', async () => {
  const results = await Promise.all([captureWebsiteContact(input), captureWebsiteContact({ ...input, name: 'TEST Other Parent' })])
  assert.equal(results.filter(r => r.status === 'persisted').length, 1)
  for (const r of results) if (r.outboxId) await replayCapture(r.outboxId)
  assert.equal(tables[MASTER_TABLE_ID].length, 1)
  assert.ok(tables[MASTER_TABLE_ID][0].fields['Source Contact Labels'].includes('Other Parent'))
})
const res = () => ({ code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v }, status(n) { this.code = n; return this }, json(body) { this.body = body; return this } })
test('operator auth, dryRun, malformed JSON, capture and replay use only capture services', async () => {
  let r = res(); await operator({ method: 'POST', headers: {}, body: {} }, r); assert.equal(r.code, 401)
  const req = { method: 'POST', headers: { 'x-master-capture-secret': 'local-test' } }
  r = res(); await operator({ ...req, body: { action: 'dryRun', payload: input } }, r); assert.equal(r.code, 200); assert.equal(calls.length, 0)
  r = res(); await operator({ ...req, body: '{' }, r); assert.equal(r.code, 500)
  r = res(); await operator({ ...req, body: { action: 'capture', payload: input } }, r); assert.equal(r.body.result.status, 'persisted')
  assert.equal(r.headers['Cache-Control'], 'no-store')
})
