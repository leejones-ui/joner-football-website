// Email JFP families when a coach opens a public extra session (Lee, 19 Oct
// 2026). Only families with a player holding a Term 4 place get it, never Do
// Not Contact, never a coach's name or a price.
//
// OFF until Lee says yes to the wording: config.extraAnnounce must be true.
// While it is off, each new public session is still written down here as
// "held" (who it would have gone to), so Lee and Ligia can see it in the
// portal and Lee can read the exact email before he switches it on.
import { kvCommand, clean, newId, dateLabel, audit, saveConfig, rowEmails } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { doNotContact, sendEmailExact } from './_jfp-messages.js'
import { esc } from './_jfp-email.js'

const KEY = 'jfp:extra-announce'
const KEEP = 60
// One of these emails per family in this many hours, so a coach adding three
// sessions one after another does not send three emails.
export const COOLDOWN_HOURS = 6
const SITE = 'https://jonerfootball.com'

const first = (name) => String(name || '').trim().split(/\s+/)[0] || ''

// The families: one row per email, with their JFP player names.
export async function announceRecipients() {
  const [roster, dnc] = await Promise.all([loadRoster(), doNotContact().catch(() => null)])
  if (!dnc) throw new Error('Could not read Do Not Contact, so nothing was sent.')
  const by = new Map()
  for (const r of roster.players) {
    if (!r.holdsPlace || /test/i.test(r.player || '')) continue
    for (const email of rowEmails(r)) {
      const e = String(email || '').toLowerCase().trim()
      if (!e.includes('@') || dnc.has(e, '')) continue
      const f = by.get(e) || { email: e, parentName: r.parent || '', players: [] }
      if (r.player && !f.players.includes(r.player)) f.players.push(r.player)
      by.set(e, f)
    }
  }
  return [...by.values()]
}

// The exact email. slots: the coach's sessions (date, time, location, durationMin, title).
export function announceEmail({ slots, parentName = '', players = [] }) {
  const one = slots.length === 1
  const subject = one ? 'A new extra session to book' : `${slots.length} new extra sessions to book`
  const hi = first(parentName) ? `Hi ${esc(first(parentName))},` : 'Hi,'
  const rows = slots.map((s) => `<tr><td style="padding:10px 0;border-bottom:1px solid #F0F1F3;font-size:15px;color:#111827;"><b>${esc(dateLabel(s.date))}, ${esc(s.time)}</b><br><span style="color:#6B7280;font-size:13px;">${esc(s.title || 'Extra session')} · ${esc(String(s.durationMin || 60))} min · ${esc(s.location)}</span></td></tr>`).join('')
  const who = players.length ? `${players.map(esc).join(' and ')} ${players.length > 1 ? 'are' : 'is'} in Joner Football Performance this term, so you hear first.` : 'You are a Joner Football Performance family this term, so you hear first.'
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 6px 14px;font-size:13px;font-weight:700;letter-spacing:.4px;color:#6B7280;">JONER FOOTBALL PERFORMANCE</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:30px 26px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#111827;">${esc(subject)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${hi}</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${one ? 'A coach has just opened an extra session for JFP players.' : 'Our coaches have just opened extra sessions for JFP players.'} Places are limited, so book soon if you would like one.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid #F0F1F3;">${rows}</table>
<p style="margin:20px 0 8px;"><a href="${SITE}/jfp-account/#extra" style="background:#111827;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:10px;display:inline-block;">Book in My account</a></p>
<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#6B7280;">${who} Questions? Reply to this email.</p>
</td></tr>
<tr><td style="padding:16px 6px;font-size:12px;line-height:1.6;color:#6B7280;">Joner Football, 20 Narabang Way (Unit 2), Belrose NSW 2085.</td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}

const pick = (s) => ({ id: s.id, date: s.date, time: s.time, location: s.location, durationMin: s.durationMin, title: s.title || '' })

async function save(rec) {
  await kvCommand(['LPUSH', KEY, JSON.stringify(rec)])
  await kvCommand(['LTRIM', KEY, '0', String(KEEP - 1)])
}
export async function listAnnounces() {
  return ((await kvCommand(['LRANGE', KEY, '0', String(KEEP - 1)])) || []).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean)
}

// Called when public sessions are opened. Off: written down as held. On: sent.
export async function queueAnnounce(config, slots, { send = sendEmailExact, nowMs = Date.now() } = {}) {
  const list = slots.map(pick)
  if (config.extraAnnounce !== true) {
    await save({ id: newId('XA'), at: new Date(nowMs).toISOString(), status: 'held', slots: list })
    return { status: 'held' }
  }
  const families = await announceRecipients()
  let sent = 0, skipped = 0, failed = 0
  for (const f of families) {
    // The cooldown is claimed before the send, so a retry never sends twice.
    const fresh = await kvCommand(['SET', `jfp:extra-announce-sent:${f.email}`, '1', 'NX', 'EX', String(COOLDOWN_HOURS * 3600)])
    if (fresh !== 'OK') { skipped += 1; continue }
    const { subject, html } = announceEmail({ slots: list, parentName: f.parentName, players: f.players })
    try { await send({ to: f.email, name: f.parentName, subject, html, kind: 'extra-announce' }); sent += 1 } catch (e) { failed += 1; console.error('jfp extra announce send failed', e.message) }
  }
  await save({ id: newId('XA'), at: new Date(nowMs).toISOString(), status: 'sent', slots: list, sent, skipped, failed })
  return { status: 'sent', sent, skipped, failed }
}

// Lee and Ligia: the switch, and a preview of the exact email.
export async function announceSettings({ config, principal, body }) {
  if (typeof body.on === 'boolean') {
    await saveConfig({ extraAnnounce: body.on })
    await audit({ by: principal.email, action: 'extra.announce', target: 'config', after: { on: body.on } })
    config = { ...config, extraAnnounce: body.on }
  }
  const sample = [{ date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), time: '4:30pm', location: 'Belrose HQ', durationMin: 60, title: 'Extra 1 on 1' }]
  const families = await announceRecipients().catch(() => null)
  return {
    on: config.extraAnnounce === true,
    families: families ? families.length : null,
    cooldownHours: COOLDOWN_HOURS,
    preview: announceEmail({ slots: sample, parentName: 'Jordan Example', players: ['Alex Example'] }),
    history: (await listAnnounces()).slice(0, 15),
  }
}

export { clean }
