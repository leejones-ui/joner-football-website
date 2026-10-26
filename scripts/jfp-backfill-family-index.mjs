// Fills the per family sets (26 Oct 2026, Upstash bandwidth) for payment
// requests, applications and bookings saved before the sets existed, then sets
// jfp:idx:ready so My account reads only a family's own records. Adds set
// entries only: no record is changed, moved or deleted. Safe to run again.
// Dry run by default (counts only); --apply writes. Needs Lee's yes on live.
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/jfp-backfill-family-index.mjs [--apply]
import { familyIndexCommands, FAMILY_INDEX_READY, kvCommand, kvPipeline, keys } from '../api/_jfp-store.js'

const apply = process.argv.includes('--apply')
const kinds = [['payreq', keys.payreqs(), keys.payreq], ['application', keys.applications(), keys.application], ['booking', keys.bookings(), keys.booking]]
let commands = 0
for (const [kind, index, recordKey] of kinds) {
  const ids = (await kvCommand(['ZRANGE', index, '0', '-1'])) || []
  let records = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = (await kvPipeline(ids.slice(i, i + 100).map((id) => ['GET', recordKey(id)]))).map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }).filter(Boolean)
    const cmds = batch.flatMap((r) => familyIndexCommands(kind, r))
    records += batch.length; commands += cmds.length
    if (apply && cmds.length) await kvPipeline(cmds)
  }
  console.log(`${kind}: ${ids.length} in the index, ${records} records read`)
}
if (apply) await kvCommand(['SET', FAMILY_INDEX_READY, new Date().toISOString()])
console.log(apply ? `Done: ${commands} set commands, ${FAMILY_INDEX_READY} set.` : `Dry run: would send ${commands} set commands. Add --apply to write.`)
