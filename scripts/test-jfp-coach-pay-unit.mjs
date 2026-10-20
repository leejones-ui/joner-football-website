// Coach pay rules (Lee, 20 Oct 2026), pure: the price of an invoice line from
// a rate card, the group and the register. Amounts here are invented.
//   node scripts/test-jfp-coach-pay-unit.mjs
import assert from 'node:assert/strict'
import { priceLine, checkCard, dueMonday, paidUpfront } from '../api/_jfp-coach-pay.js'
import { editLine, newLine } from '../api/_jfp-coach-invoices.js'
import { checkPlayers, shortNames } from '../api/_jfp-hours.js'

const card = { bands: [4000, 4500, 5500, 6500, 7000, 7500, 8000], weekendExtra: 1000, pathwayFlat: 5000, jjHead: 5000, jjShadow: 4000 }
const group = { id: 'G', label: 'Small group' }
const reg = (n) => { const present = Array.from({ length: n }, (_, i) => ({ rowId: `r${i}`, name: `P${i}` })); return { marked: true, present, paidAway: [], counted: present } }
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
  assert.equal(priceLine(line(), { card, group, register: { marked: true, present: [], counted: [] } }).cents, null)
  const r = priceLine(line(), { card, group, register: { marked: false, present: [], counted: [] } })
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
t('Joners Juniors: one hourly rate, head or shadow, no weekend extra', () => {
  const jj = { id: 'J', label: 'Joners Juniors' }
  assert.equal(priceLine(line({ date: '2026-10-24' }), { card, group: jj, register: reg(9) }).cents, 5000)
  assert.equal(priceLine(line({ kind: 'juniors', groupId: '', minutes: 90 }), { card, group: null, register: null }).cents, 7500)
})
t('paid upfront and away still counts; ticked players price it and differ from the register as a flag', () => {
  const r = reg(2); r.counted = [...r.present, { rowId: 'x', name: 'Away', mark: 'Absent' }]
  assert.equal(priceLine(line(), { card, group, register: r }).cents, 5500, '3 players')
  const ticked = priceLine(line({ players: [{ rowId: 'a' }, { rowId: 'b' }, { rowId: 'c' }, { rowId: 'd' }] }), { card, group, register: r })
  assert.equal(ticked.cents, 6500); assert.equal(ticked.flags[0].code, 'register-diff')
  const unmarked = priceLine(line({ players: [{ name: 'A' }] }), { card, group, register: { marked: false, counted: [] } })
  assert.equal(unmarked.cents, 4000); assert.equal(unmarked.flags[0].code, 'register')
  assert.equal(paidUpfront({ paymentType: 'JFP 10 weeks', paymentStatus: 'Paid' }), true)
  assert.equal(paidUpfront({ paymentType: 'JFP Session by session', paymentStatus: 'Paid' }), false)
  assert.equal(paidUpfront({ paymentType: 'JFP Trial', paymentStatus: 'Paid' }), false)
  assert.equal(paidUpfront({ paymentType: 'JFP 10 weeks', paymentStatus: 'Unpaid' }), false)
})
t('ticked players: names from the session list only; typed names allowed; first names made unique', () => {
  const out = checkPlayers([{ rowId: 'r1', name: 'Hacker' }, { rowId: 'zz' }, { name: ' Guest ' }, { rowId: 'r1' }], new Map([['r1', 'Leo']]))
  assert.deepEqual(out, [{ rowId: 'r1', name: 'Leo' }, { rowId: '', name: 'Guest' }])
  const m = shortNames([{ id: 'a', player: 'Leo Smith' }, { id: 'b', player: 'Leo Brown' }, { id: 'c', player: 'Ava Jones' }])
  assert.deepEqual([m.get('a'), m.get('b'), m.get('c')], ['Leo S', 'Leo B', 'Ava'])
})
t('editable lines: a changed amount keeps what was worked out and is flagged; an added line is flagged', () => {
  const l = { hoursId: 'h', date: '2026-10-21', minutes: 60, cents: 4000, description: '1on1: Leo', flags: [] }
  const same = editLine(l, { cents: 4000, description: '1on1: Leo' }, { by: 'c', role: 'coach' })
  assert.equal(same.flags.length, 0)
  const x = editLine(l, { cents: 6000 }, { by: 'c', role: 'coach' })
  assert.equal(x.cents, 6000); assert.equal(x.calcCents, 4000); assert.equal(x.flags[0].code, 'edited')
  assert.ok(editLine(l, { minutes: 0 }, { by: 'c', role: 'coach' }).error)
  const tbc = editLine({ ...l, cents: null, flags: [{ code: 'camp', text: 'x' }] }, { cents: 20000 }, { by: 'a', role: 'admin' })
  assert.deepEqual(tbc.flags.map((f) => f.code), ['edited'])
  assert.ok(newLine({ date: '2026-11-30', description: 'x' }, { by: 'c', role: 'coach', from: '2026-10-19', to: '2026-10-25' }).error)
  assert.equal(newLine({ date: '2026-10-20', description: 'Dev Sesh: Leo', minutes: 60, cents: 7000 }, { by: 'c', role: 'coach', from: '2026-10-19', to: '2026-10-25' }).flags[0].code, 'added')
})
t('camps are TBC; office and Dev Sesh only where agreed; no card, no guess', () => {
  assert.equal(priceLine(line({ kind: 'camp', groupId: '' }), { card, group: null, register: null }).flags[0].code, 'camp')
  assert.equal(priceLine(line({ kind: 'admin', groupId: '' }), { card, group: null, register: null }).cents, null)
  assert.equal(priceLine(line({ kind: 'admin', groupId: '', minutes: 300 }), { card: { ...card, office: 3000 }, group: null, register: null }).cents, 15000)
  assert.equal(priceLine(line({ kind: 'other', groupId: '', note: 'Dev Sesh', minutes: 90 }), { card: { ...card, devSesh: 7000 }, group: null, register: null }).cents, 7000, 'flat per Dev Sesh')
  assert.equal(priceLine(line({ kind: 'devsesh', groupId: '', minutes: 30 }), { card: { ...card, devSesh: 7000 }, group: null, register: null }).cents, 7000)
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
