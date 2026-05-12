import { Readable } from 'node:stream'
import { DOWNLOAD_PRODUCTS } from './_download-products.js'
import { getDownloadToken, updateDownloadToken } from './_download-store.js'

function cleanToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 160)
}

function sendHtml(res, status, title, message) {
  res.statusCode = status
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#050505;color:white;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}.card{max-width:560px;border:1px solid #333;background:#111;padding:32px}h1{font-size:32px;text-transform:uppercase;margin:0 0 12px}p{color:#ccc;line-height:1.5}.red{color:#e00000}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p><p class="red">Joner Football</p></div></body></html>`)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return sendHtml(res, 405, 'Method not allowed', 'This download link only works in a browser.')
  }

  const token = cleanToken(req.query?.token)
  if (!token) return sendHtml(res, 400, 'Invalid link', 'This download link is missing its private token.')

  try {
    const record = await getDownloadToken(token)
    if (!record) return sendHtml(res, 404, 'Download link not found', 'This download link is invalid or has expired.')
    if (Number(record.remaining || 0) <= 0) return sendHtml(res, 410, 'Download limit reached', 'This private link has already been used 5 times. Contact Joner Football if you need help.')

    const product = DOWNLOAD_PRODUCTS[record.productKey]
    if (!product) return sendHtml(res, 404, 'Product not found', 'This download product is no longer available.')

    const nextRecord = {
      ...record,
      remaining: Number(record.remaining || 0) - 1,
      attempts: Number(record.attempts || 0) + 1,
      lastDownloadAt: new Date().toISOString(),
    }
    await updateDownloadToken(token, nextRecord)

    const upstream = await fetch(product.sourceUrl, { redirect: 'follow' })
    if (!upstream.ok || !upstream.body) {
      await updateDownloadToken(token, record)
      return sendHtml(res, 502, 'Download unavailable', 'The file could not be reached right now. Please try again shortly.')
    }

    res.statusCode = 200
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('content-disposition', `attachment; filename="${product.filename}"`)
    res.setHeader('cache-control', 'private, no-store')

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) res.setHeader('content-length', contentLength)

    Readable.fromWeb(upstream.body).pipe(res)
  } catch (error) {
    console.error('Protected download failed:', error)
    return sendHtml(res, 500, 'Download error', 'Something went wrong with this download. Please try again or contact Joner Football.')
  }
}
