// Bank transfers to check: the bank CSV reader, the name tidy-up, the scores,
// the grades and the matcher. No network; every name and amount is invented.
import assert from 'node:assert/strict'
import { parseBankCsv, bankDate, bankCents, csvCells } from '../src/scripts/jfp-bank-csv.js'
import { nameTokens, peopleIn, personScore, rowScore, amountFit, gradeOf, notFamily, matchBank, cleanItem, csvId, similarity, EXTERNAL_ID } from '../api/_jfp-bank-match.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }

test('bank CSV: the CommBank export (no header, Date, Amount, Description, Balance), credits only', () => {
  const text = [
    '10/10/2026,"+850.00","Fast Transfer From M Featherstone JFP Ollie","+5850.00"',
    '09/10/2026,"-12.00","Card purchase Cones R Us","+5000.00"',
    '08/10/2026,"+425.00","Transfer from Q Zanzibarre, Term 4","+5012.00"',
    '',
  ].join('\r\n')
  const r = parseBankCsv(text)
  assert.equal(r.error, '')
  assert.equal(r.rows, 3)
  assert.deepEqual(r.lines, [
    { date: '2026-10-10', cents: 85000, description: 'Fast Transfer From M Featherstone JFP Ollie' },
    { date: '2026-10-08', cents: 42500, description: 'Transfer from Q Zanzibarre, Term 4' },
  ])
})

test('bank CSV: a header row, other column orders, separate credit and debit columns, tabs and odd numbers', () => {
  const withHeader = 'Description,Date,Balance,Amount\n"Fast Transfer From A Brightwater",2026-10-03,"1,200.00",$850\nATM,2026-10-02,350.00,-50.00\n'
  assert.deepEqual(parseBankCsv(withHeader).lines, [{ date: '2026-10-03', cents: 85000, description: 'Fast Transfer From A Brightwater' }])
  const split = 'Date,Narrative,Debit,Credit,Balance\n03 Oct 2026,Transfer from T Ironbark,,425.50,900.00\n02 Oct 2026,Rent,300.00,,474.50\n'
  assert.deepEqual(parseBankCsv(split).lines, [{ date: '2026-10-03', cents: 42550, description: 'Transfer from T Ironbark' }])
  // No header, the balance first and then the amount: the balance moves by the amount.
  const swapped = ['"+1000.00",01/10/2026,"+100.00","Transfer from P Quill"', '"+1850.00",02/10/2026,"+850.00","Fast Transfer From R Stonebridge"', '"+1800.00",03/10/2026,"-50.00","Bank fee"'].join('\n')
  assert.deepEqual(parseBankCsv(swapped).lines.map((l) => [l.date, l.cents, l.description]), [['2026-10-02', 85000, 'Fast Transfer From R Stonebridge'], ['2026-10-01', 10000, 'Transfer from P Quill']])
  const tabs = '5/10/26\t+85.00\tTransfer from J Larkspur\t+100.00\n'
  assert.deepEqual(parseBankCsv(tabs).lines, [{ date: '2026-10-05', cents: 8500, description: 'Transfer from J Larkspur' }])
  assert.deepEqual(csvCells('a,"b, ""c""",d\n"x\ny",z'), [['a', 'b, "c"', 'd'], ['x\ny', 'z']])
  for (const [v, c] of [['+850.00', 85000], ['-12.00', -1200], ['$1,234.50', 123450], ['A$85', 8500], ['(12.00)', -1200], ['850.5', 85050], ['12.00 CR', 1200], ['abc', null], ['', null], ['1,23', null]]) assert.equal(bankCents(v), c, v)
  for (const [v, d] of [['12/10/2026', '2026-10-12'], ['1/2/26', '2026-02-01'], ['2026-10-12', '2026-10-12'], ['12 Oct 2026', '2026-10-12'], ['31/02/2026', ''], ['hello', '']]) assert.equal(bankDate(v), d, v)
  assert.match(parseBankCsv('').error, /empty/)
  assert.match(parseBankCsv('a,b\nc,d\n').error, /dates/)
  assert.match(parseBankCsv('01/10/2026,"-5.00",Fee,"+1.00"\n').error, /No money in/)
})

