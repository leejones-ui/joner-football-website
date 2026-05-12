import { DOWNLOAD_PRODUCTS, productFromStripeSession } from './_download-products.js'
import { saveDownloadToken } from './_download-store.js'
import { verifyStripeWebhook } from './_stripe-webhook.js'

function siteUrl(req) {
  return (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '')
}

function buyerEmail(session) {
  return String(session?.customer_details?.email || session?.customer_email || '').trim().toLowerCase()
}

function buyerName(session) {
  return String(session?.customer_details?.name || '').trim()
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function productListHtml(products) {
  return products.map((product) => `<li>${escapeHtml(product.name)}: <a href="${product.downloadUrl}">Download here</a></li>`).join('')
}

async function sendDownloadEmail({ toEmail, toName, products }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')

  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const senderName = process.env.DOWNLOAD_EMAIL_SENDER_NAME || 'Joner Football'
  const firstProduct = products[0]
  const subject = products.length === 1
    ? `Your ${firstProduct.name} download`
    : 'Your Joner Football downloads'

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.55;color:#111;">
      <h2>Your Joner Football download is ready</h2>
      <p>Thanks for your purchase${toName ? `, ${escapeHtml(toName)}` : ''}.</p>
      <p>Your private download link allows <strong>5 download attempts</strong>. Save the file to your device after downloading.</p>
      <ul>${productListHtml(products)}</ul>
      <p>If you have any issues, reply to this email and we will help.</p>
      <p>Joner Football</p>
    </div>
  `

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
      subject,
      htmlContent: html,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Download email failed.')
  }
}

async function createDownloadForProduct(req, session, product) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const email = buyerEmail(session)
  const record = {
    token,
    productKey: product.key,
    productName: product.name,
    email,
    buyerName: buyerName(session),
    stripeSessionId: session.id,
    stripePaymentIntent: session.payment_intent || '',
    remaining: 5,
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  await saveDownloadToken(token, record)
  return {
    ...product,
    downloadUrl: `${siteUrl(req)}/api/download?token=${token}`,
  }
}

async function handleCheckoutCompleted(req, session) {
  const email = buyerEmail(session)
  if (!email) throw new Error('Stripe session has no buyer email.')

  const product = productFromStripeSession(session)
  if (!product) {
    console.warn('Stripe download webhook ignored unknown product', {
      sessionId: session.id,
      amount: session.amount_total,
      currency: session.currency,
      paymentLink: session.payment_link,
      metadata: session.metadata,
    })
    return
  }

  const downloadableProducts = product.key === 'training-tools-5in1'
    ? [DOWNLOAD_PRODUCTS['training-tools-5in1']]
    : [product]

  const products = []
  for (const item of downloadableProducts) {
    products.push(await createDownloadForProduct(req, session, item))
  }

  await sendDownloadEmail({ toEmail: email, toName: buyerName(session), products })
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && Object.keys(req.body).length) return JSON.stringify(req.body)

  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)
    await verifyStripeWebhook(rawBody, req.headers['stripe-signature'], process.env.STRIPE_DOWNLOAD_WEBHOOK_SECRET)
    const event = JSON.parse(rawBody)

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(req, event.data.object)
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('Download webhook failed:', error)
    return res.status(400).json({ success: false, error: error.message || 'Webhook failed.' })
  }
}
