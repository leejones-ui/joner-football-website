import dns from 'node:dns/promises'

const COMMON_DOMAINS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'yahoo.com',
  'live.com', 'bigpond.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'yahoo.com.au', 'hotmail.com.au', 'outlook.com.au'
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

export function emailSuggestion(email) {
  const parts = String(email || '').trim().toLowerCase().split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [local, domain] = parts
  if (EXACT_FIXES[domain]) return `${local}@${EXACT_FIXES[domain]}`
  for (const common of COMMON_DOMAINS) {
    if (levenshtein(domain, common) <= 2) return `${local}@${common}`
  }
  return null
}

export function validateEmailFormat(email) {
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

export async function validateEmailQuality(email, { strictRoleEmail = false, label = 'email' } = {}) {
  const validation = validateEmailFormat(email)
  if (!validation.ok) return validation

  const [local, domain] = validation.email.split('@')
  if (strictRoleEmail && ROLE_PREFIXES.has(local)) {
    return { ok: false, error: `Please use your personal ${label} address.` }
  }

  const domainHasMail = await hasMailRoute(domain)
  if (!domainHasMail) {
    return { ok: false, error: 'That email domain does not look real. Please check it and try again.' }
  }

  return validation
}
