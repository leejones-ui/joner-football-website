// Match to player (Lee and Ligia, 14 Oct 2026): a Stripe payment made on a
// link from outside the portal (a raw Stripe payment link, or one made in the
// Stripe dashboard) that Money could not put on a family. Staff match it to
// the player once, and it can be remembered: the next payment through that
// same payment link, or from that same email, is matched to the same player
// on its own by the Stripe sync, and never flagged on Telegram.
//
//   jfp:stripe-match        hash, payment id -> { id, rowIds, players, as, by, at, rule }
//   jfp:stripe-match-rules  hash, 'link:<plink_...>' or 'email:<address>' -> { rowIds, players, as, by, at, from }
//
// as: 'jfp' records it on the player's Term 4 row (term income, as before);
// 'extra' makes it a paid Extra sessions charge (never term income).
// Pure helpers and the store; jfp-portal-data.js does the recording.
import { kvCommand, clean, validEmail } from './_jfp-store.js'

export const MATCHES = 'jfp:stripe-match'
export const RULES = 'jfp:stripe-match-rules'
export const MATCH_AS = ['jfp', 'extra']
export const REMEMBER = ['link', 'email', '']

async function hashAll(k) {
  const flat = await kvCommand(['HGETALL', k]).catch(() => [])
  const out = {}
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]) } catch {} }
  return out
}
export const listMatches = () => hashAll(MATCHES)
export const listRules = () => hashAll(RULES)

// The rule keys a payment can be found by: its payment link first, then its email.
export function ruleKeys(p) {
  return [p?.linkId ? `link:${p.linkId}` : '', validEmail(p?.email || '') ? `email:${validEmail(p.email)}` : ''].filter(Boolean)
}
export function ruleFor(rules, p) {
  for (const k of ruleKeys(p)) if (rules[k]) return { key: k, ...rules[k] }
  return null
}
// The key staff asked to remember, or '' (nothing to remember).
export function rememberKey(p, how) {
  if (how === 'link') return p?.linkId ? `link:${p.linkId}` : ''
  if (how === 'email') return validEmail(p?.email || '') ? `email:${validEmail(p.email)}` : ''
  return ''
}
export function matchInput(body = {}) {
  const as = MATCH_AS.includes(body.as) ? body.as : 'jfp'
  const remember = REMEMBER.includes(body.remember) ? body.remember : ''
  const rowIds = [...new Set((Array.isArray(body.rowIds) ? body.rowIds : [body.rowId]).map((x) => clean(x, 30)).filter(Boolean))].slice(0, 6)
  return { paymentId: clean(body.paymentId, 120), as, remember, rowIds, label: clean(body.label, 120) }
}

export async function saveMatch(m) { await kvCommand(['HSET', MATCHES, m.id, JSON.stringify(m)]) }
export async function saveRule(k, r) { await kvCommand(['HSET', RULES, k, JSON.stringify(r)]) }
export async function dropRule(k) { await kvCommand(['HDEL', RULES, k]) }
// Never flagged on Telegram again (the sync sets the same key when it flags).
export async function silenceFlag(id) { await kvCommand(['SET', `jfp:stripe-flagged:${id}`, 'matched', 'EX', String(60 * 86400)]) }
