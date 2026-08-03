import assert from 'node:assert/strict'
import { isAccepted } from '../api/contact-enquiry.js'

assert.equal(isAccepted(true), true)
assert.equal(isAccepted('true'), true)
assert.equal(isAccepted('on'), true)
assert.equal(isAccepted('yes'), true)
assert.equal(isAccepted('YES'), true)
assert.equal(isAccepted(false), false)
assert.equal(isAccepted('false'), false)
assert.equal(isAccepted(''), false)
assert.equal(isAccepted(undefined), false)

console.log('player waiver checkbox parsing: ok')
