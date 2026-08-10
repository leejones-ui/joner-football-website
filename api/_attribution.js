const MARKER = '__jfa1__'
const CONTAINERS = [
  'utm_params',
  'utm',
  'tracking_params',
  'query_params',
  'metadata',
  'custom_data',
  'customer',
  'user',
  'data',
  'payload',
  'event_data',
]

function clean(value, max = 240) {
  if (value === undefined || value === null) return undefined
  const output = String(value).trim().slice(0, max)
  return output || undefined
}

function firstValue(data, key, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return undefined
  const direct = clean(data[key], 1200)
  if (direct) return direct
  for (const container of CONTAINERS) {
    const nested = data[container]
    if (!nested || typeof nested !== 'object') continue
    const value = firstValue(nested, key, depth + 1)
    if (value) return value
  }
  return undefined
}

export function decodeUscreenSource(value) {
  const raw = clean(value, 1200)
  if (!raw) return {}
  const markerIndex = raw.indexOf(MARKER)
  if (markerIndex === -1) return { utm_source: raw }

  const prefix = clean(raw.slice(0, markerIndex), 180)
  const packed = new URLSearchParams(raw.slice(markerIndex + MARKER.length))
  return {
    utm_source: clean(packed.get('s') || prefix, 180),
    utm_medium: clean(packed.get('m'), 180),
    utm_campaign: clean(packed.get('c'), 240),
    utm_content: clean(packed.get('k'), 240),
    utm_term: clean(packed.get('t'), 180),
    utm_id: clean(packed.get('i'), 180),
    campaign_id: clean(packed.get('i'), 180),
    adset_id: clean(packed.get('a'), 180),
    ad_id: clean(packed.get('d'), 180),
    placement: clean(packed.get('p'), 120),
    fbclid: clean(packed.get('f'), 500),
    fbp: clean(packed.get('b'), 240),
    fbc: clean(packed.get('q'), 500),
    encoded_source: raw,
  }
}

export function extractAttribution(data) {
  const rawSource = firstValue(data, 'utm_source')
  const decoded = decodeUscreenSource(rawSource)
  return {
    utm_source: clean(firstValue(data, 'original_utm_source') || decoded.utm_source || rawSource, 180),
    utm_medium: clean(firstValue(data, 'utm_medium') || decoded.utm_medium, 180),
    utm_campaign: clean(firstValue(data, 'utm_campaign') || decoded.utm_campaign, 240),
    utm_content: clean(firstValue(data, 'utm_content') || decoded.utm_content, 240),
    utm_term: clean(firstValue(data, 'utm_term') || decoded.utm_term, 180),
    utm_id: clean(firstValue(data, 'utm_id') || firstValue(data, 'campaign_id') || decoded.utm_id, 180),
    campaign_id: clean(firstValue(data, 'campaign_id') || firstValue(data, 'utm_id') || decoded.campaign_id, 180),
    adset_id: clean(firstValue(data, 'adset_id') || decoded.adset_id, 180),
    ad_id: clean(firstValue(data, 'ad_id') || decoded.ad_id, 180),
    placement: clean(firstValue(data, 'placement') || decoded.placement, 120),
    encoded_source: decoded.encoded_source,
  }
}

export function extractMetaIdentity(data, eventTime = Math.floor(Date.now() / 1000)) {
  const decoded = decodeUscreenSource(firstValue(data, 'utm_source'))
  const fbp = clean(firstValue(data, 'fbp') || firstValue(data, '_fbp') || decoded.fbp, 240)
  let fbc = clean(firstValue(data, 'fbc') || firstValue(data, '_fbc') || decoded.fbc, 500)
  const fbclid = clean(firstValue(data, 'fbclid') || decoded.fbclid, 500)
  if (!fbc && fbclid) fbc = `fb.1.${Number(eventTime) * 1000}.${fbclid}`
  return { fbp, fbc, fbclid }
}

export { MARKER }
