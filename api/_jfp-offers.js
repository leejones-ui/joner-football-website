// Offers from applications and the waitlist hold a place in Airtable (as
// Awaiting Reply) for 7 days. After that, or when staff cancel the offer,
// the place goes back. The sweep runs hourly (Vercel cron) and when staff open
// the portal; a parent loading the timetable never triggers it.
import { listPayreqs, savePayreq, getApplication, saveApplication, audit, closeCheckout, kvCommand } from './_jfp-store.js'
import { getTerm4Row, updateTerm4Rows, appendNote } from './_jfp-airtable.js'

export async function releaseOffer(q, principal, why) {
  let n = 0
  const updates = []
  for (const id of q.term4Ids) {
    const row = await getTerm4Row(id)
    if (!row || row.confirmation !== 'Awaiting Reply' || !row.adminAddId || row.paymentStatus === 'Paid') continue
    updates.push({ id, fields: { 'Term 4 Confirmation': 'Dropped', 'Term 4 Notes': appendNote(row.notes, `${why}, place released (${principal.name}).`) } })
    n += 1
  }
  if (updates.length) await updateTerm4Rows(updates)
  if (q.requestId) { const r = await getApplication(q.requestId); if (r && r.status === 'offered') await saveApplication({ ...r, status: 'expired', expiredAt: new Date().toISOString() }) }
  return n
}

export async function sweepExpiredOffers(principal = { email: 'system' }) {
  const now = Date.now()
  for (const q of await listPayreqs()) {
    if (!['open', 'checkout'].includes(q.status) || !q.expiresAt || Date.parse(q.expiresAt) > now || !['application', 'waitlist', 'trial'].includes(q.reason)) continue
    const closed = q.status === 'checkout' ? await closeCheckout(q.stripeSessionId) : 'expired'
    if (closed !== 'expired') continue
    await savePayreq({ ...q, status: 'expired', expiredAt: new Date().toISOString() })
    const released = await releaseOffer(q, { name: 'the portal (7 days passed)' }, 'Offer not paid within 7 days')
    await audit({ by: 'system', action: 'offer.expired', target: q.id, after: { released, seenBy: principal.email } })
  }
}

