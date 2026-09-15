const audiences = new Set(['self', 'child', 'team'])
const goals = new Set(['basics', 'programme', 'coaching'])
const accessLevels = new Set(['training', 'coaches', 'team'])

export function recommendAppPlan({ audience, goal, access }) {
  if (!audiences.has(audience) || !goals.has(goal) || !accessLevels.has(access)) return null
  if (audience === 'team' || access === 'team') return { id:'club', name:'Joner Football Teams', reason:'Player and coach logins, assignments and a shared team space.' }
  if (access === 'coaches' || goal === 'coaching') return { id:'max', name:'Max', reason:'The full App, including Coaches Only, session plans and game study.' }
  if (goal === 'programme') return { id:'plus', name:'Plus', reason:'Structured programmes, including the 100 Day Transformation Program.' }
  return { id:'starter', name:'Starter', reason:'Solo follow-along sessions and the essentials to build your skills.' }
}
