// See a family's account (Lee, 27 Oct 2026): "is there a way in the super
// admin we can impersonate someone? So we can just check their account."
// Lee or Ligia opens My account exactly as one family sees it, VIEW ONLY:
// nothing they press can change, pay, sign, send or mark anything read, and
// the family's own sign in is not touched. Each pass is tied to the admin's
// own staff session (checked on every request), lasts 30 minutes, and is
// written to the audit log.
//   jfp:viewas:<token>  JSON {by, email, rowId, player, at}  EX 1800
// The pass travels in the x-jfp-viewas header from one tab only.
import crypto from 'node:crypto'
import { kvCommand, audit } from './_jfp-store.js'
import { sessionFor } from './_jfp-people.js'

export const VIEW_COOKIE = 'jfp_viewas'
const SECONDS = 1800
const key = (t) => `jfp:viewas:${t}`
// Read only actions My account may run while viewing. overview is the
// default (no action). Anything else is refused.
export const VIEW_READ = new Set(['overview', 'fees', 'profiles', 'reports', 'reportPdf', 'receiptPdf', 'invoicePdf', 'appAccessState'])
// "Seen" stamps the page sends on its own: answered without writing, so the
// family still sees their new notes, reports and announcements as new.
export const VIEW_QUIET = new Set(['noteRead', 'announceRead', 'reportRead', 'sessionsSeen', 'pushState'])

// The first version (59f5292) used a browser-wide cookie; this clears it.
export const viewCookie = (token, maxAge = SECONDS) => `${VIEW_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`

export async function startViewAs({ by, email, rowId = '', player = '' }) {
  const token = crypto.randomBytes(32).toString('hex')
  const rec = { by, email: String(email).toLowerCase(), rowId, player, at: new Date().toISOString() }
  await kvCommand(['SET', key(token), JSON.stringify(rec), 'EX', String(SECONDS)])
  await audit({ by, action: 'account.viewAs', target: rowId || rec.email, after: { email: rec.email, player } })
  return { token, seconds: SECONDS }
}

// The pass on this request, or null. Only while the same admin is still
// signed in to the portal: signing out of the portal ends it too.
export async function viewAsFor(req, config) {
  // The tab that opened the view sends its pass as a header (jfp-common.js),
  // so other tabs in the same browser are never turned into the family.
  const token = String(req.headers?.['x-jfp-viewas'] || '')
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const raw = await kvCommand(['GET', key(token)])
  if (!raw) return null
  let rec
  try { rec = JSON.parse(raw) } catch { return null }
  const staff = await sessionFor(req, 'staff')
  if (!staff || staff.email.toLowerCase() !== String(rec.by).toLowerCase() || !(config.superAdmins || []).includes(staff.email.toLowerCase())) return null
  return { ...rec, token }
}

export async function endViewAs(req) {
  const token = String(req.headers?.['x-jfp-viewas'] || '')
  if (/^[a-f0-9]{64}$/.test(token)) await kvCommand(['DEL', key(token)])
}
