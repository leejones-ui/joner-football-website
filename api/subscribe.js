import { cleanString, protectForm } from './_security.js'
import { extractAttribution, extractMetaIdentity } from './_attribution.js'
import { linkJourneyIdentity } from './_journey-ledger.js'
import { isValidUscreenWebhookSecret, parseUscreenBody, processUscreenPayload } from './_uscreen-webhook.js'
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

function parseRoles(value) {
  return String(value || '')
    .split(',')
    .map((role) => cleanString(role, 30).toLowerCase())
    .filter((role) => ['coach', 'player', 'parent', 'fan'].includes(role))
}

function enforceFreeBundleRoleLists(listIds, body) {
  const source = cleanString(body.source || body.formName || '', 80)
  if (!source.startsWith('free-bundle')) return listIds

  const roles = parseRoles(body.roles)
  // Free-bundle signups should also enter Hot APP Leads (#2), Lee's main app
  // campaign list. The old bad welcome email was verified as a Coaches Free
  // Bundle Users (#34) automation, not a Hot APP Leads (#2) trigger.
  const ids = new Set(listIds)
  ids.add(Number(process.env.BREVO_HOT_APP_LEADS_LIST_ID || 2))
  // Every free bundle signup also enters the shared free-bundle automation flow.
  ids.add(Number(process.env.BREVO_FREE_BUNDLE_USERS_LIST_ID || 42))
  if (roles.includes('coach')) {
    ids.add(Number(process.env.BREVO_COACHES_FREE_BUNDLE_USERS_LIST_ID || 34))
    ids.add(Number(process.env.BREVO_COACHES_DATABASE_LIST_ID || 39))
  }
  if (roles.includes('player')) ids.add(Number(process.env.BREVO_PLAYERS_APP_LEADS_LIST_ID || 50))
  if (roles.includes('parent')) ids.add(Number(process.env.BREVO_PARENT_APP_LEADS_LIST_ID || 51))

  return Array.from(ids).filter((id) => Number.isInteger(id) && id > 0)
}

function utm(url, campaign, content) {
  const parsed = new URL(url)
  parsed.searchParams.set('utm_source', 'brevo')
  parsed.searchParams.set('utm_medium', 'email')
  parsed.searchParams.set('utm_campaign', campaign)
  parsed.searchParams.set('utm_content', content)
  return parsed.toString()
}

