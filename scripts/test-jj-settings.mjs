// Joners Juniors stage 1: the settings (config.juniors), the website sign-up,
// checkout, emails and webhook reading them, and the Juniors data layer.
// Invented data only.
//   node scripts/test-jj-settings.mjs
import assert from 'node:assert/strict'
import { JJ_DEFAULTS, normaliseJuniors, validateJuniors, juniorsDates, juniorsPublic, datesLabelOf, classLabelOf, capacityOf } from '../api/_jj-config.js'
import { normaliseConfig } from '../api/_jfp-store.js'
import { normaliseRegistration, stripeCheckoutForm, confirmationEmail, paidEventDetails, juniorsTerms } from '../api/_juniors-flow.js'
import { parseJJRecord, writeJJRow, tableFor, termTables, appendLine, parseRemoved, plain, isEnrolled } from '../api/_jj-data.js'
import { canonicalFromAirtable, airtableFieldsFromRegistration } from '../api/juniors-payment-webhook.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- settings ----------

await test('the defaults are Term 4 2026: ten Saturdays, 17 October to 19 December, A$220, Saturday 9:15am to 10:00am', () => {
  const jj = normaliseJuniors({})
  assert.equal(jj.term, 'Term 4 2026')
  const dates = juniorsDates(jj)
  assert.equal(dates.length, 10)
  assert.equal(dates[0], '2026-10-17'); assert.equal(dates.at(-1), '2026-12-19')
  assert.ok(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6), 'every one a Saturday')
  assert.equal(datesLabelOf(jj), '12 October 2026 to 19 December 2026', 'the school term, as the live page says')
  assert.equal(datesLabelOf(normaliseJuniors({ datesLabel: '' })), '17 October 2026 to 19 December 2026', 'blank = worked out from the classes')
  assert.equal(classLabelOf(jj), 'Saturday 9:15am to 10:00am')
  assert.equal(jj.priceCents, 22000)
  assert.equal(capacityOf(jj), 12)
  assert.equal(jj.tables['Term 4 2026'], 'tblVzW8E9qumQEtXx')
  assert.equal(normaliseConfig({}).juniors.term, 'Term 4 2026', 'part of the JFP config, from KV')
})

await test('the public view says Term 4 and never Term 3, with no private data', () => {
  const pub = juniorsPublic(JJ_DEFAULTS)
  assert.equal(pub.termDatesLine, 'Term 4: 12 October 2026 to 19 December 2026')
  assert.equal(pub.feeLine, '$220 for 10 weeks')
  assert.equal(pub.timeLabel, '9:15am to 10:00am')
  assert.equal(pub.registrationOpen, true)
  assert.ok(!/Term 3|25 July/.test(JSON.stringify(pub)))
  assert.ok(!JSON.stringify(pub).includes('tbl'), 'no table ids on the public page')
})

await test('skipped dates come out, weeks and the first class day are honoured', () => {
  const jj = normaliseJuniors({ termStart: '2027-01-29', weeks: 10, skipDates: [{ date: '2027-03-27', reason: 'Easter Saturday' }] })
  const d = juniorsDates(jj)
  assert.equal(d[0], '2027-01-30', 'the first Saturday on or after a Friday start')
  assert.equal(d.length, 9)
  assert.ok(!d.includes('2027-03-27'))
  assert.equal(juniorsPublic(jj).feeLine, '$220 for 9 weeks')
})

await test('a stored value that is wrong falls back on its own, never the whole lot', () => {
  const jj = normaliseJuniors({ priceCents: 'lots', weeks: 99, classes: [{ day: 'Funday', time: 'soon' }], tables: { 'Term 1 2027': 'not-a-table', 'Term 2 2027': 'tblAAAAAAAAAAAAAA' }, registrationOpen: false })
  assert.equal(jj.priceCents, 22000); assert.equal(jj.weeks, 10)
  assert.equal(jj.classes[0].day, 'Saturday')
  assert.equal(jj.tables['Term 1 2027'], undefined); assert.equal(jj.tables['Term 2 2027'], 'tblAAAAAAAAAAAAAA')
  assert.equal(jj.tables['Term 4 2026'], 'tblVzW8E9qumQEtXx', 'the known tables stay')
  assert.equal(jj.registrationOpen, false)
})

