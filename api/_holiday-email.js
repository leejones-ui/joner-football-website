// Confirmation email, Lee's alert and the roster sheet row for a paid holiday
// booking. Same Brevo and Sheets plumbing as camps, holiday-specific copy.
import { appendRow, readRows, ensureSheetTab, sheetsFetch, DEFAULT_SHEET_ID } from './_camp-automation.js'
import { formatAud, sydneyDateLabel, sydneyTimeLabel, TYPE_LABELS, CANCELLATION_POLICY, listBookings, listSlots, getConfig, coachById } from './_holiday-store.js'

export const HOLIDAY_SHEET = 'Holiday Bookings'
// Coaches read this tab to see who is coming, so it carries no money and no
// Stripe ids. Revenue lives in the admin Bookings tab and in Stripe.
export const HOLIDAY_HEADERS = [
  'Updated At', 'Status', 'Date', 'Start', 'End', 'Coach', 'Session Type', 'Players', 'Player Ages',
  'Parent Name', 'Mobile', 'Email', 'Notes', 'Location', 'Booking ID', 'Needs Attention',
]

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function sydneyDateTime(iso) {
  return `${sydneyDateLabel(iso)}, ${sydneyTimeLabel(iso)}`
}

function shell({ preheader, heading, children }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;margin:0;padding:0;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#111111;border:1px solid #252525;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:32px 26px 10px;">
            <p style="margin:0 0 10px;color:#e8000d;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:1.8px;text-transform:uppercase;">Joner Football School Holiday Sessions</p>
            <h1 style="margin:0 0 18px;color:#ffffff;font-size:30px;line-height:1.08;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;">${escapeHtml(heading)}</h1>
          </td></tr>
          ${children}
          <tr><td style="padding:26px;background:#0b0b0b;border-top:1px solid #252525;">
            <p style="margin:0 0 4px;color:#ffffff;font-size:15px;line-height:1.6;font-weight:800;">Lee Jones</p>
            <p style="margin:0;color:#bdbdbd;font-size:14px;line-height:1.6;">Joner Football</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function detailRows(rows) {
  return rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #252525;color:#9a9a9a;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #252525;color:#ffffff;font-size:16px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join('')
}

export function renderHolidayConfirmationEmail({ booking, slot, coachName }) {
  const players = (booking.players || []).map((p) => p.name).join(', ')
  const typeLabel = TYPE_LABELS[booking.type] || TYPE_LABELS[slot.type] || slot.type
  const subject = `Booked: Coach ${coachName} on ${sydneyDateLabel(slot.startsAt)} at ${sydneyTimeLabel(slot.startsAt)}`
  const children = `
    <tr><td style="padding:0 26px 8px;">
      <p style="margin:0 0 18px;color:#e6e6e6;font-size:16px;line-height:1.6;">Payment received. ${escapeHtml(players)} ${booking.players.length > 1 ? 'are' : 'is'} booked in with Coach ${escapeHtml(coachName)}. Here are the details.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${detailRows([
          ['When', `${sydneyDateTime(slot.startsAt)} to ${sydneyTimeLabel(slot.endsAt)}`],
          ['Where', slot.location],
          ['Session', `${typeLabel} with Coach ${coachName}`],
          ['Players', players],
          ['Paid', formatAud(booking.priceCents)],
          ['Booking ID', booking.id],
        ])}
      </table>
    </td></tr>
    <tr><td style="padding:18px 26px 26px;">
      <p style="margin:0 0 10px;color:#ffffff;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Before you arrive</p>
      <p style="margin:0 0 8px;color:#e6e6e6;font-size:15px;line-height:1.6;">Arrive 10 minutes early. Bring boots, shin pads, a full water bottle and a ball if you have one.</p>
      <p style="margin:0 0 8px;color:#e6e6e6;font-size:15px;line-height:1.6;">Need to change or cancel? Reply to this email as soon as you can.</p>
      <p style="margin:0 0 8px;color:#e6e6e6;font-size:15px;line-height:1.6;"><strong style="color:#ffffff;">Cancellation policy:</strong> ${escapeHtml(CANCELLATION_POLICY)}</p>
    </td></tr>`
  return { subject, html: shell({ preheader: subject, heading: 'Your Session Is Booked.', children }) }
}

async function brevoSend({ toEmail, toName, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const senderName = process.env.HOLIDAY_EMAIL_SENDER_NAME || 'Joner Football'
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: toName || toEmail }],
      replyTo: { email: replyTo || process.env.HOLIDAY_REPLY_TO_EMAIL || senderEmail, name: 'Joner Football' },
      subject,
      htmlContent: html,
    }),
  })
  if (!response.ok) throw new Error((await response.text()) || 'Holiday email failed.')
  return { success: true, subject }
}

export async function sendHolidayConfirmationEmail({ booking, slot, coachName }) {
  const rendered = renderHolidayConfirmationEmail({ booking, slot, coachName })
  return brevoSend({ toEmail: booking.email, toName: booking.parentName, ...rendered })
}

