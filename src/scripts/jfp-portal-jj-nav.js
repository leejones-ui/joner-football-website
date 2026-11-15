// The Joners Juniors menu, on its own so the portal can show it without
// loading the Juniors pages until one is opened (15 Nov 2026).
export const JJ_NAV = ['Joners Juniors', [['jj-dashboard', 'Dashboard'], ['jj-players', 'Players'], ['jj-invites', 'Invites'], ['jj-requests', 'Requests & waitlist'], ['jj-classes', 'Classes'], ['jj-registers', 'Registers'], ['jj-messages', 'Messages'], ['jj-money', 'Money'], ['jj-settings', 'Settings']]]
export const JJ_TABS = new Set(JJ_NAV[1].map(([k]) => k))
// The sidebar icon each Juniors page borrows from its JFP twin.
export const JJ_ICON = { 'jj-dashboard': 'overview', 'jj-players': 'families', 'jj-invites': 'invites', 'jj-requests': 'requests', 'jj-classes': 'groups', 'jj-registers': 'coach', 'jj-messages': 'messages', 'jj-money': 'money', 'jj-settings': 'settings' }
