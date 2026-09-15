import assert from 'node:assert/strict'
import { recommendAppPlan } from '../src/lib/app-plan-recommendation.js'
// Expected product recommendations: training, Coaches Only, team access.
const examples = [
 ['self','basics', ['starter','max','club']],
 ['self','programme', ['plus','max','club']],
 ['self','coaching', ['max','max','club']],
 ['child','basics', ['starter','max','club']],
 ['child','programme', ['plus','max','club']],
 ['child','coaching', ['max','max','club']],
 ['team','basics', ['club','club','club']],
 ['team','programme', ['club','club','club']],
 ['team','coaching', ['club','club','club']],
]
for(const [audience,goal,expected] of examples){
 for(const [index,access] of ['training','coaches','team'].entries()){
  assert.equal(recommendAppPlan({audience,goal,access}).id,expected[index],`${audience}/${goal}/${access}`)
 }
}
assert.equal(recommendAppPlan({audience:'coach',goal:'basics',access:'training'}),null)
assert.equal(recommendAppPlan({audience:'self',goal:'basics'}),null)
console.log('27 questionnaire paths and invalid answers pass')
