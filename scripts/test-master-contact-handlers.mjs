// Execute real handler sources in isolated VM modules. Dependency services are
// synthetic and fetch cannot escape this harness. Compare to untouched HEAD.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
const fixtures = [
  ['contact-enquiry', { enquiryType: 'general', name: 'Example Parent', email: 'parent@example.test', phone: '+61422123456', message: 'Training please' }],
  ...['training-sydney', 'game-analysis', 'joners-juniors', 'coaching-role', 'team-subscriptions'].map(enquiryType => ['contact-enquiry', { enquiryType, name: 'Example Parent', email: 'parent@example.test', phone: '+61422123456', message: 'Training please', playerName: 'Example Player', playerAge: '10', age: '25', coachingExperience: 'Five seasons', qualifications: 'Qualified coach', clubTeam: 'Example FC', numberOfPlayers: '20', numberOfCoaches: '2', location: 'Sydney' }]),
  ['subscribe', { source: 'mindset-seminar', firstName: 'Example Parent', email: 'parent@example.test', phone: '+61422123456' }],
  ['subscribe', { source: 'coaches-course-application', firstName: 'Example Coach', email: 'parent@example.test', phone: '+61422123456' }],
  ['camp-registration', { playerFirstName: 'Example', playerSurname: 'Player', email: 'parent@example.test', parentName: 'Example Parent', mobile: '+61422123456', age: '10', jerseySize: 'M', numberOfDays: '3', agreementAccepted: true, paymentLink: 'https://example.test/pay' }],
  ['selection-application', { playerFullName: 'Example Player', parentFullName: 'Example Parent', playerAge: '10', playFor: 'Test FC', mobileNumber: '+61422123456', email: 'parent@example.test', hearAbout: 'Friend', applicationMessage: 'Please consider' }],
  ['juniors-registration', { email: 'parent@example.test', mobile: '+61422123456' }],
  ['jfp-book', { groupId: 'group', bookingId: 'booking', releaseToken: 'token', players: [{ name: 'Example Player', age: 10 }], parentName: 'Example Parent', mobile: '+61422123456', email: 'parent@example.test', agreementAccepted: true }],
  ['jfp-book', { action: 'apply', groupId: 'group', players: [{ name: 'Example Player', age: 10 }], parentName: 'Example Parent', mobile: '+61422123456', email: 'parent@example.test' }],
  ['holiday-book', { slotId: 'slot', type: 'one', seats: 1, players: [{ name: 'Example Player', age: 10 }], parentName: 'Example Parent', mobile: '+61422123456', email: 'parent@example.test', agreementAccepted: true }],
]
async function execute(source, body, captureStatus = 'persisted', method = 'POST') {
  const effects = [], captures = []
  const time = 1790000000000
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [time])) } static now() { return time } }
  const fakeMath = Object.create(Math); fakeMath.random = () => 0.5
  const context = vm.createContext({ Buffer, URL, URLSearchParams, Response, structuredClone, Date: FixedDate, Math: fakeMath, console: { error() {}, warn() {}, info() {} }, setTimeout: () => 0, process: { env: { BREVO_API_KEY: 'fake', STRIPE_SECRET_KEY: 'fake', CAMP_REGISTRATION_SHEET_ID: 'sheet', JUNIORS_SHEET_ID: 'sheet', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'test@example.test', private_key: privateKey }) } }, fetch: async (url, init = {}) => {
    effects.push({ url: String(url), method: init.method, body: init.body ? String(init.body).replace(/"assertion"[^}]+/, '') : '' })
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'fake' }))
    if (String(url).includes('stripe.com')) return new Response(JSON.stringify({ id: 'cs_test', url: 'https://example.test/checkout' }))
    if (String(url).includes('sheets.googleapis.com')) return new Response(JSON.stringify({ sheets: [{ properties: { title: 'Leads Pending Payment' } }], values: [] }))
    if (String(url).includes('brevo.com')) return new Response('{}')
    assert.fail(`Unexpected fetch: ${url}`)
  } })
  const clean = (v, n = 500) => String(v ?? '').trim().slice(0,n)
  const dep = {
    clean, cleanString: clean,
    protectForm: async () => ({ ok: true }), rateLimit: () => ({ allowed: true }), verifyRecaptcha: async () => ({ ok: true }),
    validateEmailFormat: () => ({ ok: true }), validateEmailQuality: async email => ({ ok: true, email }),
    extractAttribution: () => ({}), extractMetaIdentity: () => ({}),
    captureWebsiteContact: async p => { captures.push(p); return { status: captureStatus } },
    normaliseRegistration: () => ({ registrationId: 'reg', player: 'Example Player', parent: 'Example Parent', email: body.email, mobile: body.mobile, source: 'Google' }),
    validateJuniorsRegistration: () => ({ ok: true }), rowFromRegistration: () => [], stripeCheckoutForm: () => 'mock=1',
    readRows: async () => [['head'], ['', 'reg']], JUNIORS_HEADERS: [], JUNIORS_SHEET_TAB: 'Juniors',
    requireParentAccess: () => true, requireHolidayAccess: () => true,
    getConfig: async () => ({ minAge: 7, maxAge: 18, priceCents: 85000, bookingCutoffHours: 2, term: 'Term' }),
    getGroup: async () => ({ id: 'group', mode: body.action === 'apply' ? 'application' : 'direct', capacity: 6 }),
    getSlot: async () => ({ id: 'slot', status: 'open', type: 'one', startsAt: '2027-10-01T10:00:00+10:00', location: 'HQ' }),
    getBooking: async () => body.bookingId ? ({ id: 'booking', groupId: 'group', status: 'reserving', seats: 1, releaseToken: 'token' }) : null,
    tokenMatches: () => true, extendPlaces: async () => true, extendHold: async () => true, holdSlot: async () => 'held',
    newId: prefix => `${prefix}-test`, coachById: () => ({ name: 'Coach' }), sessionDates: () => ['2026-10-12', '2026-12-14'], dateLabel: v => v,
    siteUrl: () => 'https://example.test', stripeFetch: async (...a) => { effects.push({ stripe: a }); return { id: 'cs_test', url: 'https://example.test/pay' } },
    SESSION_TYPES: ['one', 'shared', 'group'], TYPE_LABELS: { one: '1 to 1' }, maxPlayersForType: () => 1, minPlayersForType: () => 1, resolvePriceCents: () => 10000,
    HOLD_MINUTES: 31, CHECKOUT_EXPIRES_MINUTES: 30, sydneyDateLabel: () => 'Date', sydneyTimeLabel: () => 'Time',
    campPaymentConfig: () => null, selectedDayKey: () => 'all',
  }
  const imports = new Map()
  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim()
    imports.set(m[2], clause.startsWith('{') ? clause.slice(1,-1).split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean) : ['default'])
  }
  async function moduleFor(spec) {
    const names = imports.get(spec) || (spec === 'node:crypto' ? Object.keys(crypto) : [])
    const mod = new vm.SyntheticModule(names, function () {
      for (const name of names) {
        let value = dep[name]
        if (spec === 'node:crypto') value = name === 'default' ? { ...crypto, randomBytes: n => Buffer.alloc(n, 1) } : crypto[name]
        if (spec === 'node:dns/promises') value = { resolveMx: async () => [{}] }
        if (value === undefined) value = async (...args) => { effects.push({ service: name, args }); return {} }
        this.setExport(name, value)
      }
    }, { context })
    await mod.link(() => {}); await mod.evaluate(); return mod
  }
  const mod = new vm.SourceTextModule(source, { context, importModuleDynamically: moduleFor })
  await mod.link(moduleFor); await mod.evaluate()
  const res = { code: 200, setHeader() {}, status(n) { this.code=n; return this }, json(b) { this.body=b; return this } }
  await mod.namespace.default({ method, headers: { host: 'example.test' }, body, query: {} }, res)
  // Google assertions are signed using real crypto but never leave this stub.
  const normalised = JSON.parse(JSON.stringify(effects).replace(/assertion=[^"&]+/g, 'assertion=mock'))
  return { code: res.code, body: JSON.parse(JSON.stringify(res.body)), effects: normalised, captures }
}
for (const [route, body] of fixtures) test(`${route} ${body.action || 'submit'} preserves HEAD response/effects, capture success and outage`, async () => {
  const file = `api/${route}.js`
  const before = await execute(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }), body)
  assert.equal(before.code, 200, `baseline fixture must reach success: ${JSON.stringify(before.body)}`)
  for (const status of ['persisted', 'failed']) {
    const after = await execute(fs.readFileSync(file, 'utf8'), body, status)
    assert.deepEqual(after.body, before.body)
    assert.equal(after.code, before.code)
    assert.deepEqual(after.effects, before.effects)
    assert.equal(after.captures.length, 1)
    assert.ok(after.captures[0].phone)
  }
  const rejected = await execute(fs.readFileSync(file, 'utf8'), body, 'persisted', 'GET')
  assert.equal(rejected.code, 405)
  assert.equal(rejected.captures.length, 0)
})

test('phone-bearing API coverage inventory catches new unclassified handlers', () => {
  const covered = [...new Set(fixtures.map(([route]) => `${route}.js`))]
  const excluded = ['jfp-portal-data.js','camp-payment-webhook.js','camp-confirm-payment.js','juniors-payment-webhook.js','juniors-email-test.js','holiday-admin.js','camp-unpaid-reminders.js','track-event.js']
  const found = fs.readdirSync('api').filter(name => !name.startsWith('_') && name.endsWith('.js')).filter(name => {
    const source = fs.readFileSync(`api/${name}`, 'utf8')
    return source.includes('export default') && /\b(phone|mobile|mobileNumber|normaliseRegistration)\b/.test(source)
  })
  assert.deepEqual(found.sort(), [...covered, ...excluded].sort())
  assert.equal(covered.length, 7)
})
