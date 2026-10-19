// The JFP side of Uscreen (the JF App's shop). Two things only:
//  1. Put a JFP family's email in the Uscreen group (team) called "JFP", which
//     gives PLUS annual access free (Lee, 19 Oct 2026). Nothing else in Uscreen
//     is changed from here: no offers, no charges, no subscriptions.
//  2. Read the app's video list so coaches can search it on Session ideas.
// Publisher API: https://uscreen.io/api/publisher.yml (Bearer USCREEN_API_KEY).
import { kvCommand } from './_jfp-store.js'

const API = 'https://www.uscreen.io/publisher_api/v1'
const GROUP_NAME = /^jfp$/i
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

async function call(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const key = process.env.USCREEN_API_KEY
  if (!key) throw Object.assign(new Error('Uscreen is not connected'), { code: 'no-key' })
  const r = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined,
  })
  const text = await r.text()
  return { status: r.status, ok: r.ok, data: parse(text), text: text.slice(0, 400), total: Number(r.headers.get('total-count')) || 0 }
}

// The "JFP" group. Looked up by name each time (it is one or two pages), so a
// renamed or recreated group is picked up without a code change.
export async function findJfpGroup(opts = {}) {
  for (let page = 1; page <= 5; page += 1) {
    const r = await call(`/groups?page=${page}`, opts)
    if (!r.ok) throw Object.assign(new Error(`Uscreen groups ${r.status}`), { code: 'groups' })
    const list = Array.isArray(r.data) ? r.data : []
    const hit = list.find((g) => GROUP_NAME.test(String(g.name || '').trim()))
    if (hit) return { id: hit.id, name: hit.name, plan: hit.plan_title || '', seats: hit.number_of_seats ?? null, used: hit.used_seats ?? null, status: hit.status || '' }
    if (!list.length) break
  }
  return null
}

// Add one email to the JFP group. Uscreen makes the app account if there is
// none, and the member signs in with that email. Returns { ok, already?, reason? }.
export async function addToJfpGroup({ email, name }, opts = {}) {
  const group = await findJfpGroup(opts)
  if (!group) return { ok: false, reason: 'no-group' }
  if (group.status && group.status !== 'active') return { ok: false, reason: `group-${group.status}`, group }
  const r = await call(`/groups/${group.id}/members`, { ...opts, method: 'POST', body: { email, name: name || email.split('@')[0], role: 'member', skip_automations: true } })
  if (r.ok) return { ok: true, group, memberId: r.data?.id || null }
  const said = JSON.stringify(r.data || r.text).toLowerCase()
  if (r.status === 422 && /already|taken|exists|member/.test(said)) return { ok: true, already: true, group }
  if (r.status === 422 && /seat/.test(said)) return { ok: false, reason: 'no-seats', group }
  return { ok: false, reason: `uscreen-${r.status}`, detail: said.slice(0, 200), group }
}

// The app's videos for Session ideas. Cached 12 hours in KV; a failed refresh
// keeps the last good copy. Only titles, short text, images and links.
const CATALOG_KEY = 'jfp:app-catalog'
const APP = 'https://app.jonerfootball.com'
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
export function slimContent(c) {
  return {
    id: c.id,
    title: strip(c.title).slice(0, 160),
    text: strip(c.short_description || c.meta_description || c.description).slice(0, 260),
    min: c.duration ? Math.max(1, Math.round(Number(c.duration) / 60)) : null,
    img: c.main_poster_url || c.secondary_poster_url || c.square_poster_url || '',
    cats: (c.categories || []).map((x) => strip(x.title || x.name)).filter(Boolean).slice(0, 6),
    tags: (c.tags || []).map((t) => strip(typeof t === 'string' ? t : t?.name)).filter(Boolean).slice(0, 10),
    free: c.free === true,
    url: c.permalink ? `${APP}/programs/${encodeURIComponent(c.permalink)}` : APP,
    at: Number(c.published_at || c.created_at) || null,
  }
}
export async function appCatalog({ refresh = false, fetchImpl } = {}) {
  const cached = parse(await kvCommand(['GET', CATALOG_KEY]))
  const fresh = cached && Date.now() - Date.parse(cached.at) < 12 * 3600 * 1000
  if (cached && fresh && !refresh) return cached
  const lock = await kvCommand(['SET', `${CATALOG_KEY}:lock`, '1', 'NX', 'EX', '120'])
  if (lock !== 'OK') return cached || { at: null, videos: [] }
  try {
    const videos = []
    const started = Date.now()
    for (let page = 1; page <= 80 && Date.now() - started < 25000; page += 1) {
      const r = await call(`/contents?content_type=video&page=${page}&per_page=100`, { fetchImpl })
      if (!r.ok) throw new Error(`Uscreen contents ${r.status}`)
      const list = Array.isArray(r.data) ? r.data : []
      // Only what members can see: published, not scheduled or hidden.
      videos.push(...list.filter((c) => !c.release_stage || c.release_stage === 'published').map(slimContent))
      if (!list.length || (r.total && page * list.length >= r.total)) break
    }
    const out = { at: new Date().toISOString(), videos }
    if (videos.length) await kvCommand(['SET', CATALOG_KEY, JSON.stringify(out)])
    return videos.length ? out : (cached || out)
  } catch (e) {
    console.error('jfp app catalog refresh failed', e.message)
    return cached || { at: null, videos: [], error: true }
  } finally {
    await kvCommand(['DEL', `${CATALOG_KEY}:lock`]).catch(() => {})
  }
}