test('names: bank words, titles and punctuation go, glued capitals split; the people on a row', () => {
  assert.deepEqual(nameTokens('Fast Transfer From MR J. SMITH-JONES'), ['j', 'smith', 'jones'])
  assert.deepEqual(nameTokens('NetBank Transfer from JaneFeatherstone'), ['jane', 'featherstone'])
  assert.deepEqual(nameTokens("Mrs Ngaio O'Brien"), ['ngaio', 'o', 'brien'])
  assert.deepEqual(peopleIn('Mia & Tom Featherstone'), [{ first: 'mia', last: 'featherstone' }, { first: 'tom', last: 'featherstone' }])
  assert.deepEqual(peopleIn('Ann Larkspur / Ben Quill'), [{ first: 'ann', last: 'larkspur' }, { first: 'ben', last: 'quill' }])
  assert.deepEqual(peopleIn('Ollie and Ruby Brightwater'), [{ first: 'ollie', last: 'brightwater' }, { first: 'ruby', last: 'brightwater' }])
  assert.deepEqual(peopleIn(''), [])
  assert.ok(similarity('featherstone', 'featherston') >= 0.86)
  assert.ok(similarity('smith', 'smyth') < 0.86)
})

test('scores: 3 surname and first name or initial, 2 surname, 1 weak; the bank cuts long names short', () => {
  const p = { first: 'mia', last: 'featherstone' }
  assert.equal(personScore(nameTokens('Fast Transfer From Mia Featherstone'), p), 3)
  assert.equal(personScore(nameTokens('M FEATHERSTONE'), p), 3)
  assert.equal(personScore(nameTokens('T Featherstone'), p), 2)
  assert.equal(personScore(nameTokens('Fast Transfer From Mia Feathers'), p), 3, 'cut at 16 letters: the last word starts the surname')
  assert.equal(personScore(nameTokens('Transfer from Mia Feath'), p), 3)
  assert.equal(personScore(nameTokens('Transfer from Mia Fea'), p), 1, 'too short to count as the surname: first name only')
  assert.equal(personScore(nameTokens('K Fetherstone'), p), 1, 'a near spelling is weak')
  assert.equal(personScore(nameTokens('Mia Quill'), p), 1)
  assert.equal(personScore(nameTokens('Zed Quill'), p), 0)
  const row = { player: 'Ollie Featherstone', parent: 'Mia Featherstone' }
  assert.deepEqual(rowScore({ payer: 'M Featherstone', description: '' }, row), { score: 3, why: 'name matches the parent' })
  assert.deepEqual(rowScore({ payer: 'T Featherstone', description: '' }, row), { score: 2, why: 'surname matches the parent' })
  assert.deepEqual(rowScore({ payer: 'K Quill', description: 'Fees for Ollie Featherstone' }, row), { score: 3, why: 'the reference names the player' })
  assert.deepEqual(rowScore({ payer: 'K Quill', description: '' }, row), { score: 0, why: '' })
})

test('amounts and grades: exact on owing, fee, family total or 2x / 3x the fee', () => {
  const row = { owingCents: 45000, feeCents: 85000 }
  assert.equal(amountFit(45000, row, 45000), "amount = what's owing")
  assert.equal(amountFit(85000, row, 45000), 'amount = the fee')
  assert.equal(amountFit(130000, row, 130000), "amount = the family's total owing")
  assert.equal(amountFit(170000, row, 45000), 'amount = 2 x the fee')
  assert.equal(amountFit(255000, row, 45000), 'amount = 3 x the fee')
  assert.equal(amountFit(1000, row, 45000), '')
  assert.equal(gradeOf(3, true), 'high')
  assert.equal(gradeOf(2, true), 'high')
  assert.equal(gradeOf(2, false), 'possible')
  assert.equal(gradeOf(1, true), 'possible')
  assert.equal(gradeOf(1, false), 'none')
  assert.equal(gradeOf(0, true), 'none')
  for (const d of ['Stripe Payments Australia', 'PAYPAL AUSTRALIA', 'Apple Pty Ltd', 'Google Payment', 'ATO refund', 'Transfer from own account', 'Joner Football savings']) assert.ok(notFamily({ payer: d }), d)
  assert.ok(!notFamily({ payer: 'Fast Transfer From M Featherstone' }))
})

