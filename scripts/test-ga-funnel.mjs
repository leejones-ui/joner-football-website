import assert from 'node:assert/strict'
import { gaChannel, buildFunnel, funnelRange, isPlaceholderCampaign } from '../api/_ga-funnel.js'

assert.equal(gaChannel('facebook', 'paid'), 'Meta')
assert.equal(gaChannel('fb', 'paid_social'), 'Meta')
assert.equal(gaChannel('ig', 'paid_social'), 'Meta')
assert.equal(gaChannel('(direct)', '(none)'), 'Direct')
assert.equal(gaChannel('google', 'organic'), 'Organic')
assert.equal(gaChannel('google', 'cpc'), 'Paid Search')
assert.equal(gaChannel('brevo', 'email'), 'Email')
assert.equal(gaChannel('meexl.r.a.d.sendibm1.com', 'referral'), 'Email')
assert.equal(gaChannel('youtube.com', 'referral'), 'Social')
assert.equal(gaChannel('l.instagram.com', 'referral'), 'Social')
assert.equal(gaChannel('app_instagram__jfa1__s=app_instagram&m=social', 'social'), 'Social')
assert.equal(gaChannel('brevo/email__jfa1__s=brevo/email', 'email'), 'Email')
assert.equal(gaChannel('somesite.com', 'referral'), 'Referral')
assert.equal(gaChannel('(not set)', '(not set)'), 'Other')
assert.equal(isPlaceholderCampaign('{{campaign.name}}'), true)
assert.equal(isPlaceholderCampaign('%7B%7Bcampaign.name%7D%7D'), true)

const r = (s, m, c, e, v) => ({ dims: [s, m, c, e], value: v })
const f = buildFunnel({
  websiteRows: [r('fb', 'paid_social', 'JF+Max', 'session_start', 10), r('facebook', 'paid', 'JF Max', 'session_start', 5), r('facebook', 'paid', '{{campaign.name}}', 'session_start', 14), r('fb', 'paid_social', 'JF Max', 'begin_checkout', 3), r('google', 'organic', '(not set)', 'session_start', 7)],
  appRows: [r('fb', 'paid_social', 'JF Max', 'Sign Up', 2), r('fb', 'paid_social', 'JF Max', 'Purchase', 1), r('fb', 'paid_social', 'JF Max', 'page_view', 99)],
})
const meta = f.channels.find((c) => c.channel === 'Meta')
assert.deepEqual(meta, { channel: 'Meta', visitors: 15, checkout_clicks: 3, app_signups: 2, app_checkouts: 1 })
assert.equal(f.placeholder_visits_excluded, 14)
assert.deepEqual(f.meta_campaigns, [{ campaign: 'JF Max', visitors: 15, checkout_clicks: 3 }])

assert.deepEqual(funnelRange({ days: 7 }, new Date('2026-10-31T12:00:00Z')), { from: '2026-10-25', to: '2026-10-31' })
assert.deepEqual(funnelRange({ from: '2026-01-01', to: '2026-10-31' }), { from: '2026-08-03', to: '2026-10-31' })
console.log('ga funnel tests passed')
