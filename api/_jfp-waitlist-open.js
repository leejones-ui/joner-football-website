// "A place has opened" (Lee, 18 Oct 2026: no auto offer, but tell the
// waitlist). Runs with the hourly check. For each group with a free place and
// families waiting:
// - Book now groups: email the families waiting longest, as many as there are
//   places. If the place is still free 48 hours later, the next ones. No hold,
//   no offer: the link opens the session and the first to book gets it.
// - Apply groups: nobody can book, so Lee and Ligia get a Telegram to answer
//   the waitlist in Requests.
// Texts: not sent. Every text needs a person to approve it (Messages), and
// texts are off until the HQ Mac relay is set up.
// config.waitlistAlerts === false turns it off.
//
//   jfp:wait-open   hash groupId -> JSON {openedAt, lastToldAt, staffToldAt}
import { kvCommand, listGroups, listApplications, saveApplication, onlineCounts, publicPlacesLeft, locationFor } from './_jfp-store.js'
import { airtableCounts } from './_jfp-airtable.js'
import { sendPlaceOpened } from './_jfp-email.js'
import { telegramAlert } from './_jfp-notify.js'

const KEY = 'jfp:wait-open'
export const NEXT_AFTER_MS = 48 * 3600 * 1000
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

// Pure: who to tell now. waiters oldest first; st is the group's state.
export function pickWaiters({ waiters, places, st, nowMs }) {
  if (places <= 0 || !waiters.length) return []
  const since = st?.openedAt || ''
  const untold = waiters.filter((r) => !(r.placeOpenTold || []).some((t) => t >= since && since))
  if (st?.lastToldAt && nowMs - Date.parse(st.lastToldAt) < NEXT_AFTER_MS) return []
  return untold.slice(0, places)
}

export async function waitlistTick(config, nowMs = Date.now(), { siteUrl = process.env.PUBLIC_SITE_URL || 'https://jonerfootball.com' } = {}) {
  if (config.waitlistAlerts === false) return { off: true }
  const waiting = (await listApplications()).filter((a) => a.kind === 'waitlist' && a.status === 'pending')
  const byGroup = new Map()
  for (const a of waiting) byGroup.set(a.groupId, [...(byGroup.get(a.groupId) || []), a])
  const out = { told: 0, groups: 0, staff: 0 }
  const stateRaw = (await kvCommand(['HGETALL', KEY])) || []
  const state = {}
  if (Array.isArray(stateRaw)) for (let i = 0; i + 1 < stateRaw.length; i += 2) state[stateRaw[i]] = parse(stateRaw[i + 1])
  const groups = (await listGroups()).filter((g) => byGroup.has(g.id) || state[g.id])
  if (!groups.length) return out
  const counts = (await airtableCounts()).counts
  const online = await onlineCounts(groups.map((g) => g.id), nowMs)
  const now = new Date(nowMs).toISOString()
  for (const g of groups) {
    const places = g.mode === 'closed' ? 0 : publicPlacesLeft(g, counts[g.id], online[g.id])
    let st = state[g.id]
    // Full again (or nobody waiting): forget, so the next opening starts fresh.
    if (places <= 0 || !byGroup.has(g.id)) { if (st) await kvCommand(['HDEL', KEY, g.id]); continue }
    if (!st) st = { openedAt: now }
    const waiters = byGroup.get(g.id).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    const where = `${g.day} ${g.time}, ${locationFor(config, g.location).name}`
    if (g.mode !== 'direct') {
      // Apply groups: tell staff once per opening.
      if (!st.staffToldAt) {
        await telegramAlert(`JFP: a place has opened in ${where} (${places} free). ${waiters.length} on the waitlist. Answer them in the portal: Requests.\n${siteUrl}/jfp-portal/#requests`)
        st.staffToldAt = now; out.staff++
      }
      await kvCommand(['HSET', KEY, g.id, JSON.stringify(st)])
      continue
    }
    const pick = pickWaiters({ waiters, places, st, nowMs })
    for (const r of pick) {
      const sent = await sendPlaceOpened({ request: r, group: g, config, url: `${siteUrl}/jfp-booking/?group=${encodeURIComponent(g.id)}` }).catch((error) => { console.error('jfp place opened email failed', r.id, error); return null })
      if (!sent) continue
      await saveApplication({ ...r, placeOpenTold: [...(r.placeOpenTold || []), now] })
      out.told++
    }
    if (pick.length) {
      st.lastToldAt = now
      out.groups++
      await telegramAlert(`JFP: a place has opened in ${where} (${places} free). Emailed ${pick.map((r) => r.parentName).join(', ')} from the waitlist. First to book gets it.`)
    }
    await kvCommand(['HSET', KEY, g.id, JSON.stringify(st)])
  }
  return out
}
