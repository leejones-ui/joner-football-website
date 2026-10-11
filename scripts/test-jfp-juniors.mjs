// Joners Juniors money: synthetic rows and Stripe payments only.
//   node scripts/test-jfp-juniors.mjs
import assert from 'node:assert/strict'
import { juniorsMoney, readJuniorsStripe, readJuniorsRows, readJuniorsSheet, juniorsMoneyData, SYDNEY_ACCOUNT } from '../api/_jfp-juniors-money.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`) }
const LINK4 = 'https://buy.stripe.com/test_term4'
const row = (id, x = {}) => ({ id, table: 'tblT', term: 'Term 4 2026', player: `Player ${id}`, parent: 'P', emails: [`${id}@example.com`], location: 'Belrose HQ', session: 'Saturday 9:15am', feeCents: 22000, status: 'Unpaid', paidVia: '', paidAt: '', sessionId: '', intentId: '', linkUrl: '', ...x })
const pay = (id, x = {}) => ({ id, intentId: `pi_${id}`, paid: true, email: '', amountCents: 22000, refundedCents: 0, currency: 'aud', at: '2026-10-01T00:00:00Z', link: '', tagged: false, found: ['test'], ...x })
const links = { plink_4: { url: LINK4, onRow: true, product: 'Joners Juniors Term 4' } }
const get = (m, id) => m.players.find((p) => p.rowId === id)

await test('a payment named on the row counts once, whatever else found it', async () => {
  const rows = [row('a', { term: 'Term 3 2026', status: 'Paid', paidVia: 'Stripe', sessionId: 'cs_1' })]
  const s1 = pay('cs_1', { email: 'a@example.com', found: ['row id', 'juniors tag'], tagged: true })
  const m = juniorsMoney(rows, { sessions: [s1, s1], links: {} })
  assert.equal(get(m, 'a').paidCents, 22000); assert.equal(get(m, 'a').status, 'paid')
  assert.equal(m.byTerm['Term 3 2026'].collectedCents, 22000)
})

await test('Term 3 and Term 4 are separate, with no cross-term double count', async () => {
  const rows = [row('t3', { term: 'Term 3 2026', status: 'Paid', sessionId: 'cs_3', emails: ['fam@example.com'] }), row('t4', { emails: ['fam@example.com'], linkUrl: LINK4 })]
  const m = juniorsMoney(rows, { sessions: [pay('cs_3', { email: 'fam@example.com' }), pay('cs_4', { email: 'fam@example.com', link: 'plink_4' })], links })
  assert.equal(m.byTerm['Term 3 2026'].collectedCents, 22000)
  assert.equal(m.byTerm['Term 4 2026'].collectedCents, 22000)
  assert.equal(get(m, 't4').status, 'stripe', 'paid in Stripe, Airtable still says Unpaid')
})

await test('two children on one payment are split by fee, not counted twice', async () => {
  const rows = [row('k1', { emails: ['sib@example.com'], linkUrl: LINK4 }), row('k2', { emails: ['sib@example.com'], linkUrl: LINK4 })]
  const m = juniorsMoney(rows, { sessions: [pay('cs_s', { email: 'sib@example.com', link: 'plink_4', amountCents: 44000 })], links })
  assert.equal(get(m, 'k1').paidCents, 22000); assert.equal(get(m, 'k2').paidCents, 22000)
  assert.equal(m.byTerm['Term 4 2026'].collectedCents, 44000)
})

