// Joner apparel from Shopify, read through the public Storefront API (tokenless access:
// products, collections and carts only, no secrets). Pages render these at build time so the
// HTML has real products; src/scripts/jf-shop.ts then re-reads them in the browser so price and
// stock are live, and checks out through a Shopify cart.
// When shop.jonerfootball.com is connected in Shopify, checkout URLs follow it automatically.

import { SHOP_EXTRA_IMAGES, SHOP_FAMILIES, SWATCH_HEX } from '../data/shop-extra-images'

export const SHOP_DOMAIN = 'jonerfootball.myshopify.com'
export const SHOP_API_VERSION = '2026-01'
export const SHOP_ENDPOINT = `https://${SHOP_DOMAIN}/api/${SHOP_API_VERSION}/graphql.json`

export interface ShopVariant {
  id: string
  title: string
  available: boolean
  price: number
  compareAt: number | null
  options: Record<string, string>
  image: string | null
}

export interface ShopImage { url: string; alt: string; w: number; h: number; colour?: string }

export interface ShopProduct {
  handle: string
  title: string
  type: string
  description: string
  images: ShopImage[]
  tags: string[]
  options: { name: string; values: string[] }[]
  variants: ShopVariant[]
  available: boolean
  minPrice: number
  compareAt: number | null
}

export const PRODUCTS_QUERY = `{
  products(first: 50, sortKey: BEST_SELLING) {
    nodes {
      handle title productType description availableForSale tags
      images(first: 16) { nodes { url altText width height } }
      options { name optionValues { name } }
      variants(first: 60) { nodes {
        id title availableForSale
        price { amount } compareAtPrice { amount }
        selectedOptions { name value }
        image { url }
      } }
    }
  }
}`

export function mapProducts(data: any): ShopProduct[] {
  const nodes = data?.data?.products?.nodes
  if (!Array.isArray(nodes)) return []
  return mergeFamilies(nodes.map(mapOne).map(addExtras))
}

function mapOne(p: any): ShopProduct {
  const variants: ShopVariant[] = (p.variants?.nodes || []).map((v: any) => ({
    id: v.id,
    title: v.title,
    available: !!v.availableForSale,
    price: Number(v.price?.amount) || 0,
    compareAt: v.compareAtPrice ? Number(v.compareAtPrice.amount) || null : null,
    options: Object.fromEntries((v.selectedOptions || []).map((o: any) => [o.name, o.value])),
    image: v.image?.url || null,
  }))
  const prices = variants.map((v) => v.price).filter((n) => n > 0)
  const minPrice = prices.length ? Math.min(...prices) : 0
  const cheapest = variants.find((v) => v.price === minPrice)
  return {
    handle: p.handle,
    title: p.title,
    type: p.productType || '',
    description: p.description || '',
    images: (p.images?.nodes || []).map((i: any) => ({ url: i.url, alt: i.altText || p.title, w: i.width || 0, h: i.height || 0 })),
    tags: Array.isArray(p.tags) ? p.tags : [],
    options: (p.options || [])
      .map((o: any) => ({ name: o.name, values: (o.optionValues || []).map((v: any) => v.name) }))
      .filter((o: any) => !(o.name === 'Title' && o.values.length === 1 && o.values[0] === 'Default Title')),
    variants,
    available: !!p.availableForSale,
    minPrice,
    compareAt: cheapest?.compareAt && cheapest.compareAt > minPrice ? cheapest.compareAt : null,
  }
}

// Site-only photos go in after the first Shopify photo.
function addExtras(p: ShopProduct): ShopProduct {
  const extra = SHOP_EXTRA_IMAGES[p.handle]
  if (!extra?.length) return p
  return { ...p, images: [...p.images.slice(0, 1), ...extra, ...p.images.slice(1)] }
}

const colourKey = (v: string) => v.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, '').trim()
const COLOUR_RE = /^colou?r$/i

// Does this photo show that colour? A photo's own colour wins, else its alt text names it.
export function showsColour(i: ShopImage, colour: string) {
  if (i.colour) return i.colour === colour
  const key = colourKey(colour)
  return !!key && new RegExp(`\\b${key}\\b`).test(i.alt.toLowerCase())
}

// SHOP_FAMILIES: several Shopify products become one card with one Colour choice.
function mergeFamilies(list: ShopProduct[]): ShopProduct[] {
  let out = list
  for (const fam of SHOP_FAMILIES) {
    const members = fam.members.map((m) => ({ m, p: out.find((x) => x.handle === m.handle) })).filter((x) => x.p) as { m: (typeof fam.members)[number]; p: ShopProduct }[]
    if (members.length < 2) continue
    const values: string[] = []
    const variants: ShopVariant[] = []
    const images: ShopImage[] = []
    for (const { m, p } of members) {
      const own = p.options.find((o) => COLOUR_RE.test(o.name))
      const names = m.colour ? [m.colour] : own ? own.values : [p.title]
      values.push(...names)
      for (const v of p.variants) {
        const colour = m.colour || (own ? v.options[own.name] : p.title)
        const rest = Object.entries(v.options).filter(([k]) => !COLOUR_RE.test(k) && k !== 'Title')
        variants.push({ ...v, title: [colour, ...rest.map(([, x]) => x)].join(' / '), options: { Colour: colour, ...Object.fromEntries(rest) } })
      }
      for (const i of p.images) {
        const hit = m.colour ? m.colour : names.filter((n) => showsColour(i, n))
        images.push({ ...i, colour: typeof hit === 'string' ? hit : hit.length === 1 ? hit[0] : undefined })
      }
    }
    const first = members[0].p
    const prices = variants.map((v) => v.price).filter((n) => n > 0)
    const merged: ShopProduct = {
      handle: fam.handle,
      title: fam.title,
      type: fam.type,
      description: first.description,
      images,
      tags: [...new Set(members.flatMap(({ p }) => p.tags))],
      options: [{ name: 'Colour', values }],
      variants,
      available: members.some(({ p }) => p.available),
      minPrice: prices.length ? Math.min(...prices) : 0,
      compareAt: null,
    }
    const at = out.indexOf(first)
    const gone = new Set(members.map(({ p }) => p))
    out = out.flatMap((p, i) => (i === at ? [merged] : gone.has(p) ? [] : [p]))
  }
  return out
}

