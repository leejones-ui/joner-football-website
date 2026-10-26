// Fills the per family sets (26 Oct 2026, Upstash bandwidth) for payment
// requests, applications and bookings saved before the sets existed, then sets
// jfp:idx:ready so My account reads only a family's own records. Adds set
// entries only: no record is changed, moved or deleted. Safe to run again.
// Dry run by default (counts only); --apply writes. Needs Lee's yes on live.
// --verify (read only) compares the full scan with the sets for every email
// and Term 4 row any record names: ids missing from a set would hide a record
// from My account, so it must show 0 missing before jfp:idx:ready is set.
// Run --apply --no-ready, then --verify, then --apply again to set ready.
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/jfp-backfill-family-index.mjs [--apply [--no-ready] | --verify]
import { familyIndexCommands, FAMILY_INDEX_READY, kvCommand, kvPipeline, keys } from '../api/_jfp-store.js'

const apply = process.argv.includes('--apply'), verify = process.argv.includes('--verify'), noReady = process.argv.includes('--no-ready')
const kinds = [['payreq', keys.payreqs(), keys.payreq], ['application', keys.applications(), keys.application], ['booking', keys.bookings(), keys.booking]]
let commands = 0, missing = 0, extra = 0, sets = 0
for (const [kind, index, recordKey] of kinds) {
  const ids = (await kvCommand(['ZRANGE', index, '0', '-1'])) || []
  const want = new Map()
  let records = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = (await kvPipeline(ids.slice(i, i + 100).map((id) => ['GET', recordKey(id)]))).map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }).filter(Boolean)
    const cmds = batch.flatMap((r) => familyIndexCommands(kind, r))
    records += batch.length; commands += cmds.length
    for (const [op, set, id] of cmds) if (op === 'SADD') { if (!want.has(set)) want.set(set, new Set()); want.get(set).add(id) }
    if (apply && cmds.length) await kvPipeline(cmds)
  }
  let kindMissing = 0, kindExtra = 0
  if (verify) {
    const names = [...want.keys()]
    for (let i = 0; i < names.length; i += 100) {
      const got = await kvPipeline(names.slice(i, i + 100).map((k) => ['SMEMBERS', k]))
      names.slice(i, i + 100).forEach((k, j) => {
        const have = new Set(got[j] || []), need = want.get(k)
        for (const id of need) if (!have.has(id)) kindMissing++
        for (const id of have) if (!need.has(id)) kindExtra++
      })
    }
    missing += kindMissing; extra += kindExtra; sets += names.length
  }
  console.log(`${kind}: ${ids.length} in the index, ${records} records read, ${want.size} family sets` + (verify ? `, ${kindMissing} missing, ${kindExtra} extra` : ''))
}
if (verify) {
  // Extra ids are harmless (an email changed on a record; every reader checks
  // the record itself). Missing ids are not: they would hide a record.
  console.log(`Verify: ${sets} sets checked, ${missing} missing, ${extra} extra. ${missing ? 'NOT READY: do not set ' + FAMILY_INDEX_READY : 'OK to set ' + FAMILY_INDEX_READY}`)
  process.exit(missing ? 1 : 0)
}
if (apply && !noReady) await kvCommand(['SET', FAMILY_INDEX_READY, new Date().toISOString()])
console.log(apply ? `Done: ${commands} set commands${noReady ? '' : `, ${FAMILY_INDEX_READY} set`}.` : `Dry run: would send ${commands} set commands. Add --apply to write.`)