await test('paid, pending, partial, refunded, failed, waived, unknown fee, unknown amount', async () => {
  const rows = [
    row('paid', { linkUrl: LINK4, status: 'Paid' }),
    row('part', { linkUrl: LINK4 }),
    row('ref', { linkUrl: LINK4 }),
    row('pend', { linkUrl: LINK4 }),
    row('waived', { status: 'N/A' }),
    row('nofee', { feeCents: null }),
    row('unverified', { status: 'Paid', paidVia: 'Stripe' }),
    row('credit', { status: 'Paid', paidVia: 'Term 3 credit' }),
  ]
  const sessions = [
    pay('cs_p', { email: 'paid@example.com', link: 'plink_4' }),
    pay('cs_pt', { email: 'part@example.com', link: 'plink_4', amountCents: 10000 }),
    pay('cs_r', { email: 'ref@example.com', link: 'plink_4', refundedCents: 22000 }),
    pay('cs_pend', { email: 'pend@example.com', link: 'plink_4', paid: false }),
  ]
  const m = juniorsMoney(rows, { sessions, links })
  const st = (id) => get(m, id).status
  assert.deepEqual([st('paid'), st('part'), st('ref'), st('pend'), st('waived'), st('nofee'), st('unverified'), st('credit')], ['paid', 'part', 'refunded', 'unpaid', 'na', 'nofee', 'unverified', 'credit'])
  assert.equal(get(m, 'part').owingCents, 12000)
  assert.equal(get(m, 'unverified').paidCents, 0, 'a Paid status is not an amount')
  assert.equal(get(m, 'unverified').owingCents, null, 'unknown, not zero')
  assert.equal(get(m, 'nofee').owingCents, null)
  assert.equal(get(m, 'ref').owingCents, null, 'a refund does not reopen a debt on its own')
  const t = m.byTerm['Term 4 2026']
  assert.equal(t.collectedCents, 22000 + 10000 + 0)
  assert.equal(t.refundedCents, 22000)
  assert.equal(t.owingComplete, false)
  assert.equal(t.creditPlaces, 1)
})

await test('a payment nobody can be matched to is shown, not guessed', async () => {
  const rows = [row('x', { linkUrl: LINK4 }), row('y', { term: 'Term 3 2026', emails: ['dup@example.com'] }), row('z', { emails: ['dup@example.com'] })]
  const m = juniorsMoney(rows, { sessions: [pay('cs_u', { email: 'stranger@example.com', link: 'plink_4' }), pay('cs_d', { email: 'dup@example.com', tagged: true })], links })
  assert.equal(m.unlinked.length, 2)
  assert.equal(m.byTerm['Term 4 2026'].unlinkedCents, 22000, 'a stranger on the Term 4 link still belongs to Term 4')
  assert.equal(m.unassigned, 1, 'an email in two terms is not assigned')
  assert.ok(m.unlinked.every((u) => !String(u.ref).startsWith('cs_')), 'no raw Stripe ids sent to the page')
})

await test('another currency is flagged, not added', async () => {
  const rows = [row('c', { sessionId: 'cs_usd' })]
  const m = juniorsMoney(rows, { sessions: [pay('cs_usd', { currency: 'usd' })], links: {} })
  assert.equal(m.byTerm['Term 4 2026'].collectedCents, 0)
  assert.equal(m.otherCurrency.length, 1)
})

await test('JFP payments are reported if they overlap (they should not)', async () => {
  const m = juniorsMoney([row('o', { sessionId: 'cs_o' })], { sessions: [pay('cs_o')], links: {} }, { jfpSessionIds: ['cs_o'] })
  assert.equal(m.coverage.alsoInJfp, 1)
})

await test('a parent who paid from another email is matched by the child\'s name', async () => {
  const rows = [row('n1', { term: 'Term 3 2026', player: 'Mia Lee', status: 'Paid', emails: ['home@example.com'] }), row('n2', { term: 'Term 3 2026', player: 'Ari Ng', status: 'Paid' })]
  const viaStripe = pay('cs_n', { email: 'work@example.com', tagged: true, player: 'Mia  lee' })
  const viaSheet = pay('cs_s', { email: 'other@example.com', tagged: true })
  const sheet = { read: true, tab: 'Joners Juniors', rows: [{ registrationId: 'JJ-1', status: 'paid', player: 'Ari Ng', email: 'other@example.com', sessionId: 'cs_s', intentId: '' }, { registrationId: 'JJ-2', status: 'paid', player: 'Zed', email: 'z@example.com', sessionId: 'cs_none', intentId: '' }] }
  const m = juniorsMoney(rows, { sessions: [viaStripe, viaSheet], links: {} }, { sheet })
  assert.equal(get(m, 'n1').status, 'paid'); assert.equal(get(m, 'n2').status, 'paid')
  assert.equal(m.byTerm['Term 3 2026'].collectedCents, 44000, 'the sheet links payments; it never adds money')
  assert.deepEqual(m.coverage.sheet, { tab: 'Joners Juniors', rows: 2, paid: 2, paidFoundInStripe: 1 })
})

