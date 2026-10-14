// Programmes and Lee's own prices (config.customPrices), cleaned the same way
// when they are saved and when the config is read. A leaf module: the JFP
// store imports it, so it imports nothing from the store.
import { clean } from './_holiday-store.js'

// Pro sessions (Lee, 13 Oct 2026): the Pro group, paid session by session.
// Its own Money view; never JFP term income (see docs/jfp-players.md).
// Extra sessions (Lee, 14 Oct 2026): sessions and video analysis charged to a
// player on top of their term (api/_jfp-charges.js). Its own Money view;
// never JFP term income (docs/jfp-charges.md).
export const PROGRAMMES = [['jfp', 'JFP'], ['pro', 'Pro sessions'], ['extra', 'Extra sessions'], ['juniors', 'Joners Juniors'], ['holiday', 'Holiday training'], ['other', 'Other']]
const LABELS = Object.fromEntries(PROGRAMMES)
export const isProgramme = (p) => Object.hasOwn(LABELS, p)
export const programmeLabel = (p) => LABELS[p] || LABELS.jfp
// What the Joners Juniors money already reads from Stripe (its own tag).
export const JUNIORS_TAG = 'Joners Juniors'

export const PRICE_MIN = 100 // A$1
export const PRICE_MAX = 2000000 // A$20,000, as for any payment recorded
export const PRICES_MAX = 500
const ID = /^PR-[0-9A-Za-z-]{4,40}$/

// ---------- prices ----------

// One of Lee's own prices, from the form. { ok, price } or { ok: false, error }.
export function cleanPrice(input = {}, { id = '', now = new Date().toISOString(), before = null } = {}) {
  const name = clean(input.name, 80)
  if (!name) return { ok: false, error: 'Give the price a name.' }
  const cents = Number(input.amountCents ?? input.cents)
  if (!Number.isInteger(cents) || cents < PRICE_MIN || cents > PRICE_MAX) return { ok: false, error: 'Enter an amount from A$1 to A$20,000.' }
  const programme = isProgramme(input.programme) ? input.programme : ''
  if (!programme) return { ok: false, error: 'Pick the program: JFP, Pro sessions, Extra sessions, Joners Juniors, Holiday training or Other.' }
  return { ok: true, price: { id: id || before?.id, name, cents, programme, description: clean(input.description, 300), perSession: input.perSession === true, archived: before?.archived === true, createdAt: before?.createdAt || now, updatedAt: now } }
}

// config.customPrices as saved: anything broken is dropped, never guessed.
export function cleanCustomPrices(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const x of list.slice(0, PRICES_MAX)) {
    const id = clean(x?.id, 44)
    if (!ID.test(id) || seen.has(id)) continue
    const r = cleanPrice(x, { id, now: clean(x.updatedAt, 30) || new Date().toISOString(), before: { id, archived: x.archived === true, createdAt: clean(x.createdAt, 30) } })
    if (!r.ok) continue
    seen.add(id)
    out.push(r.price)
  }
  return out
}

