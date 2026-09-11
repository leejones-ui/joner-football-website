import assert from 'node:assert/strict'
import { sendEmail, validateCoachingDemoUrl } from '../api/contact-enquiry.js'

assert.deepEqual(validateCoachingDemoUrl('https://video.example.com/share/coach-demo'), {
  ok: true,
  value: 'https://video.example.com/share/coach-demo',
})
assert.equal(validateCoachingDemoUrl('javascript:alert(1)').ok, false)
assert.equal(validateCoachingDemoUrl('file:///tmp/demo').ok, false)
assert.equal(validateCoachingDemoUrl('http://user:pass@example.com/demo').ok, false)
assert.equal(validateCoachingDemoUrl('').value, '')

const originalFetch = globalThis.fetch
let request
process.env.BREVO_API_KEY = 'mock-only'
globalThis.fetch = async (url, options) => {
  request = { url, options }
  return { ok: true, text: async () => '' }
}
await sendEmail({
  typeLabel: 'Apply For A Coaching Role',
  name: 'Test Applicant',
  email: 'test@example.com',
  recipientEmail: 'recruitment@example.com',
  coachingDemoUrl: 'https://video.example.com/share/coach-demo',
  submittedAt: '2026-09-11T00:00:00.000Z',
})
globalThis.fetch = originalFetch
assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email')
assert.match(JSON.parse(request.options.body).htmlContent, /Coaching demonstration video link/)
assert.match(JSON.parse(request.options.body).htmlContent, /https:\/\/video\.example\.com\/share\/coach-demo/)
console.log('Coaching demo URL validation and mocked email forwarding: passed')
