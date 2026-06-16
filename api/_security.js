const buckets = new Map()

function ipFromRequest(req) {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) return forwardedFor.split(',')[0].trim()
  if (Array.isArray(forwardedFor) && forwardedFor[0]) return forwardedFor[0].split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

export function cleanString(value, max = 500) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

export function cleanEmail(value, max = 200) {
  return cleanString(value, max).toLowerCase()
}

export function cleanObject(input, shape = {}) {
  const output = {}
  for (const [key, max] of Object.entries(shape)) output[key] = cleanString(input?.[key], max)
  return output
}

export function rateLimit(req, { key = 'form', limit = 5, windowMs = 60_000 } = {}) {
  const ip = ipFromRequest(req)
  const bucketKey = `${key}:${ip}`
  const now = Date.now()
  const current = buckets.get(bucketKey) || { count: 0, resetAt: now + windowMs }

  if (now > current.resetAt) {
    current.count = 0
    current.resetAt = now + windowMs
  }

  current.count += 1
  buckets.set(bucketKey, current)

  if (buckets.size > 5000) {
    for (const [entryKey, entry] of buckets.entries()) {
      if (now > entry.resetAt) buckets.delete(entryKey)
    }
  }

  const allowed = current.count <= limit
  return {
    allowed,
    status: allowed ? 200 : 429,
    error: allowed ? null : 'Too many submissions. Please wait a minute and try again.',
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  }
}

export async function verifyRecaptcha(req, token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY
  const strict = process.env.RECAPTCHA_STRICT === 'true'
  if (!secret) return { ok: true, skipped: true, reason: 'missing-secret' }
  if (!token) {
    if (!strict) {
      console.warn('reCAPTCHA token missing; fail-open to protect customer form submissions. Set RECAPTCHA_STRICT=true to hard block.')
      return { ok: true, skipped: true, reason: 'missing-token-fail-open' }
    }
    return { ok: false, error: 'Bot check failed. Please reload and try again.' }
  }

  try {
    const params = new URLSearchParams({
      secret,
      response: cleanString(token, 2000),
      remoteip: ipFromRequest(req),
    })

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    const data = await response.json().catch(() => ({}))
    const minScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)
    if (data.success && (typeof data.score !== 'number' || data.score >= minScore)) return { ok: true, score: data.score }

    if (!strict) {
      console.warn('reCAPTCHA verification failed; fail-open to protect customer form submissions.', {
        score: data.score,
        errors: data['error-codes'],
      })
      return { ok: true, skipped: true, reason: 'verification-fail-open', recaptchaErrors: data['error-codes'] }
    }
  } catch (error) {
    if (!strict) {
      console.warn('reCAPTCHA verification errored; fail-open to protect customer form submissions.', error?.message || error)
      return { ok: true, skipped: true, reason: 'verification-error-fail-open' }
    }
  }

  return { ok: false, error: 'Bot check failed. Please reload and try again.' }
}

export async function protectForm(req, res, key, body) {
  const limited = rateLimit(req, { key, limit: 5, windowMs: 60_000 })
  if (!limited.allowed) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds))
    return { ok: false, response: res.status(429).json({ success: false, error: limited.error }) }
  }

  const recaptcha = await verifyRecaptcha(req, body?.recaptchaToken || body?.recaptcha_token)
  if (!recaptcha.ok) {
    return { ok: false, response: res.status(400).json({ success: false, error: recaptcha.error }) }
  }

  return { ok: true }
}
