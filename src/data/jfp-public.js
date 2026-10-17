// Public JFP facts for the search pages (JFP program page and the three venue
// pages), written once here so the visible copy, the FAQ and the JSON-LD all
// say the same thing. Source: the live booking config (api/_jfp-store.js and
// /api/jfp-groups) on 18 Oct 2026.
// UPDATE EACH TERM: term, termRange and prices. Times change every term, so the
// pages describe the pattern and send families to the live timetable.
import { BOOKING_URL } from '../lib/booking'

export const SITE = 'https://jonerfootball.com'
export const JFP_URL = `${SITE}/training/jfp-program/`
export const BOOK_URL = `${BOOKING_URL}/`

export const jfpTerm = {
  term: 'Term 4 2026',
  termRange: 'Monday 12 October to Saturday 19 December 2026',
  weeks: 10,
}

// Prices exactly as the public Pricing tab on /jfp-booking/ shows them.
export const jfpPrices = {
  group: 850,
  twoAWeek: 1500,
  pathway: 450,
  trial: 85,
  kit: 60,
}

export const kitUrl = 'https://www.besteamsport.com.au/collections/joner-football'

const aud = (n) => `A$${n.toLocaleString('en-AU')}`
export const priceText = {
  group: aud(jfpPrices.group),
  twoAWeek: aud(jfpPrices.twoAWeek),
  pathway: aud(jfpPrices.pathway),
  trial: aud(jfpPrices.trial),
  kit: aud(jfpPrices.kit),
}

export const venues = [
  {
    slug: 'belrose-hq',
    id: 'belrose',
    name: 'Belrose HQ',
    longName: 'Joner Football HQ, Belrose',
    placeName: 'Joner Football HQ',
    street: 'Unit 2, 20 Narabang Way',
    locality: 'Belrose',
    postcode: '2085',
    addressLine: 'Joner Football HQ, 20 Narabang Way (Unit 2), Belrose NSW 2085',
    area: 'Northern Beaches',
    maps: 'https://www.google.com/maps/search/?api=1&query=20+Narabang+Way+Belrose+NSW+2085',
    photo: '/images/hq/hq-hero-lee-exterior.webp',
    photoAlt: 'Lee Jones outside the Joner Football HQ in Belrose',
    indoor: true,
    card: 'Indoor, all weather. After school, early morning and Saturday groups.',
    nearby: ['Frenchs Forest', 'Davidson', 'Forestville', 'Terrey Hills', 'St Ives', 'Killarney Heights', 'Dee Why'],
  },
  {
    slug: 'north-turramurra',
    id: 'ntra',
    name: 'North Turramurra',
    longName: 'North Turramurra Recreation Area',
    placeName: 'North Turramurra Recreation Area',
    street: 'Bobbin Head Road',
    locality: 'North Turramurra',
    postcode: '2074',
    addressLine: 'North Turramurra Recreation Area, Bobbin Head Road, North Turramurra NSW 2074',
    area: 'Upper North Shore',
    maps: 'https://www.google.com/maps/search/?api=1&query=North+Turramurra+Recreation+Area+Bobbin+Head+Road+NSW+2074',
    photo: '/images/training/jfp/jfp-ntra-field.jpg',
    photoAlt: 'The JFP training field at North Turramurra Recreation Area',
    indoor: false,
    card: 'Outdoor field. Early morning groups on Wednesday and Thursday.',
    nearby: ['Turramurra', 'Wahroonga', 'Warrawee', 'South Turramurra', 'St Ives', 'Pymble', 'Hornsby'],
  },
  {
    slug: 'rydalmere',
    id: 'rydalmere',
    name: 'Rydalmere Park',
    longName: 'Rydalmere Park',
    placeName: 'Rydalmere Park',
    street: 'South Street',
    locality: 'Rydalmere',
    postcode: '2116',
    addressLine: 'Rydalmere Park, South Street, Rydalmere NSW 2116',
    area: 'Parramatta',
    maps: 'https://www.google.com/maps/search/?api=1&query=Rydalmere+Park+South+Street+Rydalmere+NSW+2116',
    photo: '/images/training/jfp/jfp-training-4.webp',
    photoAlt: 'Joner Football Performance players in a small group session',
    indoor: false,
    card: 'Outdoor field. Early morning groups on Friday.',
    nearby: ['Ermington', 'Dundas', 'Telopea', 'Parramatta', 'Oatlands', 'Carlingford', 'Melrose Park'],
  },
]

export const venuePath = (v) => `/training/jfp-program/${v.slug}/`

export function postalAddress(v) {
  return {
    '@type': 'PostalAddress',
    streetAddress: v.street,
    addressLocality: v.locality,
    addressRegion: 'NSW',
    postalCode: v.postcode,
    addressCountry: 'AU',
  }
}

// The JFP service itself, for JSON-LD. Offers mirror the visible FAQ answer.
export function jfpServiceSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${JFP_URL}#service`,
    name: 'Joner Football Performance (JFP)',
    alternateName: 'JFP',
    serviceType: 'Small group youth football training',
    description: `Term by term small group football (soccer) training in Sydney for players aged 8 and over. ${jfpTerm.weeks} week terms, 60 minute sessions, up to three sessions a week, at the indoor Joner Football HQ in Belrose, North Turramurra and Rydalmere Park.`,
    url: JFP_URL,
    provider: { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'Joner Football' },
    areaServed: [
      { '@type': 'City', name: 'Sydney' },
      { '@type': 'AdministrativeArea', name: 'Northern Beaches' },
      { '@type': 'AdministrativeArea', name: 'Upper North Shore' },
      { '@type': 'AdministrativeArea', name: 'Parramatta' },
    ],
    audience: { '@type': 'PeopleAudience', suggestedMinAge: 8 },
    availableChannel: { '@type': 'ServiceChannel', serviceUrl: `${SITE}${BOOK_URL}` },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `JFP prices, ${jfpTerm.term}`,
      itemListElement: [
        { '@type': 'Offer', name: 'Small group, one session a week for the term', price: String(jfpPrices.group), priceCurrency: 'AUD', url: `${SITE}${BOOK_URL}` },
        { '@type': 'Offer', name: 'Two sessions a week, or two siblings', price: String(jfpPrices.twoAWeek), priceCurrency: 'AUD', url: `${SITE}${BOOK_URL}` },
        { '@type': 'Offer', name: 'JFP Pathway term, younger players', price: String(jfpPrices.pathway), priceCurrency: 'AUD', url: `${SITE}${BOOK_URL}` },
        { '@type': 'Offer', name: 'Trial session (comes off the term fee)', price: String(jfpPrices.trial), priceCurrency: 'AUD', url: `${SITE}${BOOK_URL}` },
      ],
    },
  }
}
