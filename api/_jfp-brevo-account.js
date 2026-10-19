// A new JFP family account goes on a Brevo list for Joner news (Lee, 19 Oct 2026):
// a new family to "Sydney Database" (6), one already on the roster to
// "JFP current players" (18). Staff addresses never go on. It never blocks sign-in.
const NEW_LIST = Number(process.env.BREVO_JFP_NEW_ACCOUNT_LIST_ID || 6)
const FAMILY_LIST = Number(process.env.BREVO_JFP_FAMILY_ACCOUNT_LIST_ID || 18)

export function accountListIds({ email, known }) {
  const e = String(email || '').toLowerCase()
  if (!e.includes('@') || /@jonerfootball\.com$/.test(e)) return []
  return [known ? FAMILY_LIST : NEW_LIST]
}

export async function addAccountToBrevo({ email, known }, fetchImpl = fetch) {
  const listIds = accountListIds({ email, known })
  const key = process.env.BREVO_API_KEY
  if (!listIds.length || !key) return { ok: false, skipped: true }
  try {
    const r = await fetchImpl('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: String(email).toLowerCase(), listIds, updateEnabled: true }),
    })
    if (!r.ok) console.error('jfp account brevo failed', r.status)
    return { ok: r.ok, listIds }
  } catch (error) {
    console.error('jfp account brevo failed', error.message)
    return { ok: false, listIds }
  }
}
