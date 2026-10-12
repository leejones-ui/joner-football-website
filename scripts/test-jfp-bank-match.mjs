// Bank transfers to check: the bank CSV reader, the name tidy-up, the scores,
// the grades and the matcher. No network; every name and amount is invented.
import assert from 'node:assert/strict'
import { parseBankCsv, bankDate, bankCents, csvCells } from '../src/scripts/jfp-bank-csv.js'
import { nameTokens, peopleIn, personScore, rowScore, amountFit, gradeOf, notFamily, matchBank, cleanItem, csvId, csvIds, similarity, EXTERNAL_ID, twinOf, looksJfp } from '../api/_jfp-bank-match.js'

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
    item(3, '2026-10-08', 42500, 'Q Zanzibarre'),
    item(4, '2026-10-07', 85000, 'T Wolstenholme'),
    item(7, '2026-10-07', 31337, 'Z Nobodyknows 1on1 coaching'),
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
  assert.deepEqual([counts.high, counts.possible, counts.none, counts.notJfp], [3, 0, 1, 1])
  assert.ok(!by['00000007'], 'no player could have sent it and no fee is that amount: not shown at all')
  assert.ok(!JSON.stringify(out).includes('Nobodyknows'))
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


const csvItem = (date, cents, description, n = 1) => cleanItem({ id: csvId(date, cents, description, n), date, cents, description }, 'csv')
const led = (id, cents, date, rowId, method = 'Bank Transfer') => ({ 'Payment ID': id, 'Payment Method': method, 'Amount Paid': cents / 100, 'Payment Date': date, 'Source Record ID': rowId })

test('one ledger payment stands for one bank line: a second transfer of the same amount from the family still shows', () => {
  // Two children paid separately, two days apart, the first recorded with its id.
  const a = item(11, '2026-10-06', 85000, 'M Featherstone'), b = item(12, '2026-10-08', 85000, 'M Featherstone')
  let r = matchBank({ items: [a, b], players: PLAYERS, ledger: [led(a.id, 85000, a.date, 'r1')] })
  assert.deepEqual(r.items.map((x) => x.id), [b.id])
  assert.equal(r.counts.recorded, 1)
  // Typed in by hand once: it takes the closest line only.
  r = matchBank({ items: [a, b], players: PLAYERS, ledger: [led('BANK-HAND2', 85000, '2026-10-07', 'r1')] })
  assert.equal(r.items.length, 1)
  assert.equal(r.counts.recorded, 1)
  // Every week the same amount (session by session): one hand entry, one line.
  const weeks = [1, 8, 15].map((d, i) => item(20 + i, `2026-10-${String(d).padStart(2, '0')}`, 5000, 'L Brightwater'))
  r = matchBank({ items: weeks, players: PLAYERS, ledger: [led('CASH-W1', 5000, '2026-10-08', 'r4')] })
  assert.deepEqual(r.items.map((x) => x.date).sort(), ['2026-10-01', '2026-10-15'])
  // A recorded Xero line never hides another Xero line, however alike.
  r = matchBank({ items: [a, b], players: PLAYERS, ledger: [led(a.id, 85000, a.date, 'r1')], recorded: [{ id: a.id, source: 'xero', cents: 85000, date: a.date, payer: a.payer }] })
  assert.deepEqual(r.items.map((x) => x.id), [b.id])
})