await test('a save from Settings says what is wrong', () => {
  assert.equal(validateJuniors({ priceCents: 50 }).ok, false)
  assert.equal(validateJuniors({ classes: [{ day: 'Saturday', time: '10am', endTime: '9am', capacity: 12 }] }).ok, false)
  const noTable = validateJuniors({ term: 'Term 1 2027' })
  assert.equal(noTable.ok, false); assert.match(noTable.errors.join(' '), /Airtable table for Term 1 2027/)
  const good = validateJuniors({ term: 'Term 1 2027', termStart: '2027-02-06', tables: { 'Term 1 2027': 'tblBBBBBBBBBBBBBB' }, priceCents: 24000 })
  assert.equal(good.ok, true); assert.equal(good.juniors.priceCents, 24000); assert.equal(good.juniors.tables['Term 4 2026'], 'tblVzW8E9qumQEtXx')
  const warn = validateJuniors({ termStart: '2026-10-12' })
  assert.equal(warn.ok, true); assert.match(warn.warnings[0], /Monday/)
})

// ---------- the website sign-up reads the settings ----------

const settings = normaliseJuniors({ term: 'Term 1 2027', termStart: '2027-02-06', weeks: 9, priceCents: 24000, classes: [{ day: 'Saturday', time: '9:30am', endTime: '10:15am', location: 'Belrose HQ', capacity: 14, coachId: 'sam' }], tables: { 'Term 1 2027': 'tblBBBBBBBBBBBBBB' } })
const body = { playerFullName: 'Pip Example', parentName: 'Pat Example', email: 'pat@example.com', mobile: '0400000000', dateOfBirth: '01/01/2021', heardAboutUs: 'Google', agreementAccepted: true }

await test('checkout: the price, term and class saved in the settings, with the amount in the metadata', () => {
  const reg = normaliseRegistration(body, new Date('2027-01-10T00:00:00Z'), settings)
  assert.equal(reg.className, 'Saturday 9:30am to 10:15am')
  assert.equal(reg.termDates, '6 February 2027 to 3 April 2027')
  const f = stripeCheckoutForm(reg, 'https://jonerfootball.com')
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '24000')
  assert.equal(f.get('line_items[0][price_data][product_data][name]'), 'Joners Juniors Term 1 2027')
  assert.equal(f.get('metadata[term]'), 'Term 1 2027'); assert.equal(f.get('metadata[amountCents]'), '24000')
  assert.equal(f.get('metadata[programme]'), 'Joners Juniors')
  const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', amount_total: 24000, currency: 'aud', metadata: Object.fromEntries([...f].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])) } } }
  assert.equal(paidEventDetails(ev).expectedCents, 24000); assert.equal(paidEventDetails(ev).term, 'Term 1 2027')
})

await test('the confirmation email says the saved term, dates, class, place and amount', () => {
  const reg = normaliseRegistration(body, new Date('2027-01-10T00:00:00Z'), settings)
  const html = confirmationEmail({ registration: reg })
  assert.match(html, /Saturday training runs from 9:30am to 10:15am at Joner Football HQ, Unit 2, 20 Narabang Way, Belrose\./)
  assert.match(html, /Term 1 runs from 6 February 2027 to 3 April 2027\./)
  assert.doesNotMatch(html, /Term 3|25 July|Term 4/)
  const inside = confirmationEmail({ registration: reg, internal: true })
  assert.match(inside, /AUD \$240\.00/)
  // A registration with none of the new fields (made before) reads with the defaults.
  const old = confirmationEmail({ registration: { player: 'Old', parent: 'P', className: 'Saturday 9:15am to 10:00am', termDates: '' } })
  assert.match(old, /Term 4 runs from 12 October 2026 to 19 December 2026/)
})

