const APP_CTA_URL = 'https://jonerfootball.com/app'
const CAMPS_URL = 'https://jonerfootball.com/camps'
const INSTAGRAM_URL = 'https://www.instagram.com/jonerfootball/'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function clean(value, fallback = '') {
  const text = String(value || '').trim()
  return text || fallback
}

function destinationFrom(data) {
  return clean(data.destination || data.location || data.campDestination || data.campCity, 'your camp')
}

function heroImageFor(data) {
  if (data.heroImageUrl) return data.heroImageUrl
  const text = `${data.destination || ''} ${data.location || ''} ${data.campName || data.camp || ''}`.toLowerCase()
  if (text.includes('sydney')) return 'https://jonerfootball.com/images/camps/sydney-2026/photos/lee-miguel-coaching.jpg'
  if (text.includes('houston')) return 'https://jonerfootball.com/images/camps/houston/DSC05857-scaled.jpg.webp'
  if (text.includes('dallas')) return 'https://jonerfootball.com/images/camps/dallas-camp.webp'
  return 'https://jonerfootball.com/images/camps/sydney-camp.webp'
}

function detailRows(data, mode = 'confirmed') {
  const rows = [
    ['Player', `${clean(data.playerFirstName)} ${clean(data.playerSurname)}`.trim()],
    ['Camp', clean(data.campName || data.camp, 'Joner Football Elite Camp')],
    ['Dates', clean(data.campDates || data.dates, 'Confirmed camp dates')],
    ['Times', clean(data.campTimes || data.times, 'Confirmed camp times')],
    ['Location', clean(data.campLocation || data.location || data.venue, destinationFrom(data))],
    [mode === 'confirmed' ? 'Days booked' : 'Days selected', clean(data.numberOfDays || data.daysBooked || data.days, 'Selected days')],
  ]
  if (mode === 'confirmed') rows.push(['Jersey size', clean(data.jerseySize, 'Selected on form')])
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `
      <tr>
        <td style="padding:12px 12px;border-bottom:1px solid #2b2b2b;color:#9b9b9b;font-size:13px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;">${escapeHtml(label)}</td>
        <td style="padding:12px 12px;border-bottom:1px solid #2b2b2b;color:#ffffff;font-size:15px;font-weight:800;text-align:right;">${escapeHtml(value)}</td>
      </tr>
    `).join('')
}