test('the same transfer in Xero and the CSV: once, one to one, and a recorded copy hides the other copy only', () => {
  const x1 = item(31, '2026-10-09', 30000, 'Fast Transfer From P Testerly')
  const c1 = csvItem('2026-10-09', 30000, 'Fast Transfer From P Testerly')
  const c2 = csvItem('2026-10-09', 30000, 'Fast Transfer From P Testerly', 2)
  assert.notEqual(c1.id, c2.id)
  const players = [player('t1', 'Ada Testerly', 'Pat Testerly', { feeCents: 30000, owingCents: 30000 }), player('t2', 'Bo Testerly', 'Pat Testerly', { email: 't1@example.com', feeCents: 30000, owingCents: 30000 })]
  // Two transfers that day in the CSV, one coded in Xero so far: two lines, not one.
  let r = matchBank({ items: [x1, c1, c2], players })
  assert.deepEqual(r.items.map((x) => x.source).sort(), ['csv', 'xero'])
  assert.equal(r.counts.twins, 1)
  // The CSV copy recorded for a grandparent's payment: the Xero copy that turns up later is recorded too.
  const gran = csvItem('2026-10-10', 30000, 'Transfer from G Oldfield')
  const xg = item(32, '2026-10-11', 30000, 'G OLDFIELD')
  const rec = [{ id: gran.id, source: 'csv', cents: 30000, date: gran.date, payer: gran.payer }]
  r = matchBank({ items: [xg], players, ledger: [led(gran.id, 30000, gran.date, 't1')], recorded: rec })
  assert.deepEqual([r.items.length, r.counts.recorded], [0, 1])
  // But a second, different Xero transfer from them is still shown.
  const xg2 = item(33, '2026-10-10', 30000, 'G OLDFIELD')
  r = matchBank({ items: [xg, xg2], players, ledger: [led(gran.id, 30000, gran.date, 't1')], recorded: rec })
  assert.equal(r.items.length, 1)
  // Recorded before the store existed (the ledger only): the copy is matched by the row's names.
  r = matchBank({ items: [item(34, '2026-10-09', 30000, 'P Testerly')], players, ledger: [led(c1.id, 30000, c1.date, 't1')] })
  assert.equal(r.items.length, 0)
  // twinOf, for the server's check: the copy of a recorded line, never a line already paired.
  assert.equal(twinOf(xg, rec)?.id, gran.id)
  assert.equal(twinOf(xg, [...rec, { id: xg2.id, source: 'xero', cents: 30000, date: xg2.date, payer: xg2.payer }]), null, 'both copies are recorded already')
  assert.equal(twinOf(xg, [{ ...rec[0], distinct: true }]), null, 'Lee said it was a different transfer')
  assert.equal(twinOf(item(35, '2026-10-14', 30000, 'G OLDFIELD'), rec), null, 'too far apart')
  assert.equal(twinOf(item(36, '2026-10-10', 30100, 'G OLDFIELD'), rec), null, 'another amount')
})

test('CSV ids: identical lines in one file get their own ids, the same each upload', () => {
  const l = { date: '2026-10-11', cents: 42500, description: 'Fast Transfer From A Testname' }
  const ids = csvIds([l, l, { ...l, cents: 100 }])
  assert.equal(new Set(ids).size, 3)
  assert.equal(ids[0], csvId(l.date, l.cents, l.description), 'the first keeps the plain id')
  assert.deepEqual(csvIds([l, l]), ids.slice(0, 2))
})

test('only JFP money is shown: hidden lines that look like JFP come back in hidden, the rest never', () => {
  const fam = item(41, '2026-10-09', 85000, 'M Featherstone'), odd = item(42, '2026-10-09', 7777, 'Z Clientperson')
  const r = matchBank({ items: [fam, odd], players: PLAYERS, ignored: [fam.id, odd.id] })
  assert.deepEqual(r.hidden.map((x) => x.id), [fam.id])
  assert.deepEqual(Object.keys(r.hidden[0]).sort(), ['cents', 'date', 'id', 'payer', 'source'])
  assert.ok(looksJfp(fam, PLAYERS))
  assert.ok(!looksJfp(odd, PLAYERS))
  assert.ok(looksJfp(item(43, '2026-10-09', 42500, 'Z Clientperson'), PLAYERS), 'a fee-sized amount is kept')
  assert.ok(!looksJfp(item(44, '2026-10-09', 85000, 'Stripe Payments Australia'), PLAYERS))
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
