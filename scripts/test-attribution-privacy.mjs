import assert from 'node:assert/strict'
import fs from 'node:fs'
const publicEvent = fs.readFileSync(new URL('../api/attribution-event.js', import.meta.url), 'utf8')
const publicReport = fs.readFileSync(new URL('../api/attribution-report.js', import.meta.url), 'utf8')
assert.doesNotMatch(publicEvent, /customer_name|customerName|email\s*:/)
assert.doesNotMatch(publicReport, /customer_name|customerName/)
console.log('public attribution payload privacy tests passed')