function shell({ preheader, heroImageUrl, heading, children }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:660px;background:#111111;border:1px solid #252525;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#000000;">
                <img src="${escapeHtml(heroImageUrl)}" width="660" alt="Joner Football elite camp training" style="display:block;width:100%;max-width:660px;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:32px 26px 10px;">
                <p style="margin:0 0 10px;color:#e8000d;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:1.8px;text-transform:uppercase;">Joner Football Elite Camp</p>
                <h1 style="margin:0 0 18px;color:#ffffff;font-size:30px;line-height:1.08;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            ${children}
            <tr>
              <td style="padding:26px;background:#0b0b0b;border-top:1px solid #252525;">
                <p style="margin:0 0 4px;color:#ffffff;font-size:15px;line-height:1.6;font-weight:800;">Lee Jones</p>
                <p style="margin:0;color:#bdbdbd;font-size:14px;line-height:1.6;">Joner Football</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function redButton(label, href) {
  return `<a href="${escapeHtml(href)}" style="background:#e8000d;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;line-height:20px;padding:16px 24px;border-radius:8px;display:inline-block;text-transform:uppercase;letter-spacing:.04em;text-align:center;">${escapeHtml(label)}</a>`
}

export function renderCampPaidConfirmationEmail(data = {}) {
  const destination = destinationFrom(data)
  const player = clean(data.playerFirstName, 'your player')
  const parent = clean(data.parentName || data.parentFirstName, 'there')
  const heading = `Congratulations, your spot has been confirmed for the Joner Football Elite Camp in ${destination}`
  const subject = clean(data.subject, `Your Joner Football Elite Camp spot is confirmed`)
  const preheader = `Your spot is confirmed. Here is what to bring, when to arrive and how to start training before camp.`
  const heroImageUrl = heroImageFor(data)

  const html = shell({
    preheader,
    heroImageUrl,
    heading,
    children: `
      <tr><td style="padding:0 26px 6px;">
        <p style="margin:0 0 18px;color:#e8e8e8;font-size:16px;line-height:1.65;">Hi ${escapeHtml(parent)},</p>
        <p style="margin:0 0 18px;color:#e8e8e8;font-size:16px;line-height:1.65;">You are in. ${escapeHtml(player)}'s spot is confirmed for the Joner Football Elite Camp in ${escapeHtml(destination)}, and we cannot wait to get to work.</p>
        <p style="margin:0 0 22px;color:#ffffff;font-size:17px;line-height:1.55;font-weight:800;">This is not a babysitting camp. It is a proper Joner Football environment: energy, standards, detail and players who want to improve.</p>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid #2b2b2b;border-radius:12px;overflow:hidden;">${detailRows(data, 'confirmed')}</table>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:21px;line-height:1.2;font-weight:900;text-transform:uppercase;">Before the day</h2>
        <p style="margin:0 0 14px;color:#d8d8d8;font-size:15px;line-height:1.65;">Please arrive <strong style="color:#ffffff;">20 minutes early</strong> for sign-in, jersey collection and the camp presentation.</p>
        <p style="margin:0;color:#d8d8d8;font-size:15px;line-height:1.65;">Double check the jersey size selected. Please factor in your child's growth between now and camp day, because once the order cut-off passes we cannot guarantee changes.</p>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:21px;line-height:1.2;font-weight:900;text-transform:uppercase;">What to bring</h2>
        <ul style="margin:0;padding-left:20px;color:#d8d8d8;font-size:15px;line-height:1.75;">
          <li>Boots, drinks bottle, rain jacket and normal match day kit</li>
          <li>White socks and black shorts if possible</li>
          <li>A smile, good attitude, energy and willingness to work hard</li>
        </ul>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:21px;line-height:1.2;font-weight:900;text-transform:uppercase;">Jerseys, refunds and merch</h2>
        <p style="margin:0 0 12px;color:#d8d8d8;font-size:15px;line-height:1.65;">You will receive the size selected on the form. Camp jerseys are included for players doing all 3 days only. We may have jerseys for sale on the day, but sizes are not guaranteed.</p>
        <p style="margin:0 0 12px;color:#d8d8d8;font-size:15px;line-height:1.65;">No refunds for cancellations inside the 14-day period, as per the terms and conditions. Refunds inside the cancellation period may incur a Stripe or PayPal transaction fee.</p>
        <p style="margin:0;color:#d8d8d8;font-size:15px;line-height:1.65;">JF merch will be available on the day. If you want something specific, email <a href="mailto:ligia@jonerfootball.com" style="color:#ffffff;">ligia@jonerfootball.com</a> to pre-order.</p>
      </td></tr>
      <tr><td style="padding:0 26px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;border:1px solid #2b2b2b;border-radius:12px;"><tr><td style="padding:24px;text-align:center;">
          <p style="margin:0 0 8px;color:#e8000d;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;">Start training before camp</p>
          <h2 style="margin:0 0 12px;color:#ffffff;font-size:23px;line-height:1.2;font-weight:900;">Want ${escapeHtml(player)} to arrive sharper?</h2>
          <p style="margin:0 0 20px;color:#d8d8d8;font-size:15px;line-height:1.65;">Download the Joner Football App and start with the free section before camp. It helps players understand the standards, the detail and the type of training we expect.</p>
          ${redButton('Download the free app', APP_CTA_URL)}
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 26px 30px;">
        <p style="margin:0 0 12px;color:#d8d8d8;font-size:15px;line-height:1.65;">We aim for 16 to 18 players per coach so the detail stays high. If a teammate wants to join, send them this link before the camp sells out: <a href="${CAMPS_URL}" style="color:#ffffff;">${CAMPS_URL}</a></p>
        <p style="margin:0;color:#d8d8d8;font-size:15px;line-height:1.65;">Follow <a href="${INSTAGRAM_URL}" style="color:#ffffff;">@JonerFootball</a> on Instagram, especially stories, for camp updates. Any questions, just reply to this email. The team cannot wait to coach you.</p>
      </td></tr>
    `,
  })

  return { subject, preheader, html }
}

export function renderCampUnpaidReminderEmail(data = {}) {
  const destination = destinationFrom(data)
  const player = clean(data.playerFirstName, 'your player')
  const parent = clean(data.parentName || data.parentFirstName, 'there')
  const paymentLink = clean(data.paymentLink, CAMPS_URL)
  const heading = `Your Joner Football Elite Camp spot is not confirmed yet`
  const subject = clean(data.subject, `Your camp spot is not confirmed yet`)
  const preheader = `Your form has been received, but the camp spot is not confirmed until payment is complete.`
  const heroImageUrl = heroImageFor(data)

  const html = shell({
    preheader,
    heroImageUrl,
    heading,
    children: `
      <tr><td style="padding:0 26px 6px;">
        <p style="margin:0 0 18px;color:#e8e8e8;font-size:16px;line-height:1.65;">Hi ${escapeHtml(parent)},</p>
        <p style="margin:0 0 18px;color:#e8e8e8;font-size:16px;line-height:1.65;">We have received the form for ${escapeHtml(player)} for the Joner Football Elite Camp in ${escapeHtml(destination)}, but payment has not been completed yet.</p>
        <p style="margin:0 0 22px;color:#ffffff;font-size:17px;line-height:1.55;font-weight:900;">Your spot is not confirmed until payment is complete.</p>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid #2b2b2b;border-radius:12px;overflow:hidden;">${detailRows(data, 'unpaid')}</table>
      </td></tr>
      <tr><td style="padding:0 26px 28px;text-align:center;">
        <p style="margin:0 0 20px;color:#d8d8d8;font-size:15px;line-height:1.65;">Camp places are limited and we aim for 16 to 18 players per coach, so please complete payment as soon as possible if you want the spot.</p>
        ${redButton('Complete payment now', paymentLink)}
      </td></tr>
      <tr><td style="padding:0 26px 30px;">
        <p style="margin:0 0 12px;color:#d8d8d8;font-size:15px;line-height:1.65;">If you no longer want the spot, no worries. Just reply and let us know so we can release it to another player.</p>
        <p style="margin:0;color:#d8d8d8;font-size:15px;line-height:1.65;">If you have already paid and this email crossed over, reply with the payment receipt and we will check it.</p>
      </td></tr>
    `,
  })

  return { subject, preheader, html }
}

export async function sendCampTransactionalEmail({ toEmail, toName, template, data }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  if (!toEmail) throw new Error('Recipient email is required.')

  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const senderName = process.env.CAMP_EMAIL_SENDER_NAME || 'Joner Football Camps'
  const rendered = template === 'unpaid'
    ? renderCampUnpaidReminderEmail(data)
    : renderCampPaidConfirmationEmail(data)

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: toName || toEmail }],
      replyTo: { email: process.env.CAMP_REPLY_TO_EMAIL || senderEmail, name: 'Joner Football' },
      subject: rendered.subject,
      htmlContent: rendered.html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Camp transactional email failed.')
  }

  return { success: true, subject: rendered.subject }
}

export function testCampEmailData(overrides = {}) {
  return {
    parentName: 'Lee',
    playerFirstName: 'Test',
    playerSurname: 'Player',
    campName: 'Sydney July Camp ft Miguel Grande',
    destination: 'Sydney',
    campDates: 'July 14-16, 2026',
    campTimes: '9am to 12pm',
    campLocation: 'Rydalmere Park, Sydney',
    numberOfDays: '3 days',
    jerseySize: 'Youth M',
    paymentLink: 'https://jonerfootball.com/camps/sydney-july-2026/#register',
    ...overrides,
  }
}
