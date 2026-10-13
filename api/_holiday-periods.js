// NSW government school holidays, Eastern division (Sydney), for holiday
// training money (Lee, 13 Oct 2026). Public dates from the NSW Department of
// Education term calendar, not revenue.
//
// start/end: the official holidays. from/to: the whole break the children are
// off school, from the day after one term ends to the day before the next
// starts (weekends, Easter and staff development days included), which is
// what a session date or a bank date is checked against. Pure, no network.

export const OTHER = 'other'
export const OTHER_LABEL = 'Other dates'

// [id, label, official start, official end, break from, break to]
const RAW = [
  ['2023-summer', 'Summer holidays 2023–24', '2023-12-20', '2024-01-29', '2023-12-20', '2024-01-29'],
  ['2024-autumn', 'Autumn holidays 2024', '2024-04-15', '2024-04-26', '2024-04-13', '2024-04-28'],
  ['2024-winter', 'Winter holidays 2024', '2024-07-08', '2024-07-19', '2024-07-06', '2024-07-21'],
  ['2024-spring', 'Spring holidays 2024', '2024-09-30', '2024-10-11', '2024-09-28', '2024-10-13'],
  ['2024-summer', 'Summer holidays 2024–25', '2024-12-23', '2025-01-30', '2024-12-21', '2025-01-30'],
  ['2025-autumn', 'Autumn holidays 2025', '2025-04-14', '2025-04-24', '2025-04-12', '2025-04-27'],
  ['2025-winter', 'Winter holidays 2025', '2025-07-07', '2025-07-18', '2025-07-05', '2025-07-20'],
  ['2025-spring', 'Spring holidays 2025', '2025-09-29', '2025-10-10', '2025-09-27', '2025-10-12'],
  ['2025-summer', 'Summer holidays 2025–26', '2025-12-22', '2026-01-26', '2025-12-20', '2026-02-01'],
  ['2026-autumn', 'Autumn holidays 2026', '2026-04-07', '2026-04-17', '2026-04-03', '2026-04-21'],
  ['2026-winter', 'Winter holidays 2026', '2026-07-06', '2026-07-17', '2026-07-04', '2026-07-20'],
  ['2026-spring', 'Spring holidays 2026', '2026-09-28', '2026-10-09', '2026-09-26', '2026-10-12'],
  ['2026-summer', 'Summer holidays 2026–27', '2026-12-18', '2027-01-27', '2026-12-18', '2027-01-27'],
  ['2027-autumn', 'Autumn holidays 2027', '2027-04-12', '2027-04-23', '2027-04-10', '2027-04-26'],
  ['2027-winter', 'Winter holidays 2027', '2027-07-05', '2027-07-16', '2027-07-03', '2027-07-18'],
  ['2027-spring', 'Spring holidays 2027', '2027-09-27', '2027-10-08', '2027-09-25', '2027-10-10'],
  ['2027-summer', 'Summer holidays 2027–28', '2027-12-21', '2028-01-28', '2027-12-21', '2028-01-30'],
]
export const HOLIDAY_PERIODS = RAW.map(([id, label, start, end, from, to]) => ({ id, label, start, end, from, to }))
// A bank date this many days before a holiday counts as paying for it.
export const EARLY_DAYS = 10
// A bank date this many days after a holiday is suggested as paying for it (paid after the session).
export const LATE_DAYS = 21

const ISO = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`)
export const addDays = (iso, n) => new Date(dayMs(iso) + n * 86400000).toISOString().slice(0, 10)

export const periodById = (id) => HOLIDAY_PERIODS.find((p) => p.id === id) || null
export const isPeriodId = (id) => id === OTHER || Boolean(periodById(id))
export const periodLabel = (id) => (id === OTHER ? OTHER_LABEL : periodById(id)?.label || '')

// The holiday a session on this date is in, or OTHER.
export function periodOf(date) {
  if (!ISO.test(date || '')) return OTHER
  return HOLIDAY_PERIODS.find((p) => date >= p.from && date <= p.to)?.id || OTHER
}

// The holiday a bank transfer on this date most likely paid for: the one it
// is in, else one starting within EARLY_DAYS, else one that ended within
// LATE_DAYS (paid after training), else OTHER. how says which.
export function suggestPeriod(date) {
  if (!ISO.test(date || '')) return { id: OTHER, how: 'none' }
  const inside = periodOf(date)
  if (inside !== OTHER) return { id: inside, how: 'inside' }
  const soon = HOLIDAY_PERIODS.find((p) => date < p.from && date >= addDays(p.from, -EARLY_DAYS))
  if (soon) return { id: soon.id, how: 'before' }
  const after = [...HOLIDAY_PERIODS].reverse().find((p) => date > p.to && date <= addDays(p.to, LATE_DAYS))
  if (after) return { id: after.id, how: 'after' }
  return { id: OTHER, how: 'none' }
}

// Inside a holiday or up to EARLY_DAYS before one: the window for the
// "Looks like holiday training" hint.
export function nearHoliday(date) {
  const s = suggestPeriod(date)
  return s.how === 'inside' || s.how === 'before'
}

// The holidays to pick from, newest first, up to `today` plus the next one
// coming, with Other dates last. Holidays further ahead are left out.
export function pickablePeriods(today) {
  const t = ISO.test(today || '') ? today : new Date().toISOString().slice(0, 10)
  const started = HOLIDAY_PERIODS.filter((p) => p.from <= t)
  const next = HOLIDAY_PERIODS.find((p) => p.from > t)
  return [...(next ? [next] : []), ...started.reverse()]
}

// "6 to 17 Jul 2026"
export function rangeLabel(p) {
  if (!p) return ''
  const f = (iso, withYear) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${iso}T00:00:00Z`))
  return `${f(p.start, p.start.slice(0, 4) !== p.end.slice(0, 4))} to ${f(p.end, true)}`
}

// Every amount a holiday booking could cost: each price per player (the
// config's and every slot's own), for 1 to 3 players. Under A$20 is a test
// price, never a real one.
export function holidayPriceSizes(prices = {}, slotPrices = []) {
  const units = new Set()
  for (const tier of Object.values(prices || {})) for (const c of Object.values(tier || {})) if (Number.isInteger(c) && c >= 2000) units.add(c)
  for (const c of slotPrices) if (Number.isInteger(c) && c >= 2000) units.add(c)
  const sizes = new Set()
  for (const u of units) for (const n of [1, 2, 3]) sizes.add(u * n)
  return sizes
}
