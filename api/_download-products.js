export const DOWNLOAD_PRODUCTS = {
  'training-tools-5in1': {
    key: 'training-tools-5in1',
    name: 'Joner Football 5 In 1 Training Tools',
    priceLabel: 'AUD 79.99',
    currency: 'aud',
    amount: 7999,
    stripePaymentUrl: 'https://buy.stripe.com/bJe00icKA49l35ZfpqgEg09',
    sourceUrl: 'https://www.dropbox.com/scl/fo/dij7umkktwk2vkiumcj1t/h?rlkey=51sx4nw3b9gnxl55mp5ra5uqb&st=tl1gh57r&dl=1',
    filename: 'Joner-Football-5-in-1-Training-Tools.zip',
  },
  'numbers-tool': {
    key: 'numbers-tool',
    name: 'Joner Football Numbers Tool',
    priceLabel: 'AUD 24.99',
    currency: 'aud',
    amount: 2499,
    stripePaymentUrl: 'https://buy.stripe.com/cNieVccKA0X921VgtugEg0a',
    sourceUrl: 'https://www.dropbox.com/scl/fi/il1b4h920587iocqotq93/GAZZA-SCAN.MP4?rlkey=8c3kw275p3btj6vt8z5yih82n&st=ythzuoge&dl=1',
    filename: 'Joner-Football-Numbers-Tool.mp4',
  },
}

export function productFromStripeSession(session) {
  const metadataKey = session?.metadata?.product_key || session?.metadata?.productKey
  if (metadataKey && DOWNLOAD_PRODUCTS[metadataKey]) return DOWNLOAD_PRODUCTS[metadataKey]

  const amount = Number(session?.amount_total || session?.amount_subtotal || 0)
  const currency = String(session?.currency || '').toLowerCase()
  return Object.values(DOWNLOAD_PRODUCTS).find((product) => product.amount === amount && product.currency === currency) || null
}
