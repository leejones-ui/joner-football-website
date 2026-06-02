import { cleanString, protectForm } from './_security.js'
import { processUscreenPayload } from './_uscreen-webhook.js'
import dns from 'node:dns/promises'

const COMMON_DOMAINS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'yahoo.com',
  'live.com', 'bigpond.com', 'me.com', 'mac.com', 'aol.com', 'proton.me'
]

const EXACT_FIXES = {
  'gmal.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail,com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'bigpond.con': 'bigpond.com',
  'live.con': 'live.com'
}

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'anonaddy.com',
  'burnermail.io', 'dispostable.com', 'emailondeck.com', 'fakeinbox.com',
  'getnada.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'maildrop.cc', 'mailinator.com', 'mailinator.net', 'mailnesia.com',
  'moakt.com', 'sharklasers.com', 'temp-mail.org', 'tempmail.com',
  'tempmail.net', 'throwawaymail.com', 'trashmail.com', 'yopmail.com'
])

const ROLE_PREFIXES = new Set([
  'admin', 'contact', 'hello', 'info', 'marketing', 'noreply', 'no-reply',
  'office', 'sales', 'support', 'team', 'test'
])

function levenshtein(a, b) {
  const matrix = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
    }
  }
  return matrix[b.length][a.length]
}

function emailSuggestion(email) {
  const parts = String(email || '').trim().toLowerCase().split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [local, domain] = parts
  if (EXACT_FIXES[domain]) return `${local}@${EXACT_FIXES[domain]}`
  for (const common of COMMON_DOMAINS) {
    if (levenshtein(domain, common) <= 2) return `${local}@${common}`
  }
  return null
}

function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return { ok: false, error: 'Email is required.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return { ok: false, error: 'Enter a valid email address.' }
  if (value.includes('..')) return { ok: false, error: 'Enter a valid email address.' }
  const [local, domain] = value.split('@')
  if (!local || !domain) return { ok: false, error: 'Enter a valid email address.' }
  if (local.length > 64 || domain.length > 253) return { ok: false, error: 'Enter a valid email address.' }
  if (local.startsWith('.') || local.endsWith('.')) return { ok: false, error: 'Enter a valid email address.' }
  if (DISPOSABLE_DOMAINS.has(domain)) return { ok: false, error: 'Please use your real email address, not a temporary email.' }
  const suggestion = emailSuggestion(value)
  if (suggestion && suggestion !== value) return { ok: false, error: `Did you mean ${suggestion}?` }
  return { ok: true, email: value }
}

function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
}

async function hasMailRoute(domain) {
  try {
    const mx = await Promise.race([dns.resolveMx(domain), timeoutPromise(2000)])
    if (Array.isArray(mx) && mx.length) return true
  } catch (error) {}

  try {
    const addresses = await Promise.race([dns.resolve4(domain), timeoutPromise(1500)])
    if (Array.isArray(addresses) && addresses.length) return true
  } catch (error) {}

  try {
    const addresses = await Promise.race([dns.resolve6(domain), timeoutPromise(1500)])
    if (Array.isArray(addresses) && addresses.length) return true
  } catch (error) {}

  return false
}

async function validateEmailQuality(email, { strictRoleEmail = false } = {}) {
  const validation = validateEmail(email)
  if (!validation.ok) return validation

  const [local, domain] = validation.email.split('@')
  if (strictRoleEmail && ROLE_PREFIXES.has(local)) {
    return { ok: false, error: 'Please use your personal email address so we can send your Hub access.' }
  }

  const domainHasMail = await hasMailRoute(domain)
  if (!domainHasMail) {
    return { ok: false, error: 'That email domain does not look real. Please check it and try again.' }
  }

  return validation
}

function parseListIds(body) {
  const rawValues = []
  if (Array.isArray(body.listIds)) rawValues.push(...body.listIds)
  if (body.listIds && !Array.isArray(body.listIds)) rawValues.push(...String(body.listIds).split(','))
  if (body.list_ids) rawValues.push(...String(body.list_ids).split(','))
  rawValues.push(body.listId || process.env.BREVO_HUB_LIST_ID || 2)

  const ids = Array.from(new Set(rawValues
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0)))
  return ids.length ? ids : [2]
}

