import assert from 'node:assert/strict'
import fs from 'node:fs'
import { audiences, goals, contentOptions, needsGroupQuestion, recommendAppPlan } from '../src/lib/app-plan-recommendation.js'

const base = { roles: ['player'], goals: ['basics'], content: ['follow-along'] }
const result = changes => recommendAppPlan({ ...base, ...changes })
assert.equal(result({}).id, 'starter')
assert.equal(result({ roles: ['parent'], goals: ['child'] }).id, 'starter')
assert.equal(result({ roles: ['parent'], goals: ['child'], content: ['programmes'] }).id, 'plus')
assert.equal(result({ goals: ['programme'] }).id, 'plus', 'An explicit programme goal must be covered')
assert.equal(result({ goals: ['level-up'] }).id, 'starter', 'Aspiration alone must not upsell')
assert.equal(result({ roles: ['player', 'parent'], content: ['follow-along', 'mindset'] }).id, 'plus')
assert.equal(result({ content: ['goalkeeper'] }).id, 'plus')
assert.equal(result({ content: ['live'] }).id, 'plus')
assert.equal(result({ content: ['raw'] }).id, 'max')
assert.equal(result({ content: ['session-plans'] }).id, 'max')
assert.equal(result({ fullLibrary: true, content: [] }).id, 'max')
assert.deepEqual(result({ roles: ['team-coach'] }), { needs: 'access' })
assert.equal(result({ roles: ['team-coach'], access: 'individual' }).id, 'starter')
assert.equal(result({ roles: ['team-coach'], content: ['team-training'], access: 'individual' }).id, 'max')
assert.equal(result({ roles: ['team-coach'], access: 'group' }).id, 'club')
assert.equal(result({ roles: ['organiser'], access: 'both', fullLibrary: true }).id, 'club')
assert.deepEqual(result({ goals: ['planning'] }), { needs: 'coaching' })
assert.equal(result({ goals: ['planning'], coaching: 'include' }).id, 'max')
assert.equal(result({ goals: ['planning'], coaching: 'training-only' }).id, 'starter')
assert.equal(result({ goals: ['planning'], content: ['raw'] }).id, 'max')
assert.deepEqual(result({ roles: ['team-coach'], goals: ['coaching'] }), { needs: 'access' })
assert.deepEqual(result({ roles: ['team-coach'], goals: ['coaching'], access: 'individual' }), { needs: 'coaching' })
assert.equal(result({ roles: ['team-coach'], goals: ['coaching'], access: 'group' }).id, 'club')
assert.equal(result({ content: ['follow-along', 'follow-along'] }).matches.length, 1)
for (const changes of [{roles: []}, {goals: []}, {content: []}, {roles:['unknown']}, {goals:['unknown']}, {content:['unknown']}, {access:'bad'}, {coaching:'bad'}, {fullLibrary:'true'}, {roles:null}, {content:null}]) assert.equal(result(changes), null)
assert.equal(recommendAppPlan(), null)

// Every non-empty content subset: enough coverage, no points-based escalation.
const rank = { starter: 0, plus: 1, max: 2 }
let combinations = 0
for (let mask = 1; mask < 2 ** contentOptions.length; mask++) {
  const selected = contentOptions.filter((_, i) => mask & (1 << i))
  const expected = Math.max(...selected.map(x => rank[x.tier]))
  const rec = result({content:selected.map(x=>x.id)})
  assert.equal(rank[rec.id], expected)
  assert.equal(rec.matches.length, selected.length)
  combinations++
}
for (const role of audiences) for (const goal of goals) {
  const answers = { ...base, roles:[role.id], goals:[goal.id] }
  const group = needsGroupQuestion(answers)
  const initial = recommendAppPlan(answers)
  if (group) assert.equal(initial.needs, 'access')
  const rec = recommendAppPlan({...answers, access:'individual', coaching:'training-only'})
  assert.equal(rec.id, goal.id === 'programme' ? 'plus' : 'starter')
}
const component = fs.readFileSync(new URL('../src/components/AppPlanFinder.astro', import.meta.url),'utf8')
assert.ok(component.includes('type="checkbox"'))
assert.ok(component.includes('aria-haspopup="dialog"'))
assert.ok(component.includes('dialog.showModal()'))
assert.equal((component.match(/dialog.showModal\(\)/g)||[]).length, 1, 'Only the explicit open action launches the finder')
assert.ok(!component.includes('localStorage'), 'No persistent identity or answer tracking')
assert.ok(component.includes('app-billing-updated'))
assert.ok(component.includes('input.name === \'finder-full\''))
console.log('PASS: '+combinations+' wishlist combinations, all role/goal pairs, group routing, clarification, invalid answers and component guards')