await test('a payment linked by hand counts once, in the term chosen, for that child', async () => {
  const rows = [row('benji', { player: 'Benjamin Phillips (Benji)', status: 'Paid', paidVia: 'Term 3 credit', linkUrl: LINK4 })]
  const s = pay('cs_live_abcdefkaO34G', { email: 'parent@example.com', at: '2026-08-18T04:48:00.000Z', tagged: true })
  const links = [{ suffix: 'kaO34G', cents: 22000, day: '2026-08-18', rowId: 'benji', term: 'Term 3 2026' }]
  const m = juniorsMoney(rows, { sessions: [s], links: {} }, { links })
  assert.equal(m.unlinked.length, 0); assert.equal(m.byHand.length, 1)
  assert.equal(m.byHand[0].forPlayer, 'Benjamin Phillips (Benji)')
  assert.equal(get(m, 'benji').status, 'credit', 'Term 4 stays paid with credit')
  assert.equal(m.byTerm['Term 4 2026'].collectedCents, 0, 'not counted again in Term 4')
  const wrong = juniorsMoney(rows, { sessions: [s], links: {} }, { links: [{ ...links[0], cents: 21900 }] })
  assert.equal(wrong.byHand.length, 0, 'a different amount is not that payment')
})

// ---------- reading ----------

function fakeStripe({ account = SYDNEY_ACCOUNT, pages = 1, failOn = '' } = {}) {
  const calls = []
  const s = (id, x = {}) => ({ id, status: 'complete', payment_status: 'paid', amount_total: 22000, currency: 'aud', created: 1790000000, customer_details: { email: 'a@example.com' }, payment_intent: { id: `pi_${id}`, latest_charge: { amount_refunded: 0 } }, metadata: {}, ...x })
  return {
    calls,
    async fetch(path) {
      calls.push(path)
      if (failOn && path.startsWith(failOn)) throw new Error('Stripe 500')
      if (path === '/account') return { id: account }
      if (path.startsWith('/checkout/sessions/cs_row')) return s('cs_row')
      if (path.startsWith('/payment_intents/search')) return { data: [{ id: 'pi_cs_tag', status: 'succeeded' }, { id: 'pi_cs_row', status: 'succeeded' }], has_more: false }
      if (path.startsWith('/checkout/sessions?payment_intent=pi_cs_tag')) return { data: [s('cs_tag', { metadata: { programme: 'Joners Juniors' } })], has_more: false }
      if (path.startsWith('/payment_links?')) {
        const n = calls.filter((c) => c.startsWith('/payment_links?')).length
        return { data: [{ id: `plink_${n}`, url: n === 1 ? LINK4 : `https://buy.stripe.com/other${n}` }], has_more: n < pages }
      }
      if (path.includes('/line_items')) return { data: [{ description: path.includes('plink_2') ? 'Joners Juniors Term 3' : 'Holiday camp' }] }
      if (path.startsWith('/checkout/sessions?payment_link=')) return { data: [s(`cs_${path.split('=')[1].split('&')[0]}`)], has_more: false }
      return { data: [], has_more: false }
    },
  }
}

await test('Stripe: Sydney account only, every source read, each payment once', async () => {
  const f = fakeStripe({ pages: 3 })
  const out = await readJuniorsStripe([row('r', { sessionId: 'cs_row', linkUrl: LINK4 })], f.fetch)
  const ids = out.sessions.map((x) => x.id).sort()
  assert.deepEqual(ids, ['cs_plink_1', 'cs_plink_2', 'cs_row', 'cs_tag'], 'row id, juniors tag, the row link and a Juniors-named link; the camp link left out')
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(out.missingLinks.length, 0)
  await assert.rejects(readJuniorsStripe([], fakeStripe({ account: 'acct_1Bx8J5CXA04kVlYC' }).fetch), /not the Sydney/)
})