await test('the webhook writes the child in the same shape as rows staff add, mapped to the columns each table has', () => {
  const reg = { ...normaliseRegistration(body, new Date(), settings), registrationId: 'JJ-1' }
  const { set, note } = canonicalFromAirtable(airtableFieldsFromRegistration(reg, { paidAt: '2027-01-10T00:00:00Z', checkoutSessionId: 'cs_1', paymentIntentId: 'pi_1' }))
  assert.equal(set.term, 'Term 1 2027'); assert.equal(set.day, 'Saturday'); assert.equal(set.time, '9:30am'); assert.equal(set.location, 'Belrose HQ')
  assert.equal(set.fee, 240); assert.equal(set.registrationId, 'JJ-1'); assert.equal(set.sessionId, 'cs_1'); assert.equal(set.intentId, 'pi_1')
  assert.equal(note, 'Joners Juniors paid signup')
  assert.equal(juniorsTerms(settings).coachId, 'sam')
})

// ---------- the data layer ----------

await test('a row reads the same from either term table, ids from the notes when there is no column', () => {
  const t4 = parseJJRecord({ id: 'recAAAAAAAAAAAAAA', fields: { 'Player Full Name': 'Kai Example', 'Parent Email': 'Kai.Parent@Example.com', Term: 'Term 4 2026', Fee: 220, 'Payment Status': 'Unpaid', Notes: '2026-10-13: Medical: none\n2026-10-14: Medical: Peanuts\n2026-10-13: [JJ-REG:JJ-9] [JJ-CS:cs_9] [JJ-PI:pi_9]' } }, 'tblT4')
  assert.equal(t4.email, 'kai.parent@example.com'); assert.equal(t4.feeCents, 22000)
  assert.equal(t4.registrationId, 'JJ-9'); assert.equal(t4.sessionId, 'cs_9'); assert.equal(t4.intentId, 'pi_9')
  assert.equal(t4.medical, 'Peanuts', 'the newest medical line')
  const t3 = parseJJRecord({ id: 'recBBBBBBBBBBBBBB', fields: { 'Player Full Name': 'Lu Example', 'Date of Birth': '05/03/2020', 'Registration ID': 'JJ-3', 'Internal Notes': 'old note' } }, 'tblT3', 'Term 3 2026')
  assert.equal(t3.term, 'Term 3 2026', 'the table\'s term when the row has none'); assert.equal(t3.dob, '2020-03-05'); assert.equal(t3.registrationId, 'JJ-3'); assert.equal(t3.notes, 'old note')
})

await test('soft remove: the tag says who, why and when; a note cannot fake a tag', () => {
  const notes = '2026-10-20: Removed by Ligia: Moved away. Going overseas. [JJ-REMOVED:2026-10-20]'
  assert.deepEqual(parseRemoved(notes), { at: '2026-10-20', by: 'Ligia', reason: 'Moved away. Going overseas' })
  assert.equal(isEnrolled(parseJJRecord({ id: 'recCCCCCCCCCCCCCC', fields: { Notes: notes } })), false)
  assert.equal(plain('nice [JJ-REMOVED:2026-01-01] note'), 'nice JJ-REMOVED:2026-01-01 note')
})

