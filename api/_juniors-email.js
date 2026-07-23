export async function sendJuniorsEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Brevo email is not configured.')
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: 'Joner Football', email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com' },
      to: [{ email: to }], ...(replyTo ? { replyTo: { email: replyTo, name: 'Ligia' } } : {}), subject, htmlContent: html,
    }),
  })
  if (!response.ok) throw new Error('Brevo email send failed.')
  return true
}
