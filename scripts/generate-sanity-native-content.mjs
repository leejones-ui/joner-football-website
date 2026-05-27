import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const blogDir = path.join(projectRoot, 'src/pages/blog')
const blogOutputPath = path.join(projectRoot, 'tmp-sanity-blog-posts.ndjson')
const campOutputPath = path.join(projectRoot, 'tmp-sanity-camps.ndjson')

const slugToId = (slug) => slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()

const decodeEntities = (value) =>
  String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const stripHtml = (value) =>
  decodeEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[23]>/gi, '\n\n')
      .replace(/<li>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const createSpan = (text, marks = []) => ({
  _type: 'span',
  _key: `span-${Math.random().toString(36).slice(2, 10)}`,
  text,
  marks,
})

function parseInline(content, markDefs = [], activeMarks = []) {
  const children = []
  let remaining = String(content || '')

  while (remaining.length > 0) {
    const tagMatch = remaining.match(/<(a|strong|em)\b([^>]*)>/i)
    if (!tagMatch || tagMatch.index === undefined) {
      const text = decodeEntities(remaining)
      if (text) children.push(createSpan(text, activeMarks))
      break
    }

    const index = tagMatch.index
    const before = remaining.slice(0, index)
    if (before) children.push(createSpan(decodeEntities(before), activeMarks))

    const tag = tagMatch[1].toLowerCase()
    const attributes = tagMatch[2] || ''
    const openTag = tagMatch[0]
    const closeTag = `</${tag}>`
    const closeIndex = remaining.indexOf(closeTag, index + openTag.length)

    if (closeIndex === -1) {
      const text = decodeEntities(remaining.slice(index))
      if (text) children.push(createSpan(text, activeMarks))
      break
    }

    const inner = remaining.slice(index + openTag.length, closeIndex)

    if (tag === 'a') {
      const hrefMatch = attributes.match(/href="([^"]+)"/i)
      const blank = /target="_blank"/i.test(attributes)
      const markKey = `mark-${Math.random().toString(36).slice(2, 10)}`
      if (hrefMatch?.[1]) {
        markDefs.push({ _key: markKey, _type: 'link', href: hrefMatch[1], blank })
        children.push(...parseInline(inner, markDefs, [...activeMarks, markKey]))
      } else {
        children.push(...parseInline(inner, markDefs, activeMarks))
      }
    } else {
      children.push(...parseInline(inner, markDefs, [...activeMarks, tag === 'strong' ? 'strong' : 'em']))
    }

    remaining = remaining.slice(closeIndex + closeTag.length)
  }

  return children.filter((child) => child.text)
}

function makeBlock(style, content, extras = {}) {
  const markDefs = []
  const children = parseInline(content, markDefs)
  if (!children.length) return null
  return {
    _type: 'block',
    _key: `block-${Math.random().toString(36).slice(2, 10)}`,
    style,
    markDefs,
    children,
    ...extras,
  }
}

function portableBlocksFromHtml(html) {
  const blocks = []
  const matches = String(html || '').match(/<(p|h2|h3|ul|ol)\b[^>]*>[\s\S]*?<\/\1>/gi) || []

  for (const match of matches) {
    if (/^<p\b/i.test(match)) {
      const inner = match.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>$/i, '').trim()
      const block = makeBlock('normal', inner)
      if (block) blocks.push(block)
      continue
    }

    if (/^<h2\b/i.test(match)) {
      const inner = match.replace(/^<h2\b[^>]*>/i, '').replace(/<\/h2>$/i, '').trim()
      const block = makeBlock('h2', inner)
      if (block) blocks.push(block)
      continue
    }

    if (/^<h3\b/i.test(match)) {
      const inner = match.replace(/^<h3\b[^>]*>/i, '').replace(/<\/h3>$/i, '').trim()
      const block = makeBlock('h3', inner)
      if (block) blocks.push(block)
      continue
    }

    const ordered = /^<ol\b/i.test(match)
    const items = match.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) || []
    for (const item of items) {
      const inner = item.replace(/^<li\b[^>]*>/i, '').replace(/<\/li>$/i, '').trim()
      const block = makeBlock('normal', inner, { listItem: ordered ? 'number' : 'bullet', level: 1 })
      if (block) blocks.push(block)
    }
  }

  return blocks
}

