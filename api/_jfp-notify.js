// A short message to the admin Telegram topic when a family applies, joins
// a waitlist or enquires. Off until the three env vars are set in Vercel:
//   JFP_TELEGRAM_BOT_TOKEN, JFP_TELEGRAM_CHAT_ID, JFP_TELEGRAM_THREAD_ID (optional)
// Never throws: an alert failing must never block a family's request.
export async function telegramAlert(text) {
  const token = process.env.JFP_TELEGRAM_BOT_TOKEN
  const chat = process.env.JFP_TELEGRAM_CHAT_ID
  if (!token || !chat) return 'off'
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, ...(process.env.JFP_TELEGRAM_THREAD_ID ? { message_thread_id: Number(process.env.JFP_TELEGRAM_THREAD_ID) } : {}), text: text.slice(0, 3500), disable_web_page_preview: true }),
    })
    return res.ok ? 'sent' : `failed ${res.status}`
  } catch (error) {
    console.error('jfp telegram alert failed', error)
    return 'failed'
  }
}

const KIND = { application: 'New application', waitlist: 'New waitlist request', enquiry: 'New 1 to 1 enquiry' }

// No phone numbers or emails in chat: names, group and the answers only.
export function requestText({ request, group, siteUrl }) {
  const players = request.players.map((p) => `${p.name}${p.age != null ? ` (${p.age})` : ''}`).join(', ')
  const a = request.answers || {}
  return [
    `JFP: ${KIND[request.kind] || 'New request'}`,
    `${players}`,
    `${group.day} ${group.time}${group.location ? `, ${group.location}` : ''}`,
    a.club || request.club ? `Club: ${a.club || request.club}${a.team ? `, ${a.team}` : ''}` : '',
    a.playingUp ? `Playing: ${a.playingUp}` : '',
    `Parent: ${request.parentName}`,
    siteUrl ? `Review: ${siteUrl}/jfp-portal/#requests` : '',
  ].filter(Boolean).join('\n')
}
