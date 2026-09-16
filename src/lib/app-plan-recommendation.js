// Roles personalise the journey; they never determine the paid tier.
export const audiences = [
  { id: 'player', title: 'Player' },
  { id: 'parent', title: 'Parent / guardian' },
  { id: 'team-coach', title: 'Team coach' },
  { id: 'individual-coach', title: '1-to-1 / small-group coach' },
  { id: 'organiser', title: 'Club / academy / school organiser' },
  { id: 'fan', title: 'I just love football' },
]
export const goals = [
  { id: 'basics', title: 'Build the basics' },
  { id: 'programme', title: 'Follow a training programme' },
  { id: 'child', title: 'Help my child improve' },
  { id: 'level-up', title: 'Take my game further' },
  { id: 'coaching', title: 'Improve my coaching' },
  { id: 'planning', title: 'Plan better sessions' },
  { id: 'team', title: 'Help my team improve' },
]
// Public plan contract, not category membership: categories can mix tier samples.
// Plus goalkeeper / recorded-live collections verified in Uscreen 2026-09-16.
export const contentGroups = [
  { title: 'Player training', options: [
    { id: 'follow-along', title: 'Solo follow-along training', tier: 'starter' },
    { id: 'programmes', title: 'Training programmes', tier: 'plus' },
    { id: 'advanced', title: 'Advanced drills & 1v1s', tier: 'plus' },
    { id: 'position', title: 'Position-specific training', tier: 'max' },
    { id: 'goalkeeper', title: 'Goalkeeper training', tier: 'plus' },
    { id: 'mindset', title: 'Mindset & confidence', tier: 'plus' },
  ] },
  { title: 'Learn from Lee', options: [
    { id: 'live', title: 'Live sessions & replays', tier: 'plus' },
    { id: 'raw', title: 'Watch Lee coach — raw footage', tier: 'max' },
    { id: 'voice-over', title: 'Voice-over breakdowns', tier: 'max' },
    { id: 'pro', title: 'Pro training & tactics', tier: 'max' },
  ] },
  { title: 'Coaching resources', options: [
    { id: 'team-training', title: 'Team-training sessions', tier: 'max' },
    { id: 'session-plans', title: 'Session plans & PDFs', tier: 'max' },
    { id: 'coach-education', title: 'Coach education', tier: 'max' },
  ] },
]
export const contentOptions = contentGroups.flatMap(group => group.options)
const rank = { starter: 0, plus: 1, max: 2 }
const valid = (values, allowed) => Array.isArray(values) && values.length > 0 && values.every(id => allowed.includes(id))

export function needsGroupQuestion({ roles = [], goals: selectedGoals = [] } = {}) {
  return roles.some(id => ['team-coach', 'individual-coach', 'organiser'].includes(id)) || selectedGoals.includes('team')
}
export function needsCoachingClarification({ goals: selectedGoals = [], content = [], fullLibrary = false, access } = {}) {
  return !fullLibrary && !['group', 'both'].includes(access)
    && selectedGoals.some(id => ['coaching', 'planning'].includes(id))
    && !contentOptions.some(option => content.includes(option.id) && option.tier === 'max')
}
export function recommendAppPlan(answers = {}) {
  const { roles, goals: selectedGoals, content = [], fullLibrary = false, access, coaching } = answers
  if (!valid(roles, audiences.map(x => x.id)) || !valid(selectedGoals, goals.map(x => x.id))) return null
  if (typeof fullLibrary !== 'boolean' || !Array.isArray(content) || content.some(id => !contentOptions.some(x => x.id === id))) return null
  if (!fullLibrary && !content.length) return null
  if (access !== undefined && !['individual', 'group', 'both'].includes(access)) return null
  if (coaching !== undefined && !['include', 'training-only'].includes(coaching)) return null
  if (needsGroupQuestion(answers) && !access) return { needs: 'access' }
  if (['group', 'both'].includes(access)) return {
    id: 'club', name: 'Joner Football Teams',
    reason: 'Separate accounts, assignments and tracking for your group.',
    matches: ['Separate player and coach logins', 'Assignments and player progress', 'A plan for your group’s player and coach numbers'],
    note: 'App access varies by Teams plan and role.',
  }
  if (needsCoachingClarification(answers) && !coaching) return { needs: 'coaching' }
  const selected = contentOptions.filter(option => content.includes(option.id))
  let tier = fullLibrary || coaching === 'include' ? 'max' : 'starter'
  if (selectedGoals.includes('programme') && rank[tier] < rank.plus) tier = 'plus'
  for (const option of selected) if (rank[option.tier] > rank[tier]) tier = option.tier
  const name = { starter: 'Starter', plus: 'Plus', max: 'Max' }[tier]
  const matches = fullLibrary ? ['The full App library', 'Everything in Starter and Plus', 'Coaches Only, session plans and breakdowns'] : selected.map(x => x.title)
  if (!fullLibrary && selectedGoals.includes('programme') && !content.includes('programmes')) matches.unshift('A structured training programme')
  if (!fullLibrary && coaching === 'include' && !content.includes('coach-education')) matches.unshift('Coaches Only resources')
  const reason = {
    starter: 'The right fit for your solo follow-along training.',
    plus: 'Covers your training and development choices.',
    max: fullLibrary ? 'The full App library, including Coaches Only.' : 'The plan that covers all your picks.',
  }[tier]
  return { id: tier, name, reason, matches, note: 'One personal account. Team logins and assignments are separate.' }
}
