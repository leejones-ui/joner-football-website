const REQUIRED = [
  'META_CAMPAIGN_ID', 'META_ADSET_ID', 'META_AD_ID',
  'JF_FIRST_PAID_AT', 'JF_FIRST_PAID_TRANSACTION_ID', 'JF_FIRST_PAID_EVENT_ID',
  'JF_FIRST_PAID_CANDIDATE_AT', 'JF_FIRST_PAID_CANDIDATE_TRANSACTION_ID', 'JF_FIRST_PAID_CANDIDATE_EVENT_ID',
]

const apiKey = process.env.BREVO_API_KEY
if (!apiKey) throw new Error('BREVO_API_KEY is required')

const headers = { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey }

async function listAttributes() {
  const response = await fetch('https://api.brevo.com/v3/contacts/attributes', { headers })
  if (!response.ok) throw new Error(`Brevo attribute read failed: ${response.status}`)
  const body = await response.json()
  return new Set((body.attributes || []).map((attribute) => attribute.name))
}

const before = await listAttributes()
const created = []
for (const name of REQUIRED) {
  if (before.has(name)) continue
  const response = await fetch(`https://api.brevo.com/v3/contacts/attributes/normal/${encodeURIComponent(name)}`, {
    method: 'POST', headers, body: JSON.stringify({ type: 'text' }),
  })
  if (!response.ok) throw new Error(`Brevo attribute create failed for ${name}: ${response.status}`)
  created.push(name)
}

const after = await listAttributes()
const missing = REQUIRED.filter((name) => !after.has(name))
if (missing.length) throw new Error(`Brevo attribute readback failed: ${missing.join(', ')}`)
console.log(JSON.stringify({ verified: true, created, existing: REQUIRED.filter((name) => before.has(name)) }, null, 2))
