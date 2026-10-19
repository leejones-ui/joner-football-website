// Coach pay rules (Lee, 20 Oct 2026), pure: the price of an invoice line from
// a rate card, the group and the register. Amounts here are invented.
//   node scripts/test-jfp-coach-pay-unit.mjs
import assert from 'node:assert/strict'
import { priceLine, checkCard, dueMonday } from '../api/_jfp-coach-pay.js'

const card = { bands: [4000, 4500, 5500, 6500, 7000, 7500, 8000], weekendExtra: 1000, pathwayFlat: 5000, jjHead: 5000, jjShadow: 4000 }
const group = { id: 'G', label: 'Small group' }
const reg = (n) => ({ marked: true, present: Array.from({ length: n }, (_, i) => ({ rowId: `r${i}`, name: `P${i}` })) })
const line = (o = {}) => ({ kind: 'session', minutes: 60, date: '2026-10-21', groupId: 'G', ...o })
let n = 0
const t = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`) }

t('players present pick the band; 7 or more is the top band; time counts', () => {
  assert.equal(priceLine(line(), { card, group, register: reg(1) }).cents, 4000)
  assert.equal(priceLine(line(), { card, group, register: reg(7) }).cents, 8000)
  assert.equal(priceLine(line(), { card, group, register: reg(12) }).cents, 8000)
  assert.equal(priceLine(line({ minutes: 90 }), { card, group, register: reg(3) }).cents, 8250)
})
t('absent players do not count; an unmarked register or nobody present waits for Lee', () => {
  assert.equal(priceLine(line(), { card, group, register: { marked: true, present: [] } }).cents, null)
  const r = priceLine(line(), { card, group, register: { marked: false, present: [] } })
  assert.equal(r.cents, null); assert.equal(r.flags[0].code, 'register')
})
t('weekend: an extra on ordinary JFP sessions only', () => {
  assert.equal(priceLine(line({ date: '2026-10-24' }), { card, group, register: reg(7) }).cents, 9000)
  assert.equal(priceLine(line({ date: '2026-10-25' }), { card, group, register: reg(2) }).cents, 5500)
})
t('Pathway: flat whatever the players, the time or the day', () => {
  const pw = { id: 'P', label: 'Pathway' }
  assert.equal(priceLine(line({ minutes: 45 }), { card, group: pw, register: reg(6) }).cents, 5000)
  assert.equal(priceLine(line({ minutes: 45, date: '2026-10-24' }), { card, group: pw, register: reg(2) }).cents, 5000)
  assert.equal(priceLine(line(), { card: { ...card, pathwayFlat: undefined }, group: pw, register: reg(6) }).cents, null, 'no Pathway rate: never the group rate')
})
t('Joners Juniors: no weekend extra; head and shadow differ, so Lee or Ligia confirm', () => {
  const jj = { id: 'J', label: 'Joners Juniors' }
  assert.equal(priceLine(line({ date: '2026-10-24' }), { card, group: jj, register: reg(9) }).flags[0].code, 'jj-role')
  assert.equal(priceLine(line({ kind: 'juniors', groupId: '' }), { card: { ...card, jjShadow: 5000 }, group: null, register: null }).cents, 5000)
})
t('camps are TBC; office and Dev Sesh only where agreed; no card, no guess', () => {
  assert.equal(priceLine(line({ kind: 'camp', groupId: '' }), { card, group: null, register: null }).flags[0].code, 'camp')
  assert.equal(priceLine(line({ kind: 'admin', groupId: '' }), { card, group: null, register: null }).cents, null)
  assert.equal(priceLine(line({ kind: 'admin', groupId: '', minutes: 300 }), { card: { ...card, office: 3000 }, group: null, register: null }).cents, 15000)
  assert.equal(priceLine(line({ kind: 'other', groupId: '', note: 'Dev Sesh' }), { card: { ...card, devSesh: 7000 }, group: null, register: null }).cents, 7000)
  assert.equal(priceLine(line(), { card: null, group, register: reg(3) }).cents, null)
})
t('a card needs all seven bands; empty boxes are not agreed; camps always TBC', () => {
  assert.ok(checkCard({ bands: [1, 2, 3] }).error)
  const c = checkCard({ bands: [4000, 4500, 5500, 6500, 7000, 7500, 8000], office: '', pathwayFlat: 5000 })
  assert.equal(c.office, undefined); assert.equal(c.pathwayFlat, 5000); assert.equal(c.camps, 'tbc')
})
t('due Monday: the coming Monday, or today on a Monday', () => {
  assert.equal(dueMonday('2026-10-21'), '2026-10-26'); assert.equal(dueMonday('2026-10-26'), '2026-10-26'); assert.equal(dueMonday('2026-10-25'), '2026-10-26')
})
console.log(`\n${n} passed`)
