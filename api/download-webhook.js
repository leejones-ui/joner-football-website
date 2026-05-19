import { DOWNLOAD_PRODUCTS, productFromStripeSession } from './_download-products.js'
import { claimProcessedSession, saveDownloadToken } from './_download-store.js'
import { verifyStripeWebhook } from './_stripe-webhook.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

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

function downloadButtonsHtml(products) {
  return products.map((product) => `
    <tr>
      <td align="center" style="padding:8px 0;">
        <a href="${product.downloadUrl}" style="background:#e50914;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;line-height:20px;padding:16px 26px;border-radius:8px;display:inline-block;min-width:250px;text-align:center;">
          Download ${escapeHtml(product.name)}
        </a>
      </td>
    </tr>
  `).join('')
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
  const heroImageUrl = process.env.DOWNLOAD_EMAIL_HERO_IMAGE_URL || 'https://joner-football-website.vercel.app/images/app/lee-app-composite.jpg'

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#0b0b0b;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
        <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
          Your download is ready. Start with the file, then build the full plan inside the Joner Football App.
        </span>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0b;margin:0;padding:0;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#111111;border:1px solid #252525;border-radius:14px;overflow:hidden;">
                <tr>
                  <td>
                    <img src="${heroImageUrl}" width="640" alt="Joner Football App training" style="display:block;width:100%;max-width:640px;height:auto;border:0;">
                  </td>
                </tr>
                <tr>
                  <td style="padding:34px 28px 10px;">
                    <h1 style="margin:0 0 14px;font-size:30px;line-height:1.12;color:#ffffff;font-weight:900;">
                      Your download is ready
                    </h1>
                    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#e8e8e8;">
                      Thanks for your purchase${toName ? `, ${escapeHtml(toName)}` : ''}. Your private download link is below. Download it now and save it somewhere easy to find.
                    </p>
                    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#e8e8e8;">
                      This link is limited to <strong style="color:#ffffff;">5 download attempts</strong>, so keep the file once it has downloaded.
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${downloadButtonsHtml(products)}
                    </table>
                    <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#a8a8a8;text-align:center;">
                      If the button does not work, reply to this email and we will help.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:22px 28px 30px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid #2b2b2b;border-radius:12px;">
                      <tr>
                        <td style="padding:24px;">
                          <p style="margin:0 0 8px;font-size:12px;line-height:1.4;color:#e50914;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;">
                            Next step
                          </p>
                          <h2 style="margin:0 0 10px;font-size:23px;line-height:1.25;color:#ffffff;font-weight:900;">
                            Turn the download into a full training plan
                          </h2>
                          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d8d8d8;">
                            The download gives you the tool. The Joner Football App gives you the structure, sessions and next steps so players know exactly what to work on after using it.
                          </p>
                          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#d8d8d8;">
                            Start with the 100 Day Program if you want a clear player development pathway. If you are a coach, go straight to Coaches Only for sessions, testing ideas and coaching resources.
                          </p>
                          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                            <tr>
                              <td align="center" style="padding:7px 0;">
                                <a href="https://www.jonerfootball.com/join" style="background:#e50914;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;line-height:20px;padding:15px 22px;border-radius:8px;display:inline-block;min-width:240px;text-align:center;">
                                  Start with the App
                                </a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:7px 0;">
                                <a href="https://app.jonerfootball.com/categories/category-qee31-z2mxo" style="background:#ffffff;color:#111111;text-decoration:none;font-weight:800;font-size:15px;line-height:20px;padding:14px 20px;border-radius:8px;display:inline-block;min-width:240px;text-align:center;">
                                  Open 100 Day Program
                                </a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="padding:7px 0;">
                                <a href="https://app.jonerfootball.com/categories/category-8-7szqoiq00" style="background:#242424;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;line-height:20px;padding:14px 20px;border-radius:8px;display:inline-block;min-width:240px;text-align:center;border:1px solid #3a3a3a;">
                                  Open Coaches Only
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:22px 0 4px;font-size:15px;line-height:1.6;color:#d8d8d8;">
                      If anything goes wrong with your download, reply to this email and we will help.
                    </p>
                    <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:#ffffff;">
                      Lee Jones<br>Joner Football
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
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

async function fetchStripeCheckoutSession(sessionId) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured for fallback session verification.')

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${secretKey}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Stripe session lookup failed: ${response.status}`)
  }

  return response.json()
}

async function verifiedEventFromBody(rawBody) {
  const event = JSON.parse(rawBody)
  if (event?.type !== 'checkout.session.completed') return event

  const sessionId = event?.data?.object?.id
  if (!sessionId) throw new Error('Stripe checkout session id is missing.')

  const verifiedSession = await fetchStripeCheckoutSession(sessionId)
  if (verifiedSession?.payment_status !== 'paid' || verifiedSession?.status !== 'complete') {
    throw new Error('Stripe checkout session is not paid and complete.')
  }

  return {
    ...event,
    data: {
      ...event.data,
      object: verifiedSession,
    },
  }
}

async function handleCheckoutCompleted(req, session) {
  const claimed = await claimProcessedSession(session.id)
  if (!claimed) {
    console.info('Stripe download webhook ignored already processed session', session.id)
    return
  }

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
    let event

    try {
      await verifyStripeWebhook(rawBody, req.headers['stripe-signature'], process.env.STRIPE_DOWNLOAD_WEBHOOK_SECRET)
      event = JSON.parse(rawBody)
    } catch (signatureError) {
      console.warn('Download webhook signature verification failed, falling back to Stripe session lookup:', signatureError)
      event = await verifiedEventFromBody(rawBody)
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(req, event.data.object)
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('Download webhook failed:', error)
    return res.status(400).json({ success: false, error: error.message || 'Webhook failed.' })
  }
}
