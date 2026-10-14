// The extra session prices Lee and Ligia set (config.extraPrices). Coaches
// pick one of these for an extra session; they never type their own amount.
import { clean, newId } from './_holiday-store.js'

const PRICE_ID = /^XP-[0-9A-Za-z-]{4,40}$/

// [{ id, label, cents, durationMin }] in config.extraPrices.
export function cleanExtraPrices(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const x of list.slice(0, 40)) {
    const id = PRICE_ID.test(x?.id || '') ? x.id : ''
    const label = clean(x?.label, 60)
    const cents = Number(x?.cents)
    const durationMin = Number(x?.durationMin) || 60
    if (!id || seen.has(id) || !label || !Number.isInteger(cents) || cents < 100 || cents > 200000 || durationMin < 15 || durationMin > 240) continue
    seen.add(id)
    out.push({ id, label, cents, durationMin, archived: x.archived === true })
  }
  return out
}
export function newExtraPrice(input) {
  const [p] = cleanExtraPrices([{ ...input, id: newId('XP') }])
  return p || null
}

