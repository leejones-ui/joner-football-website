// Players master tooling (Lee, 20 Oct 2026). Reads the JFP Airtable base and
// works out which rows are the same child. Counts only: never prints names,
// phones, dates of birth or medical notes.
import fs from 'node:fs'
const envFile = process.env.JFP_ENV || `${process.env.HOME}/.hermes/secrets/jf-website-production.env`
const env = {}
for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
export const BASE = 'apphU4R0BtVIu5YqT'
const TOKEN = env.JFP_AIRTABLE_TOKEN || env.AIRTABLE_API_TOKEN || env.AIRTABLE_TOKEN
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function at(path, { method = 'GET', body } = {}, n = 0) {
  const r = await fetch(`https://api.airtable.com/v0/${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let d = {}; try { d = JSON.parse(t) } catch {}
  if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(600 * 2 ** n); return at(path, { method, body }, n + 1) }
  if (!r.ok) throw new Error(`Airtable ${r.status} ${path.slice(0, 60)}: ${d?.error?.message || d?.error?.type || t.slice(0, 120)}`)
  return d
}
export async function all(tableId) {
  const out = []; let offset
  do { const q = new URLSearchParams({ pageSize: '100', ...(offset ? { offset } : {}) }); const d = await at(`${BASE}/${tableId}?${q}`); out.push(...d.records); offset = d.offset } while (offset)
  return out
}
export const TABLE = {
  profiles: 'tblTt7jWK3s2me45B', term4: 'tbl6OIjkU6UsQCeZV', term3: 'tblF25gfo0fZcqdPT', term2: 'tblFXWwF7l7iKMm2j', oldPlayers: 'tblY4W1OmMzNTAirt',
  waiver: 'tblLziUfKOv1N0f40', ledger: 'tblfrXQLMhOcE2PWH', dropped3: 'tblnlT5eUxKtJFBma', dropped4: 'tblLa3AFkRvlUEQEI', notReturning: 'tblHXBe7BJiRA5rP9',
  nextHolds: 'tblahicOyFRUCf7bL', master: 'tblGMVuC2QaoOxdsN', attendance: 'tblfwc1VO3ind7cVk', applications: 'tblAnkpS9vF4PI8nD',
}
export const norm = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')
export const digits = (v) => String(v || '').replace(/\D/g, '')
export const phoneKey = (v) => { const d = digits(v); return d.length >= 8 ? d.slice(-9) : '' }
export const emailsOf = (v) => (String(v || '').toLowerCase().match(/[^\s,;<>]+@[^\s,;<>]+/g) || [])
export const iso = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : '' }
