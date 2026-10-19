// New sessions to book (Lee, 19 Oct 2026). When a coach adds an extra session,
// or holiday training opens, the family sees a red number on Book extra
// sessions and Holiday training, and a pop up once when they next open My
// account. Opening the tab marks it seen (api/jfp-account.js, sessionsSeen).
import { esc, api, openSheet, closeSheet } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'

const KINDS = { extra: 'Book extra sessions', holiday: 'Holiday training' }
const after = (x, iso) => !iso || String(x.createdAt || '') > iso

export function newSessions(D) {
  const x = D?.extras
  if (!x || D.playerLogin) return { extra: [], holiday: [], n: 0 }
  const seen = x.seen || {}
  const extra = (x.bookable || []).filter((s) => s.placesLeft > 0 && after(s, seen.extra))
  const holiday = (x.holiday?.sessions || []).filter((s) => !s.full && after(s, seen.holiday))
  return { extra, holiday, n: extra.length + holiday.length }
}

// Opening the tab: seen from now. True when something changed.
export function markSeen(D, kind) {
  const list = newSessions(D)[kind]
  if (!list?.length) return false
  D.extras.seen = { ...(D.extras.seen || {}), [kind]: new Date().toISOString() }
  api('/api/jfp-account', { action: 'sessionsSeen', kind })
  return true
}

// Once per new set of sessions on this device, not on every visit.
const SHOWN = 'ja-new-sessions'
export function newSessionsPopup(D, go) {
  const n = newSessions(D)
  if (!n.n) return
  const sig = [...n.extra, ...n.holiday].map((s) => s.id).sort().join(',')
  try { if (localStorage.getItem(SHOWN) === sig) return; localStorage.setItem(SHOWN, sig) } catch {}
  const line = (s, extra) => `<li class="ja-row"><span class="ja-num">${ic(extra ? 'calplus' : 'sun')}</span><div><b>${esc(s.dateLabel)} · ${esc(s.time)}</b><small>${extra ? `${esc(s.location || '')}${s.durationMin ? ` · ${esc(String(s.durationMin))} min` : ''}` : esc(s.typeLabel || 'Holiday session')}</small></div></li>`
  const block = (kind, list) => list.length ? `<p class="ja-kicker" style="margin-top:6px"><i></i>${esc(KINDS[kind])}</p><ul class="ja-list" style="margin:6px 0 12px">${list.slice(0, 4).map((s) => line(s, kind === 'extra')).join('')}</ul>${list.length > 4 ? `<p class="ja-small ja-muted" style="margin:-6px 0 12px">and ${list.length - 4} more</p>` : ''}` : ''
  const sheet = openSheet({ title: n.n === 1 ? 'A new session to book' : 'New sessions to book', subtitle: 'Just added by Joner Football' })
  sheet.body.innerHTML = `${block('extra', n.extra)}${block('holiday', n.holiday)}`
  const first = n.extra.length ? 'extra' : 'holidays'
  sheet.foot.innerHTML = `<button type="button" class="ja-btn ja-btn-line" data-nsx="later">Later</button><button type="button" class="ja-btn ja-btn-red" data-nsx="go">See ${n.extra.length && n.holiday.length ? 'extra sessions' : n.extra.length ? (n.extra.length === 1 ? 'the session' : 'the sessions') : 'holiday training'}</button>`
  sheet.foot.querySelector('[data-nsx="later"]').addEventListener('click', () => closeSheet())
  sheet.foot.querySelector('[data-nsx="go"]').addEventListener('click', () => { closeSheet(); go(first) })
}