function extractAttribute(text, attribute) {
  const match = text.match(new RegExp(`${attribute}="([\\s\\S]*?)"`))
  return match ? match[1].trim() : ''
}

function extractBlogPostPayload(fileText) {
  const componentMatch = fileText.match(/<BlogPost([\s\S]*?)>([\s\S]*?)<\/BlogPost>/)
  if (!componentMatch) {
    throw new Error('BlogPost wrapper not found')
  }

  const attrs = componentMatch[1]
  const htmlBody = componentMatch[2].trim()

  return {
    title: extractAttribute(attrs, 'title'),
    excerpt: extractAttribute(attrs, 'description'),
    publishedAt: extractAttribute(attrs, 'date'),
    category: extractAttribute(attrs, 'category'),
    coverImageUrl: extractAttribute(attrs, 'image'),
    coverImageAltText: extractAttribute(attrs, 'imageAlt'),
    htmlBody,
    richBody: portableBlocksFromHtml(htmlBody),
    body: stripHtml(htmlBody),
  }
}

const campDocs = [
  {
    _id: 'camp.la-tcpe-june',
    _type: 'camp',
    title: 'LA Complete Player Experience',
    slug: { current: 'la-tcpe-june' },
    status: 'open',
    heroKicker: 'Joner Football x First Strike',
    heroHeadline: 'LA Complete Player Experience',
    heroSubtitle: 'A 3 day elite football experience for selected players who want high level training, position specific detail, and the complete player education block.',
    heroImageUrl: '/images/camps/tcpe/JONER-X-FIRST-STRIKE--scaled.jpg.webp',
    heroVideo: '/images/camps/tcpe/tcpe-hero-720.mp4?v=2',
    location: 'Los Angeles, California',
    destination: 'usa',
    googleSheetTab: 'LA TCPE (June)',
    venue: 'Gol Soccer Complex, 11501 Strathern St, North Hollywood, CA 91605, US',
    venueName: 'Gol Soccer Complex',
    venueAddress: '11501 Strathern St, North Hollywood, CA 91605, US',
    venueNotes: 'Selection only camp. Static page still has the custom design until the dynamic route matches it exactly.',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Gol+Soccer+Complex+11501+Strathern+St+North+Hollywood+CA+91605',
    dates: 'June 22-24, 2026',
    startDate: '2026-06-22',
    endDate: '2026-06-24',
    times: '8am to 12pm',
    ageRange: 'Ages 13-18, ECNL and MLS Next level',
    spotsTotal: 30,
    spotsRemaining: 30,
    urgencyLabel: 'Max 30 players. Application required.',
    priceLabel: 'By acceptance only',
    stripePaymentLink: 'https://app.jonerfootball.com',
    description: 'Joner Football and First Strike combine for a selection only experience built around elite training, position specific coaching, mindset, nutrition, sports science, and player reporting.',
    trustItems: ['Selection only', 'Max 30 players', 'Position specific training', 'Mindset, nutrition and sports science'],
    includedItems: [
      '3 days of high level training with Joner Football and First Strike',
      'Joner Football x First Strike training kit',
      'Full free access to the Joner Football App',
      'Player welcome pack',
      'Mindset seminar booklet',
      'Detailed individual player report',
    ],
    dayOptions: ['Full Experience - acceptance only'],
    whatToBring: ['Football boots suitable for synthetic or grass', 'Shin guards', 'Drink bottle', 'Waterproof jacket', 'Black shorts and white socks', 'A strong attitude and willingness to learn'],
    faqItems: [
      { question: 'What does the player need to bring?', answer: 'Soccer boots for synthetic, shin guards, drink bottle, waterproof jacket, a smile, and a good attitude.' },
      { question: 'What should the player wear?', answer: 'Black shorts and white socks. Joner Football will provide the training jersey.' },
      { question: 'What should players expect?', answer: 'Energy, intensity, knowledge, new drills, and a learning environment built for serious footballers.' },
      { question: 'Will bad weather cancel the camp?', answer: 'No. Only severe storms can delay the camp.' },
      { question: 'Can we take photos or videos?', answer: 'Professional photos and videos will be taken. The coaches will leave time on the final day for photos and chats.' },
      { question: 'Can I get a refund if I cancel?', answer: 'Full refunds will be issued if you cancel within 14 days of the camp start date.' },
    ],
    images: {
      heroPoster: '/images/camps/tcpe/JONER-X-FIRST-STRIKE--scaled.jpg.webp',
      heroVideoLocal: '/images/camps/tcpe/tcpe-hero-720.mp4?v=2',
      gallery: ['/images/camps/tcpe/JONER-X-FIRST-STRIKE--scaled.jpg.webp'],
    },
    internalNotes: 'Seeded from static la-tcpe-june page. Keep static file until the native camp route can match the bespoke design.',
    updatedNotes: 'Imported by scripts/generate-sanity-native-content.mjs',
  },
  {
    _id: 'camp.texas-houston-june',
    _type: 'camp',
    title: 'Houston World Cup Camp',
    slug: { current: 'texas-houston-june' },
    status: 'open',
    heroKicker: 'Joner Football x Kingdom Soccer Training x Grande Sports Training',
    heroHeadline: 'Houston World Cup Camp',
    heroSubtitle: 'The Houston camp returns for 2026 in line with the World Cup, built for dedicated players who want technical detail, intensity, and a serious training environment.',
    heroImageUrl: '/images/camps/houston-2026/photos/hero-lee.webp',
    location: 'Houston, Texas',
    destination: 'usa',
    googleSheetTab: 'Texas Houston (June)',
    venue: '17822 Hufsmith - Kohrville Rd, Tomball, TX 77375, Field #1',
    venueName: 'Tomball Training Venue',
    venueAddress: '17822 Hufsmith - Kohrville Rd, Tomball, TX 77375, US',
    venueNotes: 'Static page still carries the custom World Cup layout. Sanity doc now holds the editable content source.',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=17822+Hufsmith+Kohrville+Rd+Tomball+TX+77375',
    dates: 'June 26-28, 2026',
    startDate: '2026-06-26',
    endDate: '2026-06-28',
    times: '7am to 10am',
    ageRange: 'Ages 8-18',
    spotsTotal: 80,
    spotsRemaining: 80,
    urgencyLabel: 'Sold out last year. Max 80 players.',
    priceLabel: '1 day $130 USD, 2 days $250 USD, 3 days $350 USD',
    stripePaymentLink: 'https://app.jonerfootball.com',
    description: 'Last year was that good we are running it back for 2026 in alignment with the World Cup. In collaboration with Kingdom Soccer Training and Grande Sports Training, this 3 day elite camp is for players who truly want to improve.',
    trustItems: ['Sold out last year', 'Max 16 players per coach', 'World Cup camp energy', 'Jersey for 3 day players'],
    dayOptions: ['1 Day - $130 USD', '2 Days - $250 USD', '3 Days - $350 USD'],
    whatToBring: ['Football boots suitable for synthetic or grass', 'Shin guards', 'Drink bottle', 'Waterproof jacket', 'Black shorts and white socks', 'A strong attitude and willingness to learn'],
    images: {
      heroPoster: '/images/camps/joner-camps-pack/06_large_camp_v1_polished_blank_4x3.jpg',
      heroVideoLocal: '/images/camps/houston/houston-hero-720.mp4',
      gallery: [
        '/images/camps/joner-camps-pack/07_group_detail_v1_polished_blank_4x3.jpg',
        '/images/camps/joner-camps-pack/04_night_session_v1_polished_blank_4x3.jpg',
        '/images/camps/joner-camps-pack/05_small_group_v1_polished_blank_4x3.jpg',
      ],
    },
    internalNotes: 'Seeded from static texas-houston-june page. Keep static file until the dynamic route can replicate the custom sections.',
    updatedNotes: 'Imported by scripts/generate-sanity-native-content.mjs',
  },
  {
    _id: 'camp.texas-dallas-june',
    _type: 'camp',
    title: 'Dallas World Cup Camp',
    slug: { current: 'texas-dallas-june' },
    status: 'open',
    heroKicker: 'Joner Football x Texas Partners',
    heroHeadline: 'Dallas World Cup Camp',
    heroSubtitle: 'Dallas sold out last year, so the World Cup camp is back for 2026 with Joner Football, Kingdom Soccer Training, Grande Sports Training, and World Sport FC.',
    heroImageUrl: '/images/camps/dallas-2026/photos/dsc09261.webp',
    location: 'Dallas, Texas',
    destination: 'usa',
    googleSheetTab: 'Texas Dallas (June)',
    venue: '4220 E Melissa Rd, Melissa, TX 75454, United States',
    venueName: 'Melissa Training Venue',
    venueAddress: '4220 E Melissa Rd, Melissa, TX 75454, US',
    venueNotes: 'Static page still carries the custom World Cup layout. Sanity doc now holds the editable content source.',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=4220+E+Melissa+Rd+Melissa+TX+75454',
    dates: 'June 30 - July 2, 2026',
    startDate: '2026-06-30',
    endDate: '2026-07-02',
    times: '7am to 10am',
    ageRange: 'Ages 8-18',
    spotsTotal: 80,
    spotsRemaining: 80,
    urgencyLabel: 'Sold out every year. Max 80 players.',
    priceLabel: '1 day $130 USD, 2 days $250 USD, 3 days $350 USD',
    stripePaymentLink: 'https://app.jonerfootball.com',
    description: 'A 3 day Dallas elite camp running alongside the World Cup, built for dedicated players who want technical training, high standards, and an unforgettable Joner Football experience.',
    trustItems: ['Sold out last year', 'Max 16 players per coach', 'Last day livestreamed', 'Joner jersey for 3 day players'],
    dayOptions: ['1 Day - $130 USD', '2 Days - $250 USD', '3 Days - $350 USD'],
    whatToBring: ['Football boots suitable for synthetic or grass', 'Shin guards', 'Drink bottle', 'Waterproof jacket', 'Black shorts and white socks', 'A strong attitude and willingness to learn'],
    images: {
      heroPoster: '/images/camps/dallas-2026/photos/dsc09261.webp',
      gallery: [
        '/images/camps/dallas-2026/photos/dsc09261.webp',
        '/images/camps/dallas-2026/photos/large-camp.webp',
        '/images/camps/dallas-2026/photos/red-drills.webp',
      ],
    },
    internalNotes: 'Seeded from static texas-dallas-june page. Keep static file until the dynamic route can replicate the custom sections.',
    updatedNotes: 'Imported by scripts/generate-sanity-native-content.mjs',
  },
  {
    _id: 'camp.sydney-july-2026',
    _type: 'camp',
    title: 'Sydney July Camp',
    slug: { current: 'sydney-july-2026' },
    status: 'open',
    heroKicker: 'Biggest Camp Of The Year',
    heroHeadline: 'Sydney July Camp',
    heroSubtitle: 'Joner Football Sydney July Camp 2026 at Rydalmere Park with the Joner Football coaching team.',
    heroImageUrl: '/images/camps/sydney-2026/photos/rydalmere-camp-running.jpg',
    location: 'Sydney, Australia',
    destination: 'sydney',
    googleSheetTab: 'Sydney big 1 (July)',
    venue: 'Rydalmere Park',
    venueName: 'Rydalmere Park',
    venueAddress: 'Rydalmere Park, Sydney, NSW',
    venueNotes: 'Static page still carries the custom Sydney July layout. Sanity doc now holds the editable content source.',
    mapUrl: 'https://www.google.com/maps/search/?api=1&query=Rydalmere+Park+Sydney+NSW',
    dates: 'July 14-16, 2026',
    startDate: '2026-07-14',
    endDate: '2026-07-16',
    times: '9am to 12pm',
    ageRange: 'Ages 8-18',
    spotsTotal: 80,
    spotsRemaining: 80,
    urgencyLabel: 'Limited spots available',
    priceLabel: '1 Day $150 AUD, 2 Days $260 AUD, 3 Days $350 AUD',
    stripePaymentLink: 'https://app.jonerfootball.com',
    description: 'Joner Football Sydney July Camp 2026 at Rydalmere Park with the Joner Football coaching team. July 14 to 16. Ages 8 to 18. Limited spots.',
    trustItems: ['No babysitting, only players that truly want to improve', 'Max 16 players per coach', 'Limited spots available', 'Sold out every year'],
    dayOptions: ['1 Day - $150 AUD', '2 Days - $260 AUD', '3 Days - $350 AUD'],
    whatToBring: ['Soccer boots for synthetic', 'Shin guards', 'Drinks bottle', 'Waterproof jacket', 'A smile', 'Good attitude'],
    images: {
      heroPoster: '/images/camps/sydney-2026/photos/rydalmere-camp-running.jpg',
      gallery: [
        '/images/camps/sydney-2026/photos/rydalmere-camp-running.jpg',
        '/images/camps/sydney-2026/photos/joner-cup.jpg',
      ],
    },
    internalNotes: 'Seeded from static sydney-july-2026 page. Keep static file until the dynamic route can replicate the custom sections.',
    updatedNotes: 'Imported by scripts/generate-sanity-native-content.mjs',
  },
  {
    _id: 'camp.test-signup',
    _type: 'camp',
    title: 'Test Camp Sign Up',
    slug: { current: 'test-signup' },
    status: 'draft',
    heroHeadline: 'Test Camp Sign Up',
    heroSubtitle: 'Test the Joner Football camp registration flow before launch.',
    destination: 'usa',
    googleSheetTab: 'Test Camp',
    priceLabel: 'Internal QA only',
    stripePaymentLink: 'https://app.jonerfootball.com',
    description: 'Internal QA page for the camp registration flow. Keep the static custom form page in place.',
    internalNotes: 'Custom test form page. Do not swap to the generic camp route until the native camp template supports the same registration test flow.',
    updatedNotes: 'Imported by scripts/generate-sanity-native-content.mjs',
  },
]

const trackedBlogFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'src/pages/blog'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
  .split('\n')
  .map((item) => item.trim())
  .filter((item) => item.endsWith('.astro') && !item.endsWith('/[slug].astro') && !item.endsWith('/index.astro'))
  .map((item) => path.basename(item))

const currentBlogFiles = (await fs.readdir(blogDir))
  .filter((file) => file.endsWith('.astro') && !['[slug].astro', 'index.astro'].includes(file))

const blogFiles = Array.from(new Set([...trackedBlogFiles, ...currentBlogFiles])).sort()

const blogDocs = []
for (const file of blogFiles) {
  const slug = file.replace(/\.astro$/, '')
  const filePath = path.join(blogDir, file)
  let fileText = ''

  try {
    fileText = await fs.readFile(filePath, 'utf8')
  } catch {
    fileText = execFileSync('git', ['show', `HEAD:src/pages/blog/${file}`], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
  }

  const post = extractBlogPostPayload(fileText)

  blogDocs.push({
    _id: `blogPost.${slugToId(slug)}`,
    _type: 'blogPost',
    title: post.title,
    slug: { current: slug },
    author: 'Joner Football',
    publishedAt: post.publishedAt ? `${post.publishedAt}T00:00:00.000Z` : undefined,
    excerpt: post.excerpt,
    body: post.body,
    richBody: post.richBody,
    category: post.category,
    publishStatus: 'published',
    coverImageUrl: post.coverImageUrl,
    coverImageAltText: post.coverImageAltText || post.title,
    internalNotes: `Seeded from src/pages/blog/${file}`,
  })
}

await fs.writeFile(blogOutputPath, `${blogDocs.map((doc) => JSON.stringify(doc)).join('\n')}\n`)
await fs.writeFile(campOutputPath, `${campDocs.map((doc) => JSON.stringify(doc)).join('\n')}\n`)

console.log(`Wrote ${blogDocs.length} blogPost records to ${path.relative(projectRoot, blogOutputPath)}`)
console.log(`Wrote ${campDocs.length} camp records to ${path.relative(projectRoot, campOutputPath)}`)
console.log('Import blog posts with: npx sanity dataset import tmp-sanity-blog-posts.ndjson production --replace')
console.log('Import camps with: npx sanity dataset import tmp-sanity-camps.ndjson production --replace')
console.log('After import, delete old duplicate page docs like page-blog-* and page-camp-* from Sanity so the shadow routes stop winning.')
