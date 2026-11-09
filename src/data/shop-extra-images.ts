// Site-only photos added to Shopify's own, and products the site shows as one card.
// The Shopify product photos stay the source of truth; these fill gaps until clean product shots
// are uploaded to Shopify (the Shopify agent's lane). Files live in public/images/shop/apparel/,
// made from Lee's Joner Apparel Studio (Codex) review batch of 9 Nov 2026, product-only shots first.

export interface ExtraImage {
  url: string
  alt: string
  w: number
  h: number
  colour?: string
}

const img = (file: string, alt: string, colour?: string): ExtraImage => ({ url: `/images/shop/apparel/${file}`, alt, w: 1200, h: 1500, colour })

// Shown straight after the first Shopify photo, so a product shot is the second thing people see.
export const SHOP_EXTRA_IMAGES: Record<string, ExtraImage[]> = {
  'joner-football-shorts-black': [
    img('08-flat-lay.webp', 'Joner Football shorts in black, flat lay'),
    img('26-shorts-bench.webp', 'Joner Football shorts in black, product shot'),
  ],
  'joner-football-hoodie-black': [img('09-hanger.webp', 'Joner Football hoodie in black, on a hanger')],
  'joner-football-essential-tee': [img('10-locker-room.webp', 'Joner Football Essential Tee in black, on a hanger', 'Black')],
  'joner-football-hat': [img('29-cap-sculpture.webp', 'Joner Football cap in black, product shot', 'Black')],
}

// Several Shopify products sold as one card with a colour choice (Lee, 9 Nov 2026: one cap card,
// the limited editions and their own prices inside it). `colour` names a member that has no colour
// option of its own; a member with a Color option keeps its own colour names.
export interface ShopFamily {
  handle: string
  title: string
  type: string
  members: { handle: string; colour?: string }[]
}

export const SHOP_FAMILIES: ShopFamily[] = [
  {
    handle: 'joner-football-cap',
    title: 'Joner Football Cap',
    type: 'Hats',
    members: [
      { handle: 'joner-football-hat' },
      { handle: 'joner-football-limited-edition-cap-off-white', colour: 'Off White (Limited)' },
      { handle: 'joner-football-limited-edition-cap-red', colour: 'Red (Limited)' },
    ],
  },
]

// Swatch colours for the dots on cards and in the product sheet.
export const SWATCH_HEX: Record<string, string> = {
  black: '#111111',
  white: '#ffffff',
  tan: '#c9b38f',
  'off white': '#ece6d8',
  red: '#a8182b',
}
