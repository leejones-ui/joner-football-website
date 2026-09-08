import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../src/pages/player-waiver.astro', import.meta.url), 'utf8')
const api = await readFile(new URL('../api/contact-enquiry.js', import.meta.url), 'utf8')
const airtableUrl = 'https://airtable.com/apphU4R0BtVIu5YqT/pagdSqWlCfZJyiPxq/form'

assert.match(page, new RegExp(airtableUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.match(page, /JFP Player Info \+ Waiver Form/)
assert.match(page, /parents and guardians must complete/i)
assert.doesNotMatch(page, /<form\b/i)
assert.doesNotMatch(page, /fetch\s*\(/i)
assert.doesNotMatch(page, /method\s*=\s*["']POST["']/i)
assert.doesNotMatch(page, /payment|make-up|emergency treatment|liability|media permission|three[- ]strike|term\s*3/i)
assert.doesNotMatch(api, /player-waiver|handlePlayerWaiver|airtableRequest|AIRTABLE_WAIVER/i)
assert.doesNotMatch(api, /Term\s*3/i)

console.log('player waiver route uses Airtable handoff only: ok')
