// The banner logic, lifted exactly, so the four states can be asserted.
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m/60)} h ago` }
const esc = (x) => String(x)
function line(relay) {
  const STALE_MIN = 10
  const relayAgeMin = relay?.at ? Math.round((Date.now() - Date.parse(relay.at)) / 60000) : null
  const stale = relayAgeMin != null && relayAgeMin > STALE_MIN
  const warn = (t) => `<b style="color:var(--j-red,#B42318)">${t}</b>`
  return !relay ? warn('The Mac has never checked in. Run ~/jfp-text watch on the HQ Mac.')
    : relay.ok === false ? `Mac last checked in ${ago(relay.at)} · ${warn(esc(relay.problem || 'not ready'))}`
    : stale ? `Mac last checked in ${ago(relay.at)} · ${warn('nothing is running on the Mac, so texts will sit here. Run ~/jfp-text watch on the HQ Mac.')}`
    : `Mac checked in ${ago(relay.at)}`
}
const mins = (n) => new Date(Date.now() - n*60000).toISOString()
let fail = 0
const check = (name, got, mustWarn, mustSay) => {
  const warned = got.includes('B42318')
  const said = !mustSay || got.includes(mustSay)
  if (warned === mustWarn && said) console.log('ok -', name)
  else { fail++; console.log('FAIL -', name, '->', got.slice(0,120)) }
}
check('never checked in warns and says what to run', line(null), true, '~/jfp-text watch')
check('healthy recent check-in does NOT warn', line({at: mins(2), ok: true}), false)
check('6 hours stale warns (Lee\'s case)', line({at: mins(360), ok: true}), true, 'nothing is running')
check('stale warning names the command', line({at: mins(360), ok: true}), true, '~/jfp-text watch')
check('permission problem still warns', line({at: mins(1), ok: false, problem: 'Cannot read Messages'}), true, 'Cannot read Messages')
check('11 minutes is stale', line({at: mins(11), ok: true}), true, 'nothing is running')
check('9 minutes is not stale', line({at: mins(9), ok: true}), false)
console.log(fail ? `\n${fail} failed` : '\n7 relay banner checks passed')
process.exit(fail ? 1 : 0)
