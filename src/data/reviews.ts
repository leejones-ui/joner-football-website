export type JonerReview = {
  id: string
  quote: string
  name: string
  audience: 'Player' | 'Parent' | 'Coach' | 'Coach and parent'
  country?: string
  product: string
  date: string
  dateLabel: string
  source: string
  sourceDetail: string
  tags: string[]
}

// Public-safe excerpts transcribed from the canonical Joner App Testimonials Bank.
// Names are deliberately limited to first name plus surname initial where available.
export const jonerReviews: JonerReview[] = [
  {
    id: 'adam-z-scanning-awareness',
    quote: 'Used this session for our Ladies open age team. Layering the session and building up the progression really did help them all develop better scanning and awareness to find the space and not get attracted to the ball. Much love from Manchester UK.',
    name: 'Adam Z.', audience: 'Coach', country: 'United Kingdom',
    product: 'Team Training: Scanning, Awareness & Possession', date: '2026-02-20', dateLabel: '20 February 2026',
    source: 'Joner Football App', sourceDetail: 'Verified video comment',
    tags: ['Coach reviews', 'Training transformations', 'Teams and clubs'],
  },
  {
    id: 'matthew-b-coaches-area',
    quote: 'The app is great, love the YouTube feel to it. I have been following you for years and have a massive YouTube library of your work, so having it based around the same setup is very helpful. I am in this for the coaches area and it is very helpful. I am starting to use it more and more.',
    name: 'Matthew B.', audience: 'Coach', product: 'Joner Football App, Coaches area', date: '2026-05-22', dateLabel: '22 May 2026',
    source: 'Joner Football App', sourceDetail: 'Community review posted in response to Lee’s public feedback request',
    tags: ['Joner Football App reviews', 'Coach reviews'],
  },
  {
    id: 'krzysztof-s-coaching-detail',
    quote: 'I found the content on the app very useful because it is absolutely full of key coaching points focusing on the players, a positive approach, and explanations of why things need to be coached a certain way. I have learned so much from you guys here.',
    name: 'Krzysztof S.', audience: 'Coach', product: 'Joner Football App', date: '2026-05-22', dateLabel: '22 May 2026',
    source: 'Joner Football App', sourceDetail: 'Community review posted in response to Lee’s public feedback request',
    tags: ['Joner Football App reviews', 'Coach reviews'],
  },
  {
    id: 'matthew-h-community-impact',
    quote: 'Because of you and the content you have provided, I started a not-for-profit helping local players aged 6 to 16 with technical development. I love to see players learn a new skill and gain confidence. You have truly helped my local players and me with your content. From the bottom of my heart, thank you.',
    name: 'Matthew H.', audience: 'Coach', product: 'Joner Football coaching content', date: '2026-06-01', dateLabel: 'June 2026',
    source: 'Joner Football member email', sourceDetail: 'App winback reply; excerpt lightly edited for length',
    tags: ['Coach reviews', 'Training transformations'],
  },
  {
    id: 'matthew-b-grassroots-teams',
    quote: 'I have been with you for years and both my grassroots teams have massively benefited, so thank you.',
    name: 'Matthew B.', audience: 'Coach', product: 'Joner Football App, Coaches Only', date: '2026-06-01', dateLabel: 'June 2026',
    source: 'Joner Football App', sourceDetail: 'Verified Coaches Only community comment',
    tags: ['Coach reviews', 'Teams and clubs', 'Training transformations'],
  },
  {
    id: 'josh-p-first-video',
    quote: 'You are great, thanks for the help. This is the first video I saw in this app and it already helped.',
    name: 'Josh P.', audience: 'Player', product: 'Joner Football App', date: '2026-06-01', dateLabel: 'June 2026',
    source: 'Joner Football App', sourceDetail: 'Verified video comments combined for readability',
    tags: ['Joner Football App reviews', 'Player reviews'],
  },
  {
    id: 'ollie-dribbling-program',
    quote: 'Thank you, this really helped me improve.',
    name: 'Ollie', audience: 'Player', product: 'Dribbling Program, Session 1', date: '2026-07-25', dateLabel: '25 July 2026',
    source: 'Joner Football App', sourceDetail: 'Verified video comment',
    tags: ['Player reviews', 'Training transformations'],
  },
  {
    id: 'alfred-c-father-and-sons',
    quote: 'I have only recently discovered your material and signed up a few weeks ago. I just wanted to acknowledge how wonderful your app and training drills are. I have enjoyed getting off my backside, heading to a local park and training with my boys. As a father who really did not know where to begin coaching my boys, to someone who is now spending more time with them, a very big thank you.',
    name: 'Alfred C.', audience: 'Parent', product: 'Joner Football App', date: '2026-07-23', dateLabel: '23 July 2026',
    source: 'Joner Football App', sourceDetail: 'Member direct message; name shortened for privacy',
    tags: ['Joner Football App reviews', 'Parent reviews', 'Training transformations'],
  },
  {
    id: 'brandon-w-u9-team',
    quote: 'These have been great. I coach a U9 girls team. Our season just started and I have broken each session up to be the opening of our practices. We did session one last night. I am going to do sessions two and three next week.',
    name: 'Brandon W.', audience: 'Coach', product: 'Dribbling Program', date: '2026-08-08', dateLabel: '8 August 2026',
    source: 'Joner Football App', sourceDetail: 'Verified video comment',
    tags: ['Coach reviews', 'Teams and clubs'],
  },
  {
    id: 'colin-s-every-session',
    quote: 'I use the app for every one of my training sessions. You have outstanding, applicable content. I am looking forward to the new goalkeeper training you have coming out as well.',
    name: 'Colin S.', audience: 'Coach and parent', country: 'United States', product: 'Joner Football App, Max Annual', date: '2026-08-10', dateLabel: '10 August 2026',
    source: 'Joner Football App', sourceDetail: 'Verified community comment from a live Max Annual member',
    tags: ['Joner Football App reviews', 'Coach reviews', 'Teams and clubs'],
  },
  {
    id: 'sae-passing-shooting',
    quote: 'It is so good. Thanks, it helped my passing and shooting.',
    name: 'Sae', audience: 'Player', product: 'Individual Shooting Drills Using A Rebound Board', date: '2026-08-02', dateLabel: '2 August 2026',
    source: 'Joner Football App', sourceDetail: 'Verified video comment; punctuation normalised',
    tags: ['Player reviews', 'Training transformations'],
  },
  {
    id: 'nathaniel-t-coaching-journey',
    quote: 'Thank you for all your videos and content over the years. You have been a big part of my coaching journey and me developing my skills.',
    name: 'Nathaniel T.', audience: 'Coach', product: 'Joner Football App, Max', date: '2026-08-01', dateLabel: '1 August 2026',
    source: 'Joner Football App', sourceDetail: 'Member direct message; name shortened for privacy',
    tags: ['Joner Football App reviews', 'Coach reviews', 'Training transformations'],
  },
]

export const reviewSections = [
  'All reviews', 'Joner Football App reviews', 'Player reviews', 'Parent reviews', 'Coach reviews', 'Training transformations', 'Teams and clubs',
] as const
