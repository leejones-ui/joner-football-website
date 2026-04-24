export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1]
        else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
      }
    }
    return matrix[b.length][a.length]
  }

  function suggestEmail(email) {
    const commonDomains = [
      'gmail.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'yahoo.com', 'live.com',
      'bigpond.com', 'me.com', 'mac.com', 'aol.com', 'yahoo.com.au', 'hotmail.com.au', 'outlook.com.au'
    ]
    const exactFixes = {
      'gmal.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail,com': 'gmail.com', 'gnail.com': 'gmail.com',
      'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
      'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
      'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
      'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
      'bigpond.con': 'bigpond.com', 'live.con': 'live.com'
    }

    const [local, domain] = String(email || '').split('@')
    if (!local || !domain) return null
    if (exactFixes[domain]) return `${local}@${exactFixes[domain]}`
    for (const candidate of commonDomains) {
      if (levenshtein(domain, candidate) <= 2) return `${local}@${candidate}`
    }
    return null
  }

  function validateEmail(rawEmail) {
    const email = String(rawEmail || '').trim().toLowerCase()
    const basicPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
    if (!email) return { valid: false, message: 'Email is required' }
    if (!basicPattern.test(email)) return { valid: false, message: 'Enter a valid email address' }
    if (email.includes('..')) return { valid: false, message: 'Enter a valid email address' }
    const domain = email.split('@')[1] || ''
    const tld = domain.split('.').pop()
    if (!tld || tld.length < 2) return { valid: false, message: 'Enter a valid email address' }
    const suggestion = suggestEmail(email)
    if (suggestion && suggestion !== email) return { valid: false, message: `Did you mean ${suggestion}?`, suggestion }
    return { valid: true, email }
  }

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const { email, firstName, listId } = req.body
    const validation = validateEmail(email)

    if (!validation.valid) {
      return res.status(400).json({ error: validation.message, suggestion: validation.suggestion || null })
    }

    const listIds = listId ? [Number(listId)] : [2]

    const body = {
      email: validation.email,
      listIds,
      updateEnabled: true,
    }

    if (firstName) {
      body.attributes = { FIRSTNAME: firstName }
    }

    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    })

    const isSuccess = response.ok || response.status === 204
    const data = await response.json().catch(() => ({}))
    const isDuplicate = data.code === 'duplicate_parameter'

    if (!isSuccess && !isDuplicate) {
      return res.status(response.status).json({ error: data.message || 'Failed to subscribe' })
    }

    // Send free session email for Free Session Leads list (33)
    if (listIds.includes(33)) {
      const name = firstName || 'there'
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender: { name: 'Lee — Joner Football', email: 'leejones@jonerfootball.com' },
          to: [{ email: validation.email }],
          subject: 'Your 2 free sessions are inside',
          htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="padding-bottom:32px;">
          <p style="margin:0;font-size:22px;font-weight:bold;color:#CC0000;letter-spacing:2px;text-transform:uppercase;">JONER FOOTBALL</p>
        </td></tr>

        <!-- Intro -->
        <tr><td style="padding-bottom:24px;">
          <p style="margin:0;font-size:18px;color:#ffffff;line-height:1.6;">Hey ${name},</p>
        </td></tr>
        <tr><td style="padding-bottom:24px;">
          <p style="margin:0;font-size:16px;color:#cccccc;line-height:1.7;">
            You asked to see what the program is actually like. Here are two full sessions, completely free. No login needed.
          </p>
        </td></tr>

        <!-- Session 1 -->
        <tr><td style="padding-bottom:16px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-left:4px solid #CC0000;">
            <tr><td style="padding:24px;">
              <p style="margin:0 0 4px 0;font-size:11px;color:#CC0000;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">Session 1</p>
              <p style="margin:0 0 12px 0;font-size:20px;font-weight:bold;color:#ffffff;">6 Week Passing and 1st Touch Program</p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#aaaaaa;line-height:1.6;">Week 1, Session 1. This is where the 100-day journey starts. First touch under pressure. Crisp passing. The foundation of everything.</p>
              <a href="https://app.jonerfootball.com/programs/6weekpassing?cid=3869725&permalink=6-weeks-program-week-1-session-1-41ba39" style="display:inline-block;background:#CC0000;color:#ffffff;text-decoration:none;padding:14px 28px;font-weight:bold;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Watch Free Session</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Session 2 -->
        <tr><td style="padding-bottom:32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-left:4px solid #CC0000;">
            <tr><td style="padding:24px;">
              <p style="margin:0 0 4px 0;font-size:11px;color:#CC0000;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">Session 2</p>
              <p style="margin:0 0 12px 0;font-size:20px;font-weight:bold;color:#ffffff;">Fast Feet Program</p>
              <p style="margin:0 0 20px 0;font-size:14px;color:#aaaaaa;line-height:1.6;">Quick feet that leave defenders guessing. 7 days. This is one of the most popular programs on the app.</p>
              <a href="https://app.jonerfootball.com/programs/s1-fast-feet-program-full-310bba?category_id=236680" style="display:inline-block;background:#CC0000;color:#ffffff;text-decoration:none;padding:14px 28px;font-weight:bold;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Watch Free Session</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding-bottom:32px;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:16px;color:#ffffff;font-weight:bold;">Ready to start the full 100-day program?</p>
          <p style="margin:0 0 20px 0;font-size:14px;color:#aaaaaa;">Annual members get all 6 programs, the 100-day guarantee, and can DM me directly inside the app.</p>
          <a href="https://app.jonerfootball.com/checkout/new?o=183092&utm_source=email&utm_medium=free_session" style="display:inline-block;background:#CC0000;color:#ffffff;text-decoration:none;padding:16px 36px;font-weight:bold;font-size:16px;text-transform:uppercase;letter-spacing:1px;">Start the Program Now</a>
          <p style="margin:12px 0 0 0;font-size:12px;color:#666666;">$204.99 AUD/year. Less than $4 a week. 100-day guarantee.</p>
        </td></tr>

        <!-- Sign off -->
        <tr><td style="border-top:1px solid #222222;padding-top:24px;">
          <p style="margin:0 0 4px 0;font-size:15px;color:#ffffff;">Lee</p>
          <p style="margin:0;font-size:13px;color:#666666;">Founder, Joner Football</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
        }),
      })
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