await test('a failed or unfinished read is an error, never a zero', async () => {
  await assert.rejects(readJuniorsStripe([], fakeStripe({ failOn: '/payment_links' }).fetch), /500/)
  await assert.rejects(readJuniorsStripe([], fakeStripe({ pages: 99 }).fetch), /did not finish/)
  await assert.rejects(readJuniorsRows(['tblMissing'], async () => { throw new Error('Airtable 404 TABLE_NOT_FOUND') }), /404/)
  // Term tables with different columns: an unknown column is dropped, nothing else is.
  const has = { t3: ['Player Full Name', 'Term', 'Fee', 'Payment Status', 'Paid At'], t4: ['Player Full Name', 'Term', 'Fee', 'Payment Status', 'Stripe Payment Link'] }
  const read = async (table, fields) => { const bad = fields.find((x) => !has[table].includes(x)); if (bad) throw new Error(`Airtable 422: Unknown field name: "${bad}"`); return [{ id: `rec${table}`, fields: { 'Player Full Name': table, Term: table, Fee: 220, 'Payment Status': 'Paid' } }] }
  const got = await readJuniorsRows(['t3', 't4'], read)
  assert.deepEqual(got.map((r) => r.player), ['t3', 't4'])
})

await test('a refresh that fails keeps the last good figures, marked stale', async () => {
  let store = null
  const deps = { kvGetJson: async () => store, kvSetJson: async (k, v) => { store = v }, readRows: async () => [row('a', { sessionId: 'cs_1' })], readStripe: async () => ({ sessions: [pay('cs_1')], links: {} }) }
  const good = await juniorsMoneyData({ fresh: true }, deps)
  assert.equal(good.stale, false); assert.equal(good.byTerm['Term 4 2026'].collectedCents, 22000)
  const bad = await juniorsMoneyData({ fresh: true }, { ...deps, readStripe: async () => { throw new Error('Stripe down') } })
  assert.equal(bad.stale, true); assert.match(bad.error, /last good/); assert.equal(bad.byTerm['Term 4 2026'].collectedCents, 22000)
  await assert.rejects(juniorsMoneyData({ fresh: true }, { ...deps, kvGetJson: async () => null, readStripe: async () => { throw new Error('Stripe down') } }), /could not be read/)
})

await test('the sheet: only matching columns are kept; a failed sheet does not zero anything', async () => {
  const values = [['Paid At', 'Registration ID', 'Payment Status', 'Player Full Name', 'Date of Birth', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Medical History / Allergies', 'Heard About Us', 'Class', 'Amount Paid', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID / Refund Link'], ['', 'JJ-9', 'Paid', 'Kim', '2019-01-01', 'P', 'K@Example.com', '0400000000', 'Asthma', '', '', '220', 'cs_live_abc', 'https://dashboard.stripe.com/payments/pi_live_9']]
  const sh = await readJuniorsSheet(async () => values, { JUNIORS_SHEET_ID: 'sheet1' })
  assert.deepEqual(sh.rows[0], { registrationId: 'JJ-9', status: 'paid', player: 'Kim', email: 'k@example.com', amount: '220', sessionId: 'cs_live_abc', intentId: 'pi_live_9', paidAt: '' })
  assert.ok(!JSON.stringify(sh).includes('0400000000') && !JSON.stringify(sh).includes('Asthma'))
  let store = null
  const d = await juniorsMoneyData({ fresh: true }, { kvGetJson: async () => store, kvSetJson: async (k, v) => { store = v }, readRows: async () => [row('a', { sessionId: 'cs_1' })], readStripe: async () => ({ sessions: [pay('cs_1')], links: {} }), readSheet: async () => { throw new Error('403') } })
  assert.equal(d.byTerm['Term 4 2026'].collectedCents, 22000)
  assert.match(d.coverage.sheet.error, /could not be read/)
})

console.log(`\n${passed} Joners Juniors money checks passed`)
