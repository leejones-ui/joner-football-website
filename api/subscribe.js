export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const { email, firstName, listId } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const listIds = listId ? [Number(listId)] : [2]

    const body = {
      email,
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

    if (response.ok || response.status === 204) {
      return res.status(200).json({ success: true })
    }

    const data = await response.json().catch(() => ({}))

    if (data.code === 'duplicate_parameter') {
      return res.status(200).json({ success: true, message: 'Already subscribed' })
    }

    return res.status(response.status).json({ error: data.message || 'Failed to subscribe' })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
}
