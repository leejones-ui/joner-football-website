// Joner apparel from Shopify, read through the public Storefront API (tokenless access:
// products, collections and carts only, no secrets). Pages render these at build time so the
// HTML has real products; src/scripts/jf-shop.ts then re-reads them in the browser so price and
// stock are live, and checks out through a Shopify cart.
// When shop.jonerfootball.com is connected in Shopify, checkout URLs follow it automatically.

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

export interface ShopProduct {
  handle: string
  title: string
  type: string
  description: string
  images: { url: string; alt: string }[]
  options: { name: string; values: string[] }[]
  variants: ShopVariant[]
  available: boolean
  minPrice: number
  compareAt: number | null
}

export const PRODUCTS_QUERY = `{
  products(first: 50, sortKey: BEST_SELLING) {
    nodes {
      handle title productType description availableForSale
      images(first: 6) { nodes { url altText } }
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
  return nodes.map((p: any) => {
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
      images: (p.images?.nodes || []).map((i: any) => ({ url: i.url, alt: i.altText || p.title })),
      options: (p.options || [])
        .map((o: any) => ({ name: o.name, values: (o.optionValues || []).map((v: any) => v.name) }))
        .filter((o: any) => !(o.name === 'Title' && o.values.length === 1 && o.values[0] === 'Default Title')),
      variants,
      available: !!p.availableForSale,
      minPrice,
      compareAt: cheapest?.compareAt && cheapest.compareAt > minPrice ? cheapest.compareAt : null,
    }
  })
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

// Shopify CDN images take a width parameter.
export function sized(url: string, width: number) {
  if (!url) return url
  return url + (url.includes('?') ? '&' : '?') + `width=${width}`
}
