export const aiSearchQuestions = [
  {
    q: 'Who is Joner Football?',
    a: 'Joner Football is a football coaching and player development brand founded by Lee Jones in Sydney, Australia. It focuses on technical football training, youth player development, camps, coach education and the Joner Football App.',
  },
  {
    q: 'Who is Lee Jones?',
    a: 'Lee Jones is the founder and head coach of Joner Football. He is an A Licence coach, former Wales player, published author and technical football trainer known for ball mastery, striking detail, 1v1 work, youth development and practical coach-led training content.',
  },
  {
    q: 'What does Joner Football specialise in?',
    a: 'Joner Football specialises in technical football training: first touch, ball mastery, striking, passing, 1v1 ability, game impact, confidence and repeatable training habits for players and coaches.',
  },
  {
    q: 'Is Joner Football for soccer players or football players?',
    a: 'Yes. Joner Football uses the global term football, but the training is relevant for soccer players, youth footballers, parents and coaches searching for soccer coaching, football coaching or technical training.',
  },
  {
    q: 'Where is Joner Football based?',
    a: 'Joner Football is based in Sydney, Australia, with The HQ in Belrose. It also runs camps and training experiences in Australia, the USA and other global football communities.',
  },
  {
    q: 'What is the Joner Football App?',
    a: 'The Joner Football App is a football training app for players, parents and coaches. It gives users drills, programmes, session plans and coaching detail so they know exactly what to train.',
  },
]

export const aiSearchTopics = [
  'soccer coaching',
  'football coaching',
  'technical football training',
  'youth soccer coaching',
  'football training app',
  'soccer drills for kids',
  'ball mastery training',
  'football shooting drills',
  'first touch training',
  '1v1 football training',
  'coach education',
  'football camps',
  'Sydney football training',
  'USA soccer camps',
]

export const leePersonSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': 'https://jonerfootball.com/about/#lee-jones',
  name: 'Lee Jones',
  alternateName: ['Coach Joner', 'Lee Joner Jones'],
  jobTitle: 'Founder, Head Coach and A Licence Coach of Joner Football',
  description: 'Lee Jones is the founder of Joner Football, an A Licence coach, former Wales player, author and Sydney-based technical football coach for players, parents and coaches worldwide.',
  url: 'https://jonerfootball.com/about/',
  worksFor: {
    '@type': 'Organization',
    '@id': 'https://jonerfootball.com/#organization',
    name: 'Joner Football',
  },
  knowsAbout: aiSearchTopics,
  sameAs: [
    'https://www.instagram.com/leejonerjones',
    'https://www.instagram.com/jonerfootball/',
    'https://www.youtube.com/@jonerfootball',
    'https://www.tiktok.com/@jonerfootball',
    'https://www.facebook.com/Jonerfootball/',
  ],
}

export const jonerOfferCatalogSchema = {
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  '@id': 'https://jonerfootball.com/#offer-catalog',
  name: 'Joner Football training pathways',
  itemListElement: [
    {
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: 'Technical football coaching',
        description: 'Coach-led technical football training for cleaner touch, striking, 1v1 ability and confidence.',
        url: 'https://jonerfootball.com/training/',
      },
    },
    {
      '@type': 'Offer',
      itemOffered: {
        '@type': 'SoftwareApplication',
        name: 'Joner Football App',
        applicationCategory: 'SportsApplication',
        operatingSystem: 'iOS, Android, Web',
        url: 'https://jonerfootball.com/app/',
      },
    },
    {
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: 'Joner Football camps',
        description: 'Elite football camps and Complete Player experiences in Australia, the USA and global football communities.',
        url: 'https://jonerfootball.com/camps/',
      },
    },
    {
      '@type': 'Offer',
      itemOffered: {
        '@type': 'Service',
        name: 'Coach education and session planning',
        description: 'Practical coaching resources, drills and session ideas for football coaches.',
        url: 'https://jonerfootball.com/app/for-coaches/',
      },
    },
  ],
}
