import assert from 'node:assert/strict'
import { accountListIds, addAccountToBrevo } from '../api/_jfp-brevo-account.js'
assert.deepEqual(accountListIds({ email: 'a@b.com', known: false }), [6])
assert.deepEqual(accountListIds({ email: 'A@B.com', known: true }), [18])
assert.deepEqual(accountListIds({ email: 'ligia@jonerfootball.com', known: false }), [])
process.env.BREVO_API_KEY = 'test'
let sent
const r = await addAccountToBrevo({ email: 'New@Family.com', known: false }, async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return { ok: true } })
assert.equal(r.ok, true); assert.deepEqual(sent.body, { email: 'new@family.com', listIds: [6], updateEnabled: true })
const bad = await addAccountToBrevo({ email: 'x@y.com', known: true }, async () => { throw new Error('down') })
assert.equal(bad.ok, false)
console.log('jfp brevo account: 5 checks pass')