export async function sendHolidayAdminAlert({ booking, slot, coachName }) {
  const to = process.env.HOLIDAY_ADMIN_EMAIL || process.env.CAMP_SIGNUP_EMAIL || 'leejones@jonerfootball.com'
  const players = (booking.players || []).map((p) => `${p.name} (${p.age})`).join(', ')
  const attention = booking.needsAttention ? `<p style="margin:0 0 12px;color:#e8000d;font-size:16px;font-weight:900;">NEEDS ATTENTION: ${escapeHtml(booking.needsAttention)}</p>` : ''
  const subject = `${booking.needsAttention ? 'ATTENTION: ' : ''}Holiday booking: ${players} with ${coachName}, ${sydneyDateLabel(slot.startsAt)} ${sydneyTimeLabel(slot.startsAt)}`
  const children = `
    <tr><td style="padding:0 26px 26px;">
      ${attention}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${detailRows([
          ['When', `${sydneyDateTime(slot.startsAt)} to ${sydneyTimeLabel(slot.endsAt)}`],
          ['Coach', coachName],
          ['Session', TYPE_LABELS[booking.type] || TYPE_LABELS[slot.type] || slot.type],
          ['Players', players],
          ['Parent', booking.parentName],
          ['Email', booking.email],
          ['Mobile', booking.mobile],
          ['Notes', booking.notes || 'None'],
          ['Paid', formatAud(booking.priceCents)],
          ['Booking ID', booking.id],
          ['Stripe', booking.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}` : booking.stripeSessionId],
        ])}
      </table>
    </td></tr>`
  return brevoSend({ toEmail: to, toName: 'Lee', subject, html: shell({ preheader: subject, heading: 'New Holiday Booking', children }), replyTo: booking.email })
}

export function holidaySheetId() {
  return process.env.HOLIDAY_SHEET_ID || DEFAULT_SHEET_ID
}

function sheetRow({ booking, slot, coachName }, status) {
  return [
    new Date().toISOString(),
    status,
    slot.date,
    sydneyTimeLabel(slot.startsAt),
    sydneyTimeLabel(slot.endsAt),
    coachName,
    TYPE_LABELS[booking.type] || TYPE_LABELS[slot.type] || slot.type,
    (booking.players || []).map((p) => p.name).join(', '),
    (booking.players || []).map((p) => p.age).join(', '),
    booking.parentName,
    booking.mobile,
    booking.email,
    booking.notes || '',
    slot.location,
    booking.id,
    booking.needsAttention || '',
  ]
}

// True if a BOOKED row for this booking id is already in the tab, so a retry
// after an unknown outcome never doubles it up.
export async function sheetHasBooking(bookingId) {
  const rows = await readRows(holidaySheetId(), HOLIDAY_SHEET, HOLIDAY_HEADERS)
  const idCol = HOLIDAY_HEADERS.indexOf('Booking ID')
  const statusCol = HOLIDAY_HEADERS.indexOf('Status')
  return rows.some((r) => r[idCol] === bookingId && r[statusCol] === 'BOOKED')
}

// ---------- coach roster ----------
//
// The tab coaches read. Rewritten in full from the booking store every time
// something changes, so it is always a clean timetable sorted by day and
// time: cancellations simply drop out, and a retry can never duplicate a
// row. No money, no Stripe, no emails.
export const ROSTER_HEADERS = ['Day', 'Time', 'Coach', 'Session', 'Players', 'Ages', 'Parent', 'Mobile', 'Notes']

export async function rebuildRoster() {
  const [config, slots, bookings] = await Promise.all([getConfig(), listSlots({ includeCancelled: true }), listBookings({ limit: 1000 })])
  const slotsById = Object.fromEntries(slots.map((s) => [s.id, s]))
  const nowMs = Date.now() - 12 * 3600_000
  const entries = []
  for (const b of bookings) {
    const slot = slotsById[b.slotId]
    if (b.status !== 'paid' || !slot || new Date(slot.endsAt).getTime() < nowMs) continue
    entries.push({ slot, row: [
      (b.players || []).map((p) => p.name).join(', '),
      (b.players || []).map((p) => p.age).join(', '),
      b.parentName || '', b.mobile || '', b.notes || '',
    ], type: TYPE_LABELS[b.type] || b.type })
  }
  for (const slot of slots) {
    if (slot.status !== 'blocked' || new Date(slot.endsAt).getTime() < nowMs) continue
    entries.push({ slot, row: ['Booked offline', '', '', '', ''], type: '' })
  }
  entries.sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt) || a.slot.coachId.localeCompare(b.slot.coachId))
  const rows = entries.map(({ slot, row, type }) => [
    sydneyDateLabel(slot.startsAt),
    `${sydneyTimeLabel(slot.startsAt)} to ${sydneyTimeLabel(slot.endsAt)}`,
    `Coach ${coachById(config, slot.coachId)?.name || slot.coachId}`,
    type,
    ...row,
  ])
  const sheetId = holidaySheetId()
  const tab = encodeURIComponent(HOLIDAY_SHEET)
  await ensureSheetTab(sheetId, HOLIDAY_SHEET, ROSTER_HEADERS)
  await sheetsFetch(`${sheetId}/values/${tab}!A2:Z2000:clear`, { method: 'POST', body: '{}' })
  if (rows.length) {
    await sheetsFetch(`${sheetId}/values/${tab}!A2?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) })
  }
  return { rows: rows.length }
}

export async function appendHolidaySheetRow(context) {
  await appendRow(holidaySheetId(), HOLIDAY_SHEET, sheetRow(context, 'BOOKED'), HOLIDAY_HEADERS)
}

// Append-only: a cancellation is a new row that names the original booking id,
// so a coach scanning the tab sees the change without anyone editing cells.
export async function appendHolidayCancellationRow(context) {
  await appendRow(holidaySheetId(), HOLIDAY_SHEET, sheetRow(context, 'CANCELLED'), HOLIDAY_HEADERS)
}
