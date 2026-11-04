import { cleanEmail, cleanString, rateLimit } from './_security.js'

// ManyChat DM leads -> Brevo. The ManyChat rule "Email changed" posts its
// Full Contact Data (or just subscriber_id); only the id is trusted: the email is read back from the ManyChat API, so a forged
// call can only sync a real subscriber who already gave us their email.
// Lists per Lee (4 Nov 2026): 2 Hot APP Leads + 66 Newsletter. Never 18.
const LEAD_LISTS = [2, 66]
const SYNCED_TAG = 'brevo_synced'

function json(res, status, body) { return res.status(status).json(body) }
function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }

async function manychat(path, init = {}) {
  const response = await fetch(`https://api.manychat.com${path}`, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${process.env.MANYCHAT_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.status !== 'success') throw new Error(`manychat_${response.status}`)
  return data.data
}

async function brevo(method, path, body) {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    method,
    signal: AbortSignal.timeout(8000),
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = {} }
  return { ok: response.ok, status: response.status, data }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { success: false, error: 'Method not allowed' })
  }
  if (!process.env.MANYCHAT_API_KEY || !process.env.BREVO_API_KEY) return json(res, 500, { success: false, error: 'Not configured' })
  // ManyChat calls come from a few shared IPs, so the per-IP limit is generous.
  const limited = rateLimit(req, { key: 'manychat-lead', limit: 120, windowMs: 60_000 })
  if (!limited.allowed) return json(res, 429, { success: false, error: limited.error })

  try {
    const body = parse(req)
    const subscriberId = cleanString(body.subscriber_id || body.id || req.query?.subscriber_id || '', 30)
    if (!/^\d{3,30}$/.test(subscriberId)) return json(res, 400, { success: false, error: 'subscriber_id required' })

    const subscriber = await manychat(`/fb/subscriber/getInfo?subscriber_id=${subscriberId}`)
    const channel = body.channel ? cleanString(body.channel, 20).toLowerCase().replace(/[^a-z]/g, '') : (subscriber.ig_id ? 'instagram' : 'facebook')
    const source = `manychat-${channel || 'instagram'}-dm`
    const email = cleanEmail(subscriber.email || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 200, { success: true, synced: false, reason: 'no_email' })
    const firstName = cleanString(subscriber.first_name || '', 80)

    // New contact: create with the DM source. Existing contact: only add the
    // lists, so their original SOURCE and other attributes stay untouched.
    let result = await brevo('POST', '/contacts', {
      email,
      listIds: LEAD_LISTS,
      attributes: { ...(firstName ? { FIRSTNAME: firstName } : {}), SOURCE: source, WEBSITE_SOURCE: source },
    })
    let created = result.ok
    if (!result.ok && result.data?.code === 'duplicate_parameter') {
      for (const listId of LEAD_LISTS) {
        const added = await brevo('POST', `/contacts/lists/${listId}/contacts/add`, { emails: [email] })
        // Brevo answers 400 when the contact is already on the list.
        if (!added.ok && added.status !== 400) throw new Error(`brevo_list_${added.status}`)
      }
      result = { ok: true }
    }
    if (!result.ok) throw new Error(`brevo_${result.status}`)

    try {
      await manychat('/fb/subscriber/addTagByName', { method: 'POST', body: JSON.stringify({ subscriber_id: Number(subscriberId), tag_name: SYNCED_TAG }) })
    } catch (tagError) {
      console.error('ManyChat synced tag failed (non-fatal):', tagError?.message || String(tagError))
    }

    console.info('ManyChat lead synced to Brevo', { subscriberId, source, created })
    return json(res, 200, { success: true, synced: true, created })
  } catch (error) {
    console.error('ManyChat lead sync failed', error?.message || String(error))
    return json(res, 502, { success: false, error: 'Sync failed' })
  }
}
