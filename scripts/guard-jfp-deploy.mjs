import { readFileSync } from 'node:fs'

// Production only ever goes live from GitHub main (git push origin main).
// On 12 Oct 2026 at 8:03pm a hand deploy (`vercel --prod` from an old copy of
// the site) replaced the live site, and the Timetable lost the coach split:
// every Wednesday 6:30am player showed in Dean's group, undoing Lee's moves.
// A hand deploy uploads whatever folder it is run from, however old, so a
// production build without a GitHub commit is refused here.
const prod = process.env.VERCEL_ENV === 'production'
const fromGit = Boolean(process.env.VERCEL_GIT_COMMIT_SHA)
if (prod && !fromGit && process.env.JFP_ALLOW_HAND_DEPLOY !== '1') {
  console.error([
    '',
    'Refusing a production build that did not come from GitHub main.',
    'Commit your change, rebase onto origin/main and run: git push origin HEAD:main',
    'Vercel deploys main by itself. Hand deploys (vercel --prod) have put old',
    'code live before and undone staff work (12 Oct 2026).',
    '',
  ].join('\n'))
  process.exit(1)
}

// Whatever the route, the build must carry the JFP fixes that staff rely on.
// Each line names a fix that an old copy of the site would be missing.
const must = [
  ['api/_jfp-airtable.js', 'bySlot.get(loose(p.day, p.time, p.location))', 'Timetable: players placed by their Coach when several coaches share a session'],
  ['api/_jfp-airtable.js', '~unplaced', 'Timetable: a player with no coach at a split session waits in "Not in a group", never in another coach\'s group'],
  ['api/jfp-portal-data.js', "'Coach': coach.airtableName", 'Moving a player writes the new coach to Airtable'],
]
const missing = must.filter(([file, needle]) => !readFileSync(file, 'utf8').includes(needle))
if (missing.length) {
  console.error('\nThis copy of the site is missing JFP fixes that are live on main:')
  for (const [file, , what] of missing) console.error(`  - ${what} (${file})`)
  console.error('Rebase onto origin/main before building.\n')
  process.exit(1)
}