function row(label, value) {
  if (!value) return ''
  return `<tr><td style="font-weight:bold;vertical-align:top;">${String(label).replace(/[<>]/g, '')}</td><td>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td></tr>`
}

async function sendSubscribeNotification({ source, email, firstName, body }) {
  if (source !== 'coaches-course-application') return
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return
  const to = String(process.env.COACHES_COURSE_NOTIFICATION_EMAIL || 'leejones@jonerfootball.com')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
    .map((address) => ({ email: address, name: 'Joner Football' }))
  if (!to.length) return

  const html = `
    <h2>New coaches course enquiry</h2>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
      ${row('Name', firstName)}
      ${row('Email', email)}
      ${row('Phone', body.phone)}
      ${row('Coaching experience', body.coaching_experience)}
      ${row('Coaching journey', body.coaching_journey)}
      ${row('Submitted at', new Date().toISOString())}
    </table>
  `

  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: 'Joner Football Website',
        email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com',
      },
      to,
      replyTo: { email, name: firstName },
      subject: `Coaches course enquiry: ${firstName}`,
      htmlContent: html,
    }),
  })
}

export default async function handler(req, res) {
  if (req.query?.uscreen_webhook === '1') {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, POST, OPTIONS')
      return res.status(204).end()
    }

    if (req.method === 'GET') {
      return res.status(200).json({ status: 'healthy', service: 'uscreen-webhook', timestamp: new Date().toISOString() })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS')
      return res.status(405).json({ success: false, error: 'Method not allowed' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const eventType = String(body.event || body.type || body.event_type || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'unknown'

    try {
      const result = await processUscreenPayload(body)
      console.info('Uscreen webhook accepted', {
        event: result.event,
        id: cleanString(body.id || '', 80),
        offerId: Number(body.offer_id || body.subscription_id) || null,
        processed: Boolean(result.processed),
        skipped: Boolean(result.skipped),
        reason: result.reason || null,
      })
      return res.status(200).json({
        status: 'accepted',
        event: result.event,
        processed: Boolean(result.processed),
        skipped: Boolean(result.skipped),
        reason: result.reason || undefined,
      })
    } catch (error) {
      console.error('Uscreen webhook processing failed after receipt', {
        event: eventType,
        id: cleanString(body.id || '', 80),
        offerId: Number(body.offer_id || body.subscription_id) || null,
        error: error?.message || String(error),
      })
      return res.status(200).json({ status: 'accepted', event: eventType, processed: false, queuedForReview: true })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return res.status(500).json({ success: false, error: 'Brevo is not configured yet.' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const protection = await protectForm(req, res, 'subscribe', body)
    if (!protection.ok) return protection.response

    const firstName = cleanString(body.firstName || body.first_name || body.name || '', 80)
    if (!firstName) return res.status(400).json({ success: false, error: 'Name is required.' })

    const listIds = parseListIds(body)
    const source = cleanString(body.source || body.formName || 'website-form', 80)
    const isHubGate = source.startsWith('hub-gate')
    const marketingConsent = body.marketingConsent === true || body.marketingConsent === 'true' || body.marketingConsent === 'on'

    const validation = await validateEmailQuality(body.email, { strictRoleEmail: isHubGate })
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error })

    if (isHubGate && !marketingConsent) {
      return res.status(400).json({ success: false, error: 'Email opt-in is required to access the free Hub.' })
    }

    const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        email: validation.email,
        attributes: {
          FIRSTNAME: firstName,
          WEBSITE_SOURCE: source
        },
        listIds,
        updateEnabled: true
      })
    })

    const text = await brevoResponse.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch (error) { data = {} }

    if (!brevoResponse.ok) {
      const message = data.message || 'Could not add email to Brevo.'
      return res.status(brevoResponse.status).json({ success: false, error: message })
    }

    try {
      await sendSubscribeNotification({ source, email: validation.email, firstName, body })
    } catch (notifyError) {
      console.error('Subscribe notification failed:', notifyError)
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Could not process that email.' })
  }
}
