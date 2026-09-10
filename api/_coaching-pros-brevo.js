export const COACHING_PROS_LIST_NAME = 'Dribbling YT video leads'
export const NEWS_OPT_IN_ATTRIBUTE = 'NEWS_OPT_IN'

const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts'

export function normalizeLeadEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email || email.length > 200) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null
  return email
}

export function parseBrevoListId(value) {
  const listId = Number(value)
  return Number.isInteger(listId) && listId > 0 ? listId : null
}

export function isEligibleForMarketing(contact) {
  if (!contact) return true
  if (contact.emailBlacklisted === true) return false
  if (contact.attributes?.[NEWS_OPT_IN_ATTRIBUTE] === false) return false
  return true
}

function headers(apiKey) {
  return {
    accept: 'application/json',
    'api-key': apiKey,
    'content-type': 'application/json',
  }
}

async function readJson(response) {
  return response.json().catch(() => ({}))
}

async function getContact(email, apiKey, fetchImpl) {
  const response = await fetchImpl(`${BREVO_CONTACTS_URL}/${encodeURIComponent(email)}`, {
    method: 'GET',
    headers: headers(apiKey),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    const body = await readJson(response)
    throw new Error(`Brevo contact lookup failed (${response.status}): ${body.message || 'unknown error'}`)
  }
  return readJson(response)
}

async function updateExistingContact(contact, email, listId, apiKey, fetchImpl) {
  if (!isEligibleForMarketing(contact)) {
    return { success: true, saved: false, marketing: false, reason: 'existing-opt-out-preserved' }
  }

  const currentLists = Array.isArray(contact.listIds) ? contact.listIds.map(Number) : []
  const alreadyInList = currentLists.includes(listId)
  const alreadyOptedIn = contact.attributes?.[NEWS_OPT_IN_ATTRIBUTE] === true

  if (alreadyInList && alreadyOptedIn) {
    return { success: true, saved: false, marketing: true, reason: 'already-subscribed' }
  }

  const body = { attributes: { [NEWS_OPT_IN_ATTRIBUTE]: true } }
  if (!alreadyInList) body.listIds = [listId]

  const response = await fetchImpl(`${BREVO_CONTACTS_URL}/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const responseBody = await readJson(response)
    throw new Error(`Brevo contact update failed (${response.status}): ${responseBody.message || 'unknown error'}`)
  }

  return { success: true, saved: true, marketing: true, reason: 'updated' }
}

export async function syncCoachingProsLead({
  email,
  marketingConsent,
  listId,
  apiKey,
  fetchImpl = fetch,
}) {
  const normalizedEmail = normalizeLeadEmail(email)
  if (!normalizedEmail) throw new TypeError('A valid email is required.')

  // Access to the free episode is never conditional on marketing consent.
  // Without affirmative consent, do not create or update a Brevo contact.
  if (marketingConsent !== true) {
    return { success: true, saved: false, marketing: false, reason: 'no-marketing-consent' }
  }

  const validListId = parseBrevoListId(listId)
  if (!apiKey || !validListId) throw new Error('Coaching Pros Brevo integration is not configured.')

  const existing = await getContact(normalizedEmail, apiKey, fetchImpl)
  if (existing) {
    return updateExistingContact(existing, normalizedEmail, validListId, apiKey, fetchImpl)
  }

  const response = await fetchImpl(BREVO_CONTACTS_URL, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      email: normalizedEmail,
      attributes: { [NEWS_OPT_IN_ATTRIBUTE]: true },
      listIds: [validListId],
      updateEnabled: false,
    }),
  })

  if (response.ok) {
    return { success: true, saved: true, marketing: true, reason: 'created' }
  }

  // A concurrent request may have created the contact between GET and POST.
  // Re-read once, then apply the same opt-out-preserving update rules.
  if (response.status === 400 || response.status === 409) {
    const racedContact = await getContact(normalizedEmail, apiKey, fetchImpl)
    if (racedContact) {
      return updateExistingContact(racedContact, normalizedEmail, validListId, apiKey, fetchImpl)
    }
  }

  const body = await readJson(response)
  throw new Error(`Brevo contact creation failed (${response.status}): ${body.message || 'unknown error'}`)
}
