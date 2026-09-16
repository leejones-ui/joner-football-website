// Roles personalise the journey; they never determine the paid tier.
export const audiences = [
  { id: 'player', title: 'A player', detail: 'Working on my own game' },
  { id: 'parent', title: 'A parent or guardian', detail: 'Supporting my child’s football' },
  { id: 'team-coach', title: 'A team coach', detail: 'Developing players and a squad' },
  { id: 'individual-coach', title: 'A 1-to-1 or small-group coach', detail: 'Making every session count' },
  { id: 'organiser', title: 'A club, academy or school organiser', detail: 'Bringing football to a wider group' },
  { id: 'fan', title: 'A football fan', detail: 'I just love learning about the game' },
]
export const goals = [
  { id: 'basics', title: 'Master the basics', detail: 'Build stronger foundations with the ball' },
  { id: 'programme', title: 'Follow a structured programme', detail: 'Know what to work on, session by session' },
  { id: 'child', title: 'Help my child improve', detail: 'Support their skills and enjoyment' },
  { id: 'level-up', title: 'Take my game to the next level', detail: 'Challenge myself and keep progressing' },
  { id: 'coaching', title: 'Become a better coach', detail: 'Coach with more confidence and clarity' },
  { id: 'planning', title: 'Plan better sessions', detail: 'Bring fresh ideas to the training pitch' },
  { id: 'team', title: 'Help my team develop', detail: 'Improve how my players train and perform' },
]
// Public plan contract, not category membership: categories can mix tier samples.
// Plus goalkeeper / recorded-live collections verified in Uscreen 2026-09-16.
export const contentGroups = [
  { title: 'Improve your game', options: [
    { id: 'follow-along', title: 'Train alongside Lee', detail: 'Simple solo follow-along sessions', tier: 'starter' },
    { id: 'programmes', title: 'Follow a complete programme', detail: 'Structured training, including the 100 Day Transformation', tier: 'plus' },
    { id: 'advanced', title: 'Challenge yourself', detail: 'Advanced technical drills and 1v1 training', tier: 'plus' },
    { id: 'position', title: 'Master your position', detail: 'Position-specific training and understanding', tier: 'max' },
    { id: 'goalkeeper', title: 'Develop as a goalkeeper', detail: 'Dedicated goalkeeper training', tier: 'plus' },
    { id: 'mindset', title: 'Build your mindset', detail: 'Confidence, focus and the mental side of football', tier: 'plus' },
  ] },
  { title: 'Learn directly from Lee', options: [
    { id: 'live', title: 'Watch live training', detail: 'Livestream training sessions and recorded replays', tier: 'plus' },
    { id: 'raw', title: 'Go behind the sessions', detail: 'Full raw footage of how Lee coaches and delivers training', tier: 'max' },
    { id: 'voice-over', title: 'Understand the “why”', detail: 'Voice-over breakdowns of drills and coaching decisions', tier: 'max' },
    { id: 'pro', title: 'Study the game', detail: 'Professional training and tactical learning', tier: 'max' },
  ] },
  { title: 'Improve your coaching', options: [
    { id: 'team-training', title: 'Discover fresh team-training ideas', detail: 'Sessions and practices for your players', tier: 'max' },
    { id: 'session-plans', title: 'Plan sessions with confidence', detail: 'Session-plan videos and printable PDF plans', tier: 'max' },
    { id: 'coach-education', title: 'Develop your coaching craft', detail: 'Coaches Only content and session-delivery guidance', tier: 'max' },
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
    reason: 'You want separate player and coach accounts, assignments and progress tracking—not just a personal content library.',
    matches: ['Separate player and coach logins', 'Assignments and player progress', 'A plan for your group’s player and coach numbers'],
    note: 'App access depends on the Teams plan and role. Compare the player and coach allowances before joining.',
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
    starter: 'Simple solo training, without paying for extra content you haven’t asked for.',
    plus: 'A step beyond the basics, with the structured training and development content you’ve chosen.',
    max: fullLibrary ? 'You want the whole picture. Max brings the full App and Coaches Only together.' : 'Your wishlist includes Max-level content. This is the lowest App tier that covers those choices.',
  }[tier]
  return { id: tier, name, reason, matches, note: 'One personal App account. No separate team logins or assignment dashboard.' }
}