const player = (rowId, name, parent, x = {}) => ({ rowId, player: name, parent, email: `${rowId}@example.com`, locationId: 'belrose', group: 'Monday 4:20pm, Belrose HQ', status: 'unpaid', feeCents: 85000, paidCents: 0, owingCents: 85000, ...x })
const PLAYERS = [
  player('r1', 'Ollie Featherstone', 'Mia Featherstone'),
  player('r2', 'Ruby Featherstone', 'Mia Featherstone', { email: 'r1@example.com', feeCents: 42500, owingCents: 42500, locationId: 'ntra' }),
  player('r3', 'Kit Wolstenholme', 'Kara Wolstenholme', { status: 'paid', paidCents: 85000, owingCents: 0 }),
  player('r4', 'Sam Brightwater', 'Lou Brightwater', { feeCents: 85000, paidCents: 40000, owingCents: 45000, status: 'part', locationId: 'rydalmere' }),
]
const item = (n, date, cents, payer, x = {}) => cleanItem({ id: `XERO-${String(n).padStart(8, '0')}-aaaa-bbbb`, date, cents, payer, description: payer, ...x }, 'xero')

test('the matcher: high and possible matches, siblings, top three, the reasons', () => {
  const items = [
    item(1, '2026-10-10', 127500, 'Fast Transfer From M Featherstone'),
    item(2, '2026-10-09', 45000, 'L Brightwat'),
    item(3, '2026-10-08', 30000, 'Q Zanzibarre'),
    item(4, '2026-10-07', 85000, 'T Wolstenholme'),
  ]
  const { items: out, counts } = matchBank({ items, players: PLAYERS, since: '2026-09-28' })
  const by = Object.fromEntries(out.map((x) => [x.id.slice(5, 13), x]))
  const fam = by['00000001']
  assert.equal(fam.grade, 'high')
  assert.deepEqual(fam.candidates.map((c) => c.rowId).sort(), ['r1', 'r2'])
  assert.equal(fam.candidates[0].reason, "name matches the parent, amount = the family's total owing")
  assert.deepEqual(fam.candidates[0].familyRowIds.sort(), ['r1', 'r2'])
  assert.equal(fam.candidates[0].familyOwingCents, 127500)
  assert.equal(by['00000002'].grade, 'high', 'a cut short surname still counts')
  assert.equal(by['00000002'].candidates[0].reason, "name matches the parent, amount = what's owing")
  assert.equal(by['00000003'].grade, 'none')
  assert.deepEqual(by['00000003'].candidates, [])
  assert.equal(by['00000004'].grade, 'high', 'surname and the fee')
  assert.equal(by['00000004'].candidates[0].reason, 'surname matches the parent, amount = the fee')
  assert.deepEqual([counts.high, counts.possible, counts.none], [3, 0, 1])
  assert.deepEqual(out.map((x) => x.grade), ['high', 'high', 'high', 'none'], 'high first')
  // A different amount from a name that matches: possible.
  const p = matchBank({ items: [item(5, '2026-10-10', 1000, 'M Featherstone')], players: PLAYERS }).items[0]
  assert.equal(p.grade, 'possible')
  assert.match(p.candidates[0].reason, /amount doesn't match what's owing/)
  assert.ok(p.candidates.length <= 3)
})

