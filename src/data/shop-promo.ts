// The "Joner kit" strips on the home page, blog posts, /training, /camps and /about.
// ON since 9 Nov 2026: Shopify checkout reaches the card payment step (it was "This store isn't set
// up to receive orders yet" earlier that day). Never on the app pages (Lee: they compete).
export const SHOP_STRIPS_ON = true

// Black Friday (or any sale) banner for the Joner kit strips and the apparel page.
// OFF until Lee gives the real offer: set `on: true`, the words, and the Sydney start and end.
// The page hides it outside the dates by itself, so it can be set up early.
// Never promise a discount here that is not set up in Shopify first.
export const SHOP_PROMO = {
  on: false,
  startsAt: '2026-11-27T00:00:00+11:00',
  endsAt: '2026-12-01T23:59:00+11:00',
  label: 'Black Friday',
  headline: '',
  code: '',
}
