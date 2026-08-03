import assert from 'node:assert/strict'
import { isAccepted, normaliseProgramme } from '../api/contact-enquiry.js'

assert.equal(isAccepted(true), true)
assert.equal(isAccepted('true'), true)
assert.equal(isAccepted('on'), true)
assert.equal(isAccepted('yes'), true)
assert.equal(isAccepted('YES'), true)
assert.equal(isAccepted(false), false)
assert.equal(isAccepted('false'), false)
assert.equal(isAccepted(''), false)
assert.equal(isAccepted(undefined), false)

assert.equal(normaliseProgramme('JFP'), 'JFP')
assert.equal(normaliseProgramme('jfp'), 'JFP')
assert.equal(normaliseProgramme('Joners Juniors'), 'Joners Juniors')
assert.equal(normaliseProgramme('joners-juniors'), 'Joners Juniors')
assert.equal(normaliseProgramme('juniors'), 'Joners Juniors')
assert.equal(normaliseProgramme(''), 'JFP')
assert.equal(normaliseProgramme('unknown'), 'JFP')

console.log('player waiver checkbox and programme parsing: ok')