test('the matcher skips what is recorded, ignored, too early, or not a family', () => {
  const items = [
    item(1, '2026-10-10', 127500, 'M Featherstone'),
    item(2, '2026-10-09', 45000, 'L Brightwater'),
    item(3, '2026-10-08', 30000, 'Stripe Payments Australia'),
    item(4, '2026-09-01', 85000, 'T Wolstenholme'),
    item(6, '2026-10-06', 85000, 'K Wolstenholme'),
  ]
  const ledger = [
    // Recorded with its own id, split per player.
    { 'Payment ID': items[0].id, 'Payment Method': 'Bank Transfer', 'Amount Paid': 850, 'Payment Date': '2026-10-10', 'Source Record ID': 'r1' },
    { 'Payment ID': `${items[0].id}#2`, 'Payment Method': 'Bank Transfer', 'Amount Paid': 425, 'Payment Date': '2026-10-10', 'Source Record ID': 'r2' },
    // Recorded by hand days later, same amount, same family name.
    { 'Payment ID': 'BANK-HAND1', 'Payment Method': 'Bank Transfer', 'Amount Paid': 450, 'Payment Date': '2026-10-13', 'Source Record ID': 'r4' },
    // Same amount but by Stripe: not this transfer.
    { 'Payment ID': 'pi_x', 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Payment Date': '2026-10-06', 'Source Record ID': 'r3' },
  ]
  const { items: out, counts } = matchBank({ items, players: PLAYERS, ledger, ignored: [items[4].id], since: '2026-09-28' })
  assert.deepEqual(out.map((x) => x.id), [])
  assert.deepEqual([counts.recorded, counts.notFamily, counts.early, counts.ignored], [2, 1, 1, 1])
  // The hand-recorded one is still shown when it was 8 days apart, or for another name.
  const far = matchBank({ items: [items[1]], players: PLAYERS, ledger: [{ ...ledger[2], 'Payment Date': '2026-10-18' }] })
  assert.equal(far.items.length, 1)
  const other = matchBank({ items: [items[1]], players: PLAYERS, ledger: [{ ...ledger[2], 'Source Record ID': 'r3' }] })
  assert.equal(other.items.length, 1)
  // Xero and the CSV with the same transfer: shown once, as the Xero line.
  const csv = cleanItem({ id: csvId('2026-10-09', 45000, 'Transfer from L Brightwater'), date: '2026-10-09', cents: 45000, description: 'Transfer from L Brightwater' }, 'csv')
  const both = matchBank({ items: [items[1], csv], players: PLAYERS })
  assert.deepEqual(both.items.map((x) => x.source), ['xero'])
})

test('bank line ids: Xero and CSV only, and bad lines are dropped', () => {
  assert.ok(EXTERNAL_ID.test('XERO-0b5c2a6e-1111-4c4c-9d9d-123456789abc'))
  assert.ok(EXTERNAL_ID.test(csvId('2026-10-01', 100, 'x')))
  assert.equal(csvId('2026-10-01', 100, 'x'), csvId('2026-10-01', 100, 'x'), 'the same line, the same id')
  assert.notEqual(csvId('2026-10-01', 100, 'x'), csvId('2026-10-01', 101, 'x'))
  for (const bad of ['BANK-12345678', 'XERO-1', 'XERO-abc def12', 'CSV-' + 'a'.repeat(81), "XERO-1234567'"]) assert.ok(!EXTERNAL_ID.test(bad), bad)
  assert.equal(cleanItem({ id: 'XERO-12345678', date: '2026-10-01', cents: -500, payer: 'X' }, 'xero'), null, 'money out')
  assert.equal(cleanItem({ id: 'XERO-12345678', date: '01/10/2026', cents: 500 }, 'xero'), null)
  assert.equal(cleanItem({ id: 'nope', date: '2026-10-01', cents: 500 }, 'xero'), null)
  assert.equal(cleanItem({ id: 'XERO-12345678', date: '2026-10-01', cents: 500, description: 'Transfer from A B' }, 'xero').payer, 'Transfer from A B', 'no payer: the description')
})

console.log(`\n${passed} bank match checks passed`)