function freeBundleEmailCopy(roles) {
  const roleSet = new Set(roles)
  const campaign = 'free_bundle_followers'
  const freeUrl = utm('https://app.jonerfootball.com/categories/category-vpi8uazway4', campaign, 'free_section_button')
  const coachesUrl = utm('https://jonerfootball.com/app/for-coaches/', campaign, 'coaches_button')
  const coachSessionPlanUrl = utm('https://app.jonerfootball.com/checkout/new?o=226775', campaign, 'free_session_plan_pack_image')
  const soloTrainingPackUrl = 'https://app.jonerfootball.com/checkout/new?o=226774&utm_source=free_bundle&utm_medium=thank_you_page&utm_campaign=free_bundle_followers&utm_content=free_solo_training_pack'
  const cognitiveBundleUrl = 'https://app.jonerfootball.com/checkout/new?o=228257&utm_source=free_bundle&utm_medium=thank_you_page&utm_campaign=free_bundle_followers&utm_content=cognitive_bundle'
  const playerUrl = utm('https://app.jonerfootball.com/categories/category-qee31-z2mxo', campaign, 'player_100_day_button')
  const parentUrl = utm('https://jonerfootball.com/join/', campaign, 'parent_app_button')
  const teamUrl = utm('https://jonerfootball.com/teams/', campaign, 'team_subscription_button')
  const freeExtrasUrl = utm('https://jonerfootball.com/free-bundle/watch/', campaign, 'more_free_bundles_button')

  if (roleSet.has('coach')) {
    return {
      subject: 'Your free Joner coaching videos',
      preview: 'Free videos first, then a better way to plan your sessions.',
      heroImage: 'https://jonerfootball.com/images/free-bundle/emails/coach-hero.jpg',
      heroAlt: 'Lee Jones coaching a group of football players',
      eyebrow: 'Coaches free bundle',
      headline: 'Run a sharper session this week',
      body: [
        'Your free Joner Football videos are ready.',
        'Start with them first. You will see the detail behind the way I want players to train, not just random drills pulled from the internet.',
        'If you coach players, the biggest win is having better sessions ready to use. The coaches section gives you session ideas, progressions and the detail behind the drill so your players actually improve.'
      ],
      primaryCta: 'Open Free Videos',
      primaryUrl: freeUrl,
      promoImage: 'https://jonerfootball.com/images/free-bundle/emails/session-plans-free-bundle.jpg',
      promoAlt: 'Session Plans Free Bundle for Joner Football coaches',
      promoUrl: coachSessionPlanUrl,
      upsellHeading: 'Coach better sessions',
      upsellText: 'Use the coaches section to plan cleaner sessions and give players better detail.',
      upsellCta: 'See Coaching Videos',
      upsellUrl: coachesUrl,
      secondary: [
        { label: 'More Free Bundles', url: freeExtrasUrl },
        { label: 'Team Subscriptions', url: teamUrl }
      ]
    }
  }

  if (roleSet.has('player')) {
    return {
      subject: 'Your free Joner training videos',
      preview: 'Free videos first, then a better plan for your technique.',
      heroImage: 'https://jonerfootball.com/images/free-bundle/emails/player-hero.jpg',
      heroAlt: 'Joner Football player training with the ball',
      eyebrow: 'Players free bundle',
      headline: 'Train with more detail',
      body: [
        'Your free Joner Football videos are ready.',
        'Use them to train with more detail today. Cleaner touches, better habits and a clearer idea of what to practise.',
        'Most players do extra work, but they do not always follow a plan. The player videos in the app give you that structure so your training actually builds week by week.'
      ],
      primaryCta: 'Open Free Videos',
      primaryUrl: freeUrl,
      promoImage: 'https://jonerfootball.com/images/free-bundle/emails/solo-training-free-bundle.jpg',
      promoAlt: 'Solo Training Pack Free Bundle for Joner Football players',
      promoUrl: soloTrainingPackUrl,
      upsellHeading: 'Build your training plan',
      upsellText: 'After the free videos, start the player section if you want a clearer path. Use the 100 Day Program and follow the work instead of guessing what to train next.',
      upsellCta: 'See Player Videos',
      upsellUrl: playerUrl,
      secondary: [
        { label: 'More Free Bundles', url: freeExtrasUrl }
      ]
    }
  }

  if (roleSet.has('parent')) {
    return {
      subject: 'Your free Joner videos are ready',
      preview: 'Free videos first, then a clearer way to help your player.',
      heroImage: 'https://jonerfootball.com/images/free-bundle/emails/parent-hero.jpg',
      heroAlt: 'Young footballer training at home with the ball',
      eyebrow: 'Parents free bundle',
      headline: 'Help them train properly',
      body: [
        'Your free Joner Football videos are ready.',
        'If you are helping a player at home, the goal is not more random drills. The goal is better structure, better habits and training they can repeat properly.',
        'The app helps you give them a clearer weekly plan, so they know what to practise and you are not just guessing from clips online.'
      ],
      primaryCta: 'Open Free Videos',
      primaryUrl: freeUrl,
      promoImage: 'https://jonerfootball.com/images/free-bundle/emails/cognitive-free-bundle.jpg',
      promoAlt: 'Cognitive Training Content Free Bundle for Joner Football parents',
      promoUrl: cognitiveBundleUrl,
      upsellHeading: 'Give them a clearer path',
      upsellText: 'After the free videos, use the app to keep their training organised. It is the easiest way to help your player improve away from team training.',
      upsellCta: 'See The App',
      upsellUrl: parentUrl,
      secondary: [
        { label: 'More Free Bundles', url: freeExtrasUrl },
        { label: 'Player Videos', url: playerUrl }
      ]
    }
  }

  return {
    subject: 'Your free Joner videos are ready',
    preview: 'Start with the free videos, then choose your training path.',
    heroImage: 'https://jonerfootball.com/images/free-bundle/check-your-email-desktop.webp',
    heroAlt: 'Joner Football free training videos',
    eyebrow: 'Joner free bundle',
    headline: 'Start with the free videos',
    body: [
      'Your free Joner Football videos are ready.',
      'Start with the free videos and get a feel for the way I coach technique, training detail and player development.',
      'If you want more after that, choose the path that fits you best and keep training with structure.'
    ],
    primaryCta: 'Open Free Videos',
    primaryUrl: freeUrl,
    upsellHeading: 'Choose your next step',
    upsellText: 'Players, parents and coaches all need a slightly different path. Pick the one that fits you and use Joner Football with more structure.',
    upsellCta: 'See The Full App',
    upsellUrl: parentUrl,
    secondary: [
      { label: 'More Free Bundles', url: freeExtrasUrl }
    ]
  }
}

