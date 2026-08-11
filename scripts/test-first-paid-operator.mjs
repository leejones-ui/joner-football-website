import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const userId = '32584033'
const eventId = `JF_First_Paid_Membership.${crypto.createHash('sha256').update(`uscreen:${userId}`).digest('hex')}`
const key = `jf:meta:first-paid:${eventId.split('.').at(-1)}`
const store = new Map([[key, JSON.stringify({
  status: 'candidate', eventId, uscreenUserId: userId, offerId: 230698,
  metaEvent: {
    event_name: 'JF_First_Paid_Membership', event_id: eventId, event_time: 1,
    action_source: 'website', event_source_url: 'https://app.jonerfootball.com/checkout/success',
    user_data: { em: ['hash'], external_id: ['external-hash'], fbc: 'fb.1.1.click', fbp: 'fb.1.browser' },
    custom_data: { value: 59, currency: 'AUD', campaign_id: 'campaign-1', adset_id: 'adset-1', ad_id: 'ad-1' },
  },
})]])
const metaPayloads = []

const server = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  if (req.url === '/kv') {
    const command = JSON.parse(body)
    let result = null
    if (command[0] === 'GET') result = store.get(command[1]) || null
    else if (command[0] === 'SET') {
      if (command.includes('NX') && store.has(command[1])) result = null
      else { store.set(command[1], command[2]); result = 'OK' }
    } else if (command[0] === 'DEL') result = store.delete(command[1]) ? 1 : 0
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result }))
    return
  }
  if (req.url?.startsWith('/meta/232666285545279/events')) {
    metaPayloads.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ events_received: 1 }))
    return
  }
  res.writeHead(404).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-first-paid-'))
const evidencePath = path.join(dir, 'evidence.json')
fs.writeFileSync(evidencePath, JSON.stringify({
  history_complete: true, next_cursor: null,
  user: { id: Number(userId), plan_history: [{ plan_id: 230698, origin: 'web' }] },
  payments: [{
    id: 57806670, amount: 3999, currency: 'USD', status: 'paid',
    paid_at: '2026-08-10T11:05:21.000-04:00', kind: 'subscription', source_id: 230698,
    provider: 'stripe', provider_invoice_id: 'in_verified',
  }],
}))

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/first-paid-candidate.mjs', ...args], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KV_REST_API_URL: `http://127.0.0.1:${port}/kv`,
        KV_REST_API_TOKEN: 'kv-test-token',
        META_CAPI_TOKEN: 'meta-test-token',
        META_GRAPH_BASE_URL: `http://127.0.0.1:${port}/meta`,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

try {
  const reconciled = await run(['reconcile', userId, evidencePath, 'in_verified', '--confirm-authoritative-uscreen-history'])
  assert.equal(reconciled.code, 0, reconciled.stderr)
  const reconciliation = JSON.parse(reconciled.stdout)
  assert.equal(reconciliation.status, 'verified')
  assert.equal(reconciliation.currency, 'USD')
  assert.equal(reconciliation.value, 39.99)
  assert.equal(reconciliation.historyComplete, true)

  const sent = await run(['send', userId, '--confirm-verified-first-paid', '--test-event-code=TEST123'])
  assert.equal(sent.code, 0, sent.stderr)
  const receipt = JSON.parse(sent.stdout)
  assert.deepEqual(receipt, {
    status: 'sent', eventId, value: 39.99, currency: 'USD', metaStatus: 200, eventsReceived: 1, testEvent: true,
  })
  assert.equal(metaPayloads.length, 1)
  assert.equal(metaPayloads[0].data.length, 1)
  assert.equal(metaPayloads[0].data[0].event_id, eventId)
  assert.equal(metaPayloads[0].data[0].custom_data.currency, 'USD')
  assert.equal(metaPayloads[0].data[0].custom_data.value, 39.99)
  assert.equal(metaPayloads[0].test_event_code, 'TEST123')

  const duplicate = await run(['send', userId, '--confirm-verified-first-paid', '--test-event-code=TEST123'])
  assert.notEqual(duplicate.code, 0)
  assert.match(duplicate.stderr, /not verified against full Uscreen history: sent/)
  assert.equal(metaPayloads.length, 1)
  console.log('first-paid operator integration test passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
}
