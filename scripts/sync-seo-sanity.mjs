import {getCliClient} from 'sanity/cli'

const client = getCliClient({apiVersion: '2024-01-01'})

const updates = {
  home: {
    title: 'Joner Football | Football Training App, Drills & Elite Coaching',
    description: 'Train with Joner Football. Improve technique, confidence and game impact with elite coaching, football drills, camps and the Joner Football App.',
    canonicalUrl: 'https://jonerfootball.com/',
    noIndex: false,
  },
  app: {
    title: 'Football Training App | Drills & Programmes | Joner Football',
    description: 'Use the Joner Football App to know exactly what to train. Follow drills, programmes and session plans built to improve technique and confidence.',
    canonicalUrl: 'https://jonerfootball.com/app/',
    noIndex: false,
  },
  'hub-app': {
    title: 'Joner Football App Hub | Free Drills & Training Resources',
    description: 'Explore Joner Football App resources, free drills, training links and useful content for players, parents and coaches who want clearer football training.',
    canonicalUrl: 'https://jonerfootball.com/hub/app/',
    noIndex: false,
  },
  'app-for-coaches': {
    title: 'Football Coaching App | Drills & Session Plans | Joner Football',
    description: 'Give coaches clear football drills, session ideas and technical detail through the Joner Football App. Build sharper sessions for every player.',
    canonicalUrl: 'https://jonerfootball.com/app/for-coaches/',
    noIndex: false,
  },
  teams: {
    title: 'Football Team Training App | Club Subscriptions | Joner Football',
    description: 'Give your football team access to Joner Football training. Team subscriptions help players train with clearer drills, programmes and coach-led detail.',
    canonicalUrl: 'https://jonerfootball.com/teams/',
    noIndex: false,
  },
  join: {
    title: 'Join The Joner Football App | Start Training With Purpose',
    description: 'Join the Joner Football App and start training with purpose. Access drills, programmes and coaching built to improve your technique and confidence.',
    canonicalUrl: 'https://jonerfootball.com/join/',
    noIndex: false,
  },
  camps: {
    title: 'Elite Football Camps | USA & Australia | Joner Football',
    description: 'Train at Joner Football camps in the USA, Australia and worldwide. Improve technique, confidence and game impact with elite coach-led sessions.',
    canonicalUrl: 'https://jonerfootball.com/camps/',
    noIndex: false,
  },
  programmes: {
    title: 'Football Training Programmes | 100 Day Player Programme',
    description: 'Follow structured Joner Football training programmes built to improve technique, confidence and consistency with clear sessions and daily focus.',
    canonicalUrl: 'https://jonerfootball.com/programmes/',
    noIndex: false,
  },
  training: {
    title: 'Sydney Football Training | Elite Coaching & Player Development',
    description: 'Train with Joner Football in Sydney. Improve technique, confidence and game impact through JFP, pro training, juniors and specialist coaching.',
    canonicalUrl: 'https://jonerfootball.com/training/',
    noIndex: false,
  },
}

for (const [pageKey, seo] of Object.entries(updates)) {
  const doc = await client.fetch('*[_type == "page" && pageKey == $pageKey][0]{_id,pageKey,seo}', {pageKey})
  if (!doc?._id) {
    console.log(`MISS ${pageKey}`)
    continue
  }
  const result = await client.patch(doc._id).set({seo}).commit({autoGenerateArrayKeys: true})
  console.log(`UPDATED ${pageKey} ${result._id}`)
}

const readback = await client.fetch('*[_type == "page" && pageKey in $keys]{pageKey,seo}|order(pageKey asc)', {keys: Object.keys(updates)})
console.log(JSON.stringify(readback, null, 2))
