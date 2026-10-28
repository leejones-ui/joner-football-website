import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SOURCE_TAXONOMY, ORGANIC_SOCIAL_SOURCES, classifySource, normalizeSource, isOrganicSocialTouch, isMetaPaidTouch } from '../api/_source-taxonomy.js'
import { TRACKING_LINK_BANK } from '../api/_tracking-link-bank.js'
import { classifyAttribution } from '../api/_attribution-ledger.js'
import { acquisitionCategory } from '../api/_invoice-truth.js'

const cases = [
  [{ utm_source: 'brevo', utm_medium: 'email' }, 'brevo/email'],
  [{ source_detail: 'lee_manual_email' }, 'lee_manual_email'],
  [{ utm_source: 'instagram' }, 'instagram'],
  [{ utm_source: 'facebook' }, 'facebook'],
  [{ utm_source: 'manychat' }, 'manychat'],
  [{ utm_source: 'threads' }, 'threads'],
  [{ utm_source: 'tiktok' }, 'tiktok'],
  [{ utm_source: 'x' }, 'x'],
  [{ utm_source: 'meta', utm_medium: 'paid_social' }, 'meta_ads'],
  [{ utm_source: 'google', utm_medium: 'organic' }, 'google_organic'],
  [{ utm_source: 'google', utm_medium: 'cpc', gclid: 'abc' }, 'google_ads'],
  [{ utm_source: 'organic', utm_medium: 'organic' }, 'organic'],
  [{ utm_source: 'referral', utm_medium: 'referral', source_detail: 'partner.example' }, 'referral'],
  [{}, 'direct'],
  [{ utm_source: 'partner', referrer: 'https://example.com' }, 'unknown'],
  // 28 Oct 2026: /go and Head Code sources map to themselves, not unknown.
  [{ utm_source: 'main_instagram', utm_medium: 'social', source_taxonomy: 'main_instagram' }, 'main_instagram'],
  [{ utm_source: 'app_instagram', utm_medium: 'social' }, 'app_instagram'],
  [{ utm_source: 'main_instagram_linktree', utm_medium: 'organic_social' }, 'main_instagram_linktree'],
  [{ utm_source: 'manychat_instagram', utm_medium: 'automation' }, 'manychat_instagram'],
  [{ utm_source: 'manychat_facebook', utm_medium: 'automation' }, 'manychat_facebook'],
  [{ utm_source: 'youtube', utm_medium: 'social' }, 'youtube'],
  [{ utm_source: 'youtube_coaches', utm_medium: 'social' }, 'youtube_coaches'],
  [{ utm_source: 'youtube-es' }, 'youtube_es'],
  [{ utm_source: 'tiktok', utm_medium: 'social' }, 'tiktok'],
  [{ utm_source: 'instagram', utm_medium: 'social', source_taxonomy: 'instagram', ad_id: '120249785829550035' }, 'meta_ads'],
  [{ utm_source: 'facebook', fbclid: 'organic-click' }, 'facebook'],
]
for (const [input, expected] of cases) assert.equal(classifySource(input), expected, JSON.stringify(input))
assert.deepEqual([...SOURCE_TAXONOMY], ['brevo/email', 'lee_manual_email', 'instagram', 'facebook', 'manychat', 'tiktok', 'x', 'threads', 'main_instagram', 'app_instagram', 'main_instagram_linktree', 'manychat_instagram', 'manychat_facebook', 'youtube', 'youtube_coaches', 'youtube_es', 'meta_ads', 'google_organic', 'google_ads', 'organic', 'referral', 'direct', 'unknown'])

// Every /go link-bank social or automation source is in the canonical list and
// classifies as organic social through the journey ledger.
const id = 'jfy_' + 'a'.repeat(24)
for (const [token, link] of Object.entries(TRACKING_LINK_BANK)) {
  if (!['social', 'automation'].includes(link.channel)) continue
  assert.ok(ORGANIC_SOCIAL_SOURCES.includes(normalizeSource(link.source)), `${token} source ${link.source} missing from the canonical list`)
  const touch = { utm_source: link.source, utm_medium: link.channel, utm_campaign: link.campaign, link_token: token, source_taxonomy: link.source }
  assert.equal(classifyAttribution({ journey: { journey_id: id, last_touch: touch }, payment: { journey_id: id } }).classification, 'organic_social', token)
  assert.equal(acquisitionCategory({ source: link.source, medium: link.channel, acquisition: 'organic_social' }), 'organic_social', token)
  assert.equal(classifySource(touch), normalizeSource(link.source), token)
}

// The Head Code is pasted into Uscreen by hand and cannot import the module:
// every source it can emit must already be accepted, so no re-paste is needed.
const head = fs.readFileSync(new URL('./uscreen-head-attribution-v1.js', import.meta.url), 'utf8')
const emitted = new Set([...head.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]))
emitted.add('youtube-es')
for (const source of emitted) {
  if (['google', 'referral'].includes(source)) continue
  assert.ok(ORGANIC_SOCIAL_SOURCES.includes(normalizeSource(source)), `head code source ${source} missing from the canonical list`)
  const medium = ['app_instagram', 'main_instagram_linktree', 'facebook', 'x', 'threads', 'tiktok', 'youtube'].includes(source) ? 'organic_social' : 'social'
  assert.equal(isOrganicSocialTouch({ utm_source: source, utm_medium: medium }), true, source)
  assert.equal(isMetaPaidTouch({ utm_source: source, utm_medium: medium }), false, source)
}
assert.ok(emitted.has('app_instagram') && emitted.has('main_instagram_linktree'))
console.log('source taxonomy tests passed')
