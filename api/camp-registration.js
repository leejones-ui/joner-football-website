function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim())
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

    const registration = {
      submittedAt: new Date().toISOString(),
      camp: clean(body.camp, 120),
      playerFirstName: clean(body.playerFirstName, 80),
      playerSurname: clean(body.playerSurname, 80),
      parentName: clean(body.parentName, 120),
      email: clean(body.email, 160).toLowerCase(),
      age: clean(body.age, 30),
      mobile: clean(body.mobile, 60),
      previousCamp: clean(body.previousCamp, 20),
      clubLevel: clean(body.clubLevel, 160),
      source: clean(body.source, 160),
      medicalHistory: clean(body.medicalHistory, 600),
      jerseySize: clean(body.jerseySize, 40),
      extraInfo: clean(body.extraInfo, 600),
      numberOfDays: clean(body.numberOfDays, 40),
      agreementAccepted: body.agreementAccepted === true || body.agreementAccepted === 'true' || body.agreementAccepted === 'on',
      paymentMethod: clean(body.paymentMethod, 30),
      paymentLink: clean(body.paymentLink, 500),
    }

    if (!registration.playerFirstName) return res.status(400).json({ success: false, error: 'Player first name is required.' })
    if (!registration.playerSurname) return res.status(400).json({ success: false, error: 'Player surname is required.' })
    if (!validEmail(registration.email)) return res.status(400).json({ success: false, error: 'Enter a valid email address.' })
    if (!registration.age) return res.status(400).json({ success: false, error: 'Player age is required.' })
    if (!registration.mobile) return res.status(400).json({ success: false, error: 'Mobile number is required.' })
    if (!registration.jerseySize) return res.status(400).json({ success: false, error: 'Jersey size is required.' })
    if (!registration.numberOfDays) return res.status(400).json({ success: false, error: 'Number of days is required.' })
    if (!registration.agreementAccepted) return res.status(400).json({ success: false, error: 'Training agreement must be accepted.' })

    const webhookUrl = process.env.CAMP_REGISTRATION_WEBHOOK_URL
    if (webhookUrl) {
      const webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registration),
      })

      if (!webhookResponse.ok) {
        return res.status(502).json({ success: false, error: 'Registration could not be saved. Please try again.' })
      }
    } else {
      console.log('Camp registration received without CAMP_REGISTRATION_WEBHOOK_URL configured:', registration)
    }

    return res.status(200).json({ success: true, paymentLink: registration.paymentLink || '' })
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Could not process registration.' })
  }
}
