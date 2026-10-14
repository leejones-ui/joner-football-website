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
    a.videos ? 'Sent videos of the player' : '',
    `Parent: ${request.parentName}`,
    siteUrl ? `Review: ${siteUrl}/jfp-portal/#requests` : '',
  ].filter(Boolean).join('\n')
}

// Several sessions in one go: one message, every session listed.
export function batchText({ requests, groups, paying = [], siteUrl }) {
  const first = requests[0]
  const players = first.players.map((p) => `${p.name}${p.age != null ? ` (${p.age})` : ''}`).join(', ')
  const a = first.answers || {}
  const word = { application: 'Apply', waitlist: 'Waitlist' }
  return [
    `JFP: ${requests.length + paying.length} sessions in one go`,
    players,
    ...requests.map((r, i) => `${word[r.kind] || r.kind}: ${groups[i].day} ${groups[i].time}${groups[i].location ? `, ${groups[i].location}` : ''}`),
    ...paying.map((g) => `Booking and paying: ${g.day} ${g.time}${g.location ? `, ${g.location}` : ''}`),
    a.club || first.club ? `Club: ${a.club || first.club}${a.team ? `, ${a.team}` : ''}` : '',
    `Parent: ${first.parentName}`,
    siteUrl ? `Review: ${siteUrl}/jfp-portal/#requests` : '',
  ].filter(Boolean).join('\n')
}

// A family cannot make a session. Player, session, reason and notice only:
// no note (it is free text and could hold a number), no email, no phone.
export function cancelText(rec) {
  const late = rec.noticeLevel === 'very-late' ? ' VERY LATE (under 2 h)' : rec.noticeLevel === 'late' ? ' LATE (under 24 h)' : ''
  if (rec.event === 'withdrawn') {
    return [`JFP: cancellation withdrawn, ${rec.player} is coming`, `${rec.day} ${rec.time}, ${rec.location}, ${rec.dateLabel}`].join('\n')
  }
  return [
    `JFP: can't make a session${late}`,
    rec.player,
    `${rec.day} ${rec.time}, ${rec.location}, ${rec.dateLabel}`,
    `Reason: ${rec.reason}`,
    `Notice: ${rec.noticeLabel}`,
    rec.coachNames?.length ? `Coach: ${rec.coachNames.join(', ').replace(/Coach /g, '')}` : '',
  ].filter(Boolean).join('\n')
}
