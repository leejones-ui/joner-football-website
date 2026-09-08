import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const pagePath = new URL('../src/pages/player-waiver.astro', import.meta.url)
const api = await readFile(new URL('../api/contact-enquiry.js', import.meta.url), 'utf8')

await assert.rejects(access(pagePath), { code: 'ENOENT' })
assert.doesNotMatch(api, /player-waiver|handlePlayerWaiver|airtableRequest|AIRTABLE_WAIVER/i)
assert.doesNotMatch(api, /Term\s*3/i)

console.log('player waiver route removed; Airtable remains outside website: ok')
