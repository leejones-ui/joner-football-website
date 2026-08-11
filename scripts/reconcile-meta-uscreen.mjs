import fs from 'node:fs'
import { reconcileAttributedConversions } from './lib/meta-uscreen-reconciliation.mjs'

function load(path, label) {
  let raw
  try { raw = fs.readFileSync(path, 'utf8') } catch { throw new Error(`Could not read ${label} file`) }
  try { return JSON.parse(raw) } catch { throw new Error(`${label} file must be valid JSON`) }
}

const [metaPath, uscreenPath] = process.argv.slice(2)
if (!metaPath || !uscreenPath) {
  console.error('Usage: reconcile-meta-uscreen.mjs <meta-conversions.json> <uscreen-reconciliations.json>')
  process.exit(1)
}

const result = reconcileAttributedConversions({
  metaReport: load(metaPath, 'Meta conversion'),
  uscreenRecords: load(uscreenPath, 'Uscreen reconciliation'),
})
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 2
