import assert from 'node:assert/strict'
import {
  TEAM_SUBSCRIPTIONS_HEADERS,
  TEAM_SUBSCRIPTIONS_SHEET,
  buildTeamSubscriptionRow,
  isLikelyBotTeamSubmission,
} from '../api/contact-enquiry.js'

assert.equal(TEAM_SUBSCRIPTIONS_SHEET, 'Hot Leads')
assert.deepEqual(TEAM_SUBSCRIPTIONS_HEADERS, [
  'Submitted At', 'Lead ID', 'Priority', 'Due Date', 'Action', 'Status',
  'Name', 'Email', 'Phone', 'Club / Team', 'Number Of Players',
  'Number Of Coaches', 'Location', 'Owner', 'Last Contact', 'Next Action',
  'Source', 'Message', 'Notes',
])

const row = buildTeamSubscriptionRow({
  submittedAt: '2026-08-04T12:34:56.000Z',
  name: 'Test Coach',
  email: 'coach@example.com',
  phone: '+1 555 0100',
  clubTeam: 'Example FC',
  numberOfPlayers: '20',
  numberOfCoaches: '3',
  location: 'Dallas, USA',
  message: 'Interested in Teams',
  attribution: {
    trafficSource: 'Facebook / Instagram Ads',
    campaign: 'Teams launch',
    adId: 'ad-123',
  },
})

assert.equal(row.length, TEAM_SUBSCRIPTIONS_HEADERS.length)
assert.equal(row[1], 'web_20260804123456_Y29hY2hA')
assert.equal(row[5], 'New enquiry')
assert.equal(row[7], 'coach@example.com')
assert.equal(row[9], 'Example FC')
assert.equal(row[13], 'Lee / Reswin')
assert.equal(row[16], 'jonerfootball.com/teams')
assert.match(row[18], /Traffic Source: Facebook \/ Instagram Ads/)
assert.match(row[18], /Campaign: Teams launch/)
assert.match(row[18], /Ad ID: ad-123/)

assert.equal(isLikelyBotTeamSubmission({
  type: 'team-subscriptions',
  name: 'Carl Stanfield',
  clubTeam: 'Seaforth',
  location: 'Sydney',
  numberOfPlayers: '1884',
  numberOfCoaches: '116',
}), false)

console.log('Team Subscriptions three-lane CRM regression test passed')