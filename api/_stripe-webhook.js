import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'

function parseStripeSignature(header) {
  return String(header || '')
    .split(',')
    .map((part) => part.split('='))
    .reduce((acc, [key, value]) => {
      if (!key || !value) return acc
      if (!acc[key]) acc[key] = []
      acc[key].push(value)
      return acc
    }, {})
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return nodeTimingSafeEqual(left, right)
}

function hmacSha256Hex(secret, payload) {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

export async function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  if (!secret) throw new Error('Stripe webhook secret is not configured.')
  const parsed = parseStripeSignature(signatureHeader)
  const timestamp = parsed.t?.[0]
  const signatures = parsed.v1 || []
  if (!timestamp || signatures.length === 0) throw new Error('Missing Stripe signature.')

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) throw new Error('Stripe signature timestamp is outside tolerance.')

  const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
  const valid = signatures.some((signature) => timingSafeEqual(signature, expected))
  if (!valid) throw new Error('Invalid Stripe signature.')
}