function button(label, url, secondary = false) {
  const bg = secondary ? '#1E1E1E' : '#E8000D'
  const border = secondary ? '1px solid #333333' : '1px solid #E8000D'
  return `<a href="${url}" style="display:block;background:${bg};border:${border};color:#ffffff;text-decoration:none;text-transform:uppercase;font-family:Arial Black,Arial,sans-serif;font-size:${secondary ? '13px' : '16px'};letter-spacing:0.04em;text-align:center;padding:${secondary ? '14px 16px' : '18px 20px'};margin:10px 0;">${label}</a>`
}

async function sendFreeBundleEmail({ apiKey, email, firstName, body }) {
  const roles = parseRoles(body.roles)
  const copy = freeBundleEmailCopy(roles)
  const roleLabel = roles.length ? roles.join(', ') : 'fan'
  const html = `
    <div style="margin:0;padding:0;background:#111111;color:#ffffff;font-family:Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#111111;padding:0 0 28px;">
        <img src="${copy.heroImage}" alt="${copy.heroAlt}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0;">
        <div style="height:5px;background:#E8000D;margin-bottom:24px;"></div>
        <div style="padding:0 20px;">
        <p style="margin:0 0 12px;color:#E8000D;text-transform:uppercase;font-family:Arial Black,Arial,sans-serif;letter-spacing:0.14em;font-size:12px;">${copy.eyebrow}</p>
        <h1 style="margin:0 0 18px;color:#ffffff;text-transform:uppercase;font-family:Arial Black,Arial,sans-serif;font-size:38px;line-height:0.95;">${copy.headline}</h1>
        ${copy.body.map((paragraph) => `<p style="color:#CCCCCC;font-size:16px;line-height:1.55;margin:0 0 16px;">${paragraph}</p>`).join('')}
        ${button(copy.primaryCta, copy.primaryUrl)}
        ${copy.promoImage ? `<a href="${copy.promoUrl}" style="display:block;margin:16px 0 22px;text-decoration:none;"><img src="${copy.promoImage}" alt="${copy.promoAlt || ''}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;margin:0 auto;"></a>` : ''}
        <div style="background:#1E1E1E;border:1px solid #333333;margin:22px 0 14px;padding:18px 16px;">
          <p style="margin:0 0 8px;color:#E8000D;font-family:Arial Black,Arial,sans-serif;text-transform:uppercase;font-size:13px;letter-spacing:0.08em;">After the free videos</p>
          <h2 style="margin:0 0 10px;color:#ffffff;font-family:Arial Black,Arial,sans-serif;text-transform:uppercase;font-size:24px;line-height:1;">${copy.upsellHeading}</h2>
          <p style="color:#CCCCCC;font-size:15px;line-height:1.5;margin:0 0 14px;">${copy.upsellText}</p>
          ${button(copy.upsellCta, copy.upsellUrl, true)}
        </div>
        ${copy.secondary.length ? `<p style="color:#ffffff;font-family:Arial Black,Arial,sans-serif;text-transform:uppercase;font-size:15px;margin:22px 0 10px;">More options</p>${copy.secondary.map((item) => button(item.label, item.url, true)).join('')}` : ''}
        <p style="color:#CCCCCC;font-size:15px;line-height:1.55;margin:24px 0 0;">Keep training properly,<br>Lee</p>
        <p style="color:#777777;font-size:12px;line-height:1.5;margin:24px 0 0;">You got this because you asked for the free Joner Football videos. Role selected: ${roleLabel}.</p>
        </div>
      </div>
    </div>
  `

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: 'Lee Jones | Joner Football',
        email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com',
      },
      to: [{ email, name: firstName || 'Joner Football' }],
      subject: copy.subject,
      htmlContent: html,
      params: { preview: copy.preview }
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Free bundle email failed: ${response.status} ${text}`)
  }
}

async function sendSubscribeNotification({ source, email, firstName, body }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return

  if (source.startsWith('free-bundle')) {
    await sendFreeBundleEmail({ apiKey, email, firstName, body })
    return
  }

  if (source !== 'coaches-course-application') return
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
    if (!isValidUscreenWebhookSecret(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized webhook' })
    }

    let body
    try {
      body = parseUscreenBody(req.body)
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid webhook JSON' })
    }
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
      // This rewrite target is the live production webhook path, so it must
      // dead-letter failures exactly like api/uscreen-webhook.js does. If the
      // provider stops retrying, the payload still survives for replay.
      try {
        const { recordWebhookFailure } = await import('./_reliability-ledger.js')
        await recordWebhookFailure({
          event_id: cleanString(String(body.id || body.event_id || body.transaction_id || ''), 180) || `${eventType}:${Date.now()}`,
          payload: body,
          error: error?.message || String(error),
        })
      } catch (recordError) {
        console.error('Could not record webhook dead letter', recordError?.message || String(recordError))
      }
      console.error('Uscreen webhook processing failed after receipt', {
        event: eventType,
        id: cleanString(body.id || '', 80),
        offerId: Number(body.offer_id || body.subscription_id) || null,
        error: error?.message || String(error),
      })
      return res.status(503).json({ status: 'retry', event: eventType, processed: false, retryRequired: true })
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

    const source = cleanString(body.source || body.formName || 'website-form', 80)
    const isFreeBundleLead = source.startsWith('free-bundle')
    const firstName = cleanString(body.firstName || body.first_name || body.name || '', 80)
    if (!firstName && !isFreeBundleLead) return res.status(400).json({ success: false, error: 'Name is required.' })

    const listIds = enforceFreeBundleRoleLists(parseListIds(body), body)
    const isHubGate = source.startsWith('hub-gate')
    const marketingConsent = body.marketingConsent === true || body.marketingConsent === 'true' || body.marketingConsent === 'on'

    const validation = await validateEmailQuality(body.email, { strictRoleEmail: isHubGate })
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error })

    if (isHubGate && !marketingConsent) {
      return res.status(400).json({ success: false, error: 'Email opt-in is required to access the free Hub.' })
    }

    const attribution = extractAttribution(body)
    const metaIdentity = extractMetaIdentity(body)
    const trackingAttributes = {
      UTM_SOURCE: cleanString(attribution.utm_source || '', 180) || undefined,
      UTM_MEDIUM: cleanString(attribution.utm_medium || '', 180) || undefined,
      UTM_CAMPAIGN: cleanString(attribution.utm_campaign || '', 180) || undefined,
      UTM_CONTENT: cleanString(attribution.utm_content || '', 180) || undefined,
      UTM_TERM: cleanString(attribution.utm_term || '', 180) || undefined,
      UTM_ID: cleanString(attribution.utm_id || '', 180) || undefined,
      META_CAMPAIGN_ID: cleanString(attribution.campaign_id || '', 180) || undefined,
      META_ADSET_ID: cleanString(attribution.adset_id || '', 180) || undefined,
      META_AD_ID: cleanString(attribution.ad_id || '', 180) || undefined,
      UTM_PLACEMENT: cleanString(attribution.placement || '', 120) || undefined,
      META_FBC: cleanString(metaIdentity.fbc || '', 500) || undefined,
      META_FBP: cleanString(metaIdentity.fbp || '', 240) || undefined,
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
          WEBSITE_SOURCE: source,
          SOURCE: source,
          ...trackingAttributes
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

    if (body.jf_journey_id) {
      try {
        await linkJourneyIdentity(body.jf_journey_id, { email: validation.email })
      } catch (journeyError) {
        console.error('Journey email link failed (non-fatal):', journeyError?.message || String(journeyError))
      }
    }

    try {
      await sendSubscribeNotification({ source, email: validation.email, firstName, body })
    } catch (notifyError) {
      console.error('Subscribe notification failed:', notifyError)
      if (isFreeBundleLead) {
        return res.status(502).json({ success: false, error: 'Email captured, but the free bundle email could not send yet. Please click the videos button below.' })
      }
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Could not process that email.' })
  }
}