// An old link to a family member (#p=joner-football-hat) opens the family card on that colour.
export function familyFor(handle: string): { handle: string; colour?: string } | null {
  for (const fam of SHOP_FAMILIES) {
    const m = fam.members.find((x) => x.handle === handle)
    if (m) return { handle: fam.handle, colour: m.colour }
  }
  return null
}

let cache: Promise<ShopProduct[]> | null = null

// Build-time read. Never throws: a Shopify hiccup gives an empty list and the pages fall back.
export function getShopProducts(): Promise<ShopProduct[]> {
  if (!cache) {
    cache = fetch(SHOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: PRODUCTS_QUERY }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(mapProducts)
      .catch(() => [])
  }
  return cache
}

export function money(n: number) {
  return `$${n.toFixed(2).replace(/\.00$/, '')}`
}

// "$35", "From $35" when sizes differ in price, with the old price struck through on a sale.
export function priceLabel(p: ShopProduct) {
  const from = p.variants.some((v) => v.price !== p.minPrice) ? 'From ' : ''
  return `${from}${money(p.minPrice)}${p.compareAt ? ` <s>${money(p.compareAt)}</s>` : ''}`
}

// What the card button says: "Pick your size", "Pick your colour" or "Add to bag".
export function pickLabel(p: ShopProduct) {
  if (!p.available) return 'Sold out'
  const first = p.options.find((o) => o.values.length > 1)
  if (!first) return 'Add to bag'
  const name = first.name.toLowerCase() === 'color' ? 'colour' : first.name.toLowerCase()
  return `Pick your ${name}`
}

// Card photos: an upright photo, and on hover the next one (a flat lay only when there is no second
// upright shot). With colours, the card starts on the first colour and hovers to the second
// (white tee, then black). Pass a colour to get that colour's two photos (the card's colour dots).
export function cardImages(p: ShopProduct, colour?: string) {
  const tall = p.images.filter((i) => !isWide(i))
  const wide = p.images.filter((i) => isWide(i))
  const pick = (list: ShopImage[], not?: ShopImage | null) => list.find((i) => i !== not) || null
  const opt = colourOption(p)
  if (opt) {
    const first = colour || opt.values[0]
    // Worn shots first, so the card and its hover match (white tee worn, then black tee worn).
    const worn = (list: ShopImage[]) => [...list.filter((i) => /\bworn\b/i.test(i.alt)), ...list.filter((i) => !/\bworn\b/i.test(i.alt))]
    const mine = worn(tall.filter((i) => showsColour(i, first)))
    const main = mine[0] || null
    if (main) {
      const next = colour ? pick(mine, main) || pick(p.images.filter((i) => showsColour(i, first)), main) : worn(tall.filter((i) => showsColour(i, opt.values[1])))[0]
      return { main, hover: next || pick(tall, main) }
    }
  }
  const main = tall[0] || wide[0] || null
  return { main, hover: pick(tall, main) || pick(wide, main) }
}

export const colourOption = (p: ShopProduct) => p.options.find((o) => COLOUR_RE.test(o.name) && o.values.length > 1) || null

// Colour dots: name, swatch colour, and the card photos for that colour.
export function colourSwatches(p: ShopProduct) {
  const opt = colourOption(p)
  if (!opt) return []
  return opt.values.map((value) => ({ value, hex: SWATCH_HEX[colourKey(value)] || '#999', limited: /limited/i.test(value), ...cardImages(p, value) }))
}

export const isWide = (i: { w?: number; h?: number } | null) => !!i && !!i.w && !!i.h && i.h < i.w

export type ShopCategory = 'tops' | 'bottoms' | 'headwear' | 'other'
export function categoryOf(p: ShopProduct): ShopCategory {
  if (p.tags.includes('headwear')) return 'headwear'
  if (p.tags.includes('bottoms')) return 'bottoms'
  if (p.tags.includes('tops')) return 'tops'
  return 'other'
}

export const isLimited = (p: ShopProduct) => p.tags.includes('limited-edition')

// "2 colours" under the name when a product comes in more than one.
export function colourNote(p: ShopProduct) {
  const c = p.options.find((o) => /^colou?r$/i.test(o.name))
  return c && c.values.length > 1 ? `${c.values.length} colours` : ''
}

// Shopify CDN images take a width parameter.
export function sized(url: string, width: number) {
  if (!url) return url
  return url + (url.includes('?') ? '&' : '?') + `width=${width}`
}

// The product's page on the Shopify store (shop.jonerfootball.com is the one apparel store, Lee 9 Nov 2026).
// A family card (several Shopify products shown as one) opens its first member.
export function shopUrl(handle: string) {
  const fam = SHOP_FAMILIES.find((f) => f.handle === handle)
  return `https://shop.jonerfootball.com/products/${fam ? fam.members[0].handle : handle}`
}
