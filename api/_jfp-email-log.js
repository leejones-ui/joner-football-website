// Every JFP email we try to send, sent or not (Lee, 13 Oct 2026: "my biggest
// worry is making sure these emails reach the players and parents").
//
// KV list jfp:email-log, newest first, the last LOG_MAX sends. One entry:
//   { id, at, to: [emails], subject, kind, status: 'sent' | 'failed',
//     messageId (Brevo's id when it gave one), error (why it failed) }
// No email bodies, no names: the subject and the address are enough to find
// it in Brevo. The player drawer shows the entries for that player's email.
import { kvCommand, newId } from './_jfp-store.js'

export const EMAIL_LOG = 'jfp:email-log'
export const LOG_MAX = 3000

export async function logEmail({ to = [], subject = '', kind = '', status, messageId = '', error = '' }) {
  const entry = {
    id: newId('EM'), at: new Date().toISOString(),
    to: (Array.isArray(to) ? to : [to]).map((t) => String(t?.email ?? t ?? '').trim().toLowerCase()).filter(Boolean),
    subject: String(subject || '').slice(0, 200), kind: String(kind || '').slice(0, 40), status,
    ...(messageId ? { messageId: String(messageId).slice(0, 120) } : {}),
    ...(error ? { error: String(error).slice(0, 240) } : {}),
  }
  // A log that cannot be written never stops the email itself.
  try {
    await kvCommand(['LPUSH', EMAIL_LOG, JSON.stringify(entry)])
    await kvCommand(['LTRIM', EMAIL_LOG, '0', String(LOG_MAX - 1)])
  } catch (e) { console.error('jfp email log write failed', e?.message || e) }
  return entry
}

// The entries for these addresses, newest first.
export async function emailsTo(addresses, { limit = 20 } = {}) {
  const want = new Set((addresses || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
  if (!want.size) return []
  let raw = []
  try { raw = (await kvCommand(['LRANGE', EMAIL_LOG, '0', String(LOG_MAX - 1)])) || [] } catch (e) { console.error('jfp email log read failed', e?.message || e); return null }
  const out = []
  for (const x of raw) {
    let e
    try { e = JSON.parse(x) } catch { continue }
    if ((e.to || []).some((t) => want.has(t))) out.push(e)
    if (out.length >= limit) break
  }
  return out
}

// The words staff see for an email error, so "it did nothing" never happens.
export function emailErrorText(error) {
  const m = String(error?.message || error || '')
  if (/BREVO_API_KEY/.test(m)) return 'Email is not set up on the server (no Brevo key).'
  if (/No email address/.test(m)) return 'There is no email address to send to.'
  if (/Brevo 4\d\d/.test(m)) return `Brevo refused it: ${m.replace(/^Brevo \d+:\s*/, '').slice(0, 140)}`
  if (/Brevo 5\d\d/.test(m)) return 'Brevo had a problem. It may not have gone: check the Emails list on the player before sending again.'
  return `It did not send: ${m.slice(0, 140) || 'unknown error'}`
}
