import assert from 'node:assert/strict'
import { SOURCE_TAXONOMY, classifySource } from '../api/_source-taxonomy.js'
const cases = [
  [{ utm_source: 'brevo', utm_medium: 'email' }, 'brevo/email'],
  [{ source_detail: 'lee_manual_email' }, 'lee_manual_email'],
  [{ utm_source: 'instagram' }, 'instagram'],
  [{ utm_source: 'facebook' }, 'facebook'],
  [{ utm_source: 'manychat' }, 'manychat'],
  [{ utm_source: 'tiktok' }, 'tiktok'],
  [{ utm_source: 'x' }, 'x'],
  [{ utm_source: 'meta', utm_medium: 'paid_social' }, 'meta_ads'],
  [{ utm_source: 'google', utm_medium: 'organic' }, 'google_organic'],
  [{ utm_source: 'google', utm_medium: 'cpc', gclid: 'abc' }, 'google_ads'],
  [{}, 'direct'],
  [{ utm_source: 'partner', referrer: 'https://example.com' }, 'unknown'],
]
for (const [input, expected] of cases) assert.equal(classifySource(input), expected)
assert.deepEqual([...SOURCE_TAXONOMY], ['brevo/email', 'lee_manual_email', 'instagram', 'facebook', 'manychat', 'tiktok', 'x', 'meta_ads', 'google_organic', 'google_ads', 'direct', 'unknown'])
console.log('source taxonomy tests passed')