await test('writing leaves out a column the table does not have, keeps the value in the notes, and remembers', async () => {
  const have = new Set(['Player Full Name', 'Term', 'Fee', 'Notes'])
  const calls = []
  const store = new Map([['recDDDDDDDDDDDDDD', { 'Player Full Name': 'Mo', Notes: '2026-10-01: first' }]])
  const fake = async (path, init = {}) => {
    calls.push({ path, init })
    if (!init.method) { const id = path.split('/')[1]; return { id, fields: store.get(id) || {} } }
    const recs = init.body.records
    const bad = recs.flatMap((r) => Object.keys(r.fields)).find((k) => !have.has(k))
    if (bad) throw new Error(`Airtable 422: Unknown field name: "${bad}"`)
    if (init.method === 'POST') return { records: [{ id: 'recNEWNEWNEWNEWNE', fields: recs[0].fields }] }
    for (const r of recs) store.set(r.id, { ...store.get(r.id), ...r.fields })
    return { records: recs }
  }
  const missing = new Set()
  const id = await writeJJRow('tblX', { set: { player: 'New Kid', term: 'Term 4 2026', fee: 220, medical: 'Asthma', registrationId: 'JJ-7', heard: 'Friend' }, note: 'Added in a test' }, { airtable: fake, missing, bust: async () => {} })
  assert.equal(id, 'recNEWNEWNEWNEWNE')
  const sent = calls.at(-1).init.body.records[0].fields
  assert.deepEqual(Object.keys(sent).sort(), ['Fee', 'Notes', 'Player Full Name', 'Term'])
  assert.match(sent.Notes, /Added in a test\n.*Medical: Asthma\n.*Heard about us: Friend\n.*\[JJ-REG:JJ-7\]/)
  assert.ok(missing.has('Medical History / Allergies') && missing.has('Registration ID'))
  // A change adds to the notes already there, never writes over them.
  await writeJJRow('tblX', { id: 'recDDDDDDDDDDDDDD', set: { fee: 240 }, note: 'Fee changed' }, { airtable: fake, missing, bust: async () => {} })
  assert.match(store.get('recDDDDDDDDDDDDDD').Notes, /^2026-10-01: first\n.*Fee changed$/)
  assert.equal(store.get('recDDDDDDDDDDDDDD').Fee, 240)
  // A second parent's email with no column: kept in the notes, read back, and clearable.
  await writeJJRow('tblX', { id: 'recDDDDDDDDDDDDDD', set: { email2: 'second@example.com' } }, { airtable: fake, missing, bust: async () => {} })
  assert.deepEqual(parseJJRecord({ id: 'recDDDDDDDDDDDDDD', fields: store.get('recDDDDDDDDDDDDDD') }).emails, ['second@example.com'])
  await writeJJRow('tblX', { id: 'recDDDDDDDDDDDDDD', set: { email2: null } }, { airtable: fake, missing, bust: async () => {} })
  assert.deepEqual(parseJJRecord({ id: 'recDDDDDDDDDDDDDD', fields: store.get('recDDDDDDDDDDDDDD') }).emails, [])
  // Any other Airtable error is not swallowed.
  await assert.rejects(writeJJRow('tblX', { set: { player: 'X' } }, { airtable: async () => { throw new Error('Airtable 503: busy') }, missing: new Set(), bust: async () => {} }), /503/)
})

await test('notes never lose a tag when they get long', () => {
  let n = '2026-10-01: [JJ-REG:JJ-KEEP]'
  for (let i = 0; i < 400; i++) n = appendLine(n, `line ${i} `.repeat(8), '2026-10-02')
  assert.ok(n.length <= 20000); assert.ok(n.includes('[JJ-REG:JJ-KEEP]'))
})

await test('which table: the settings first, the old single-table setting only for the current term', () => {
  const config = normaliseConfig({ juniors: { tables: { 'Term 1 2027': 'tblBBBBBBBBBBBBBB' } } })
  assert.equal(tableFor(config), 'tblVzW8E9qumQEtXx')
  assert.equal(tableFor(config, 'Term 3 2026'), 'tblMLhYQ126P5uKLB')
  assert.equal(tableFor(config, 'Term 9 2030'), '')
  assert.deepEqual(termTables(config).map((x) => x.term), ['Term 1 2027', 'Term 4 2026', 'Term 3 2026'])
})

console.log(`\n${passed} Joners Juniors settings and data checks passed`)
