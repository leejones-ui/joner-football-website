// Top 50 Coaching Drills (Lee Jones), launch November 2026.
// Every quote below is Lee's own, copied from the printed book (Joner's notes on the
// drill pages, the coaching principles page, the chapter openers, the contents page).
// Do not reword them here without changing the book.

// Both Shopify products went ACTIVE on 16 Nov 2026. Set this to false if either
// product is ever unpublished, or the buttons will 404.
const SHOP_LIVE = true
const shop = (handle: string) => (SHOP_LIVE ? `https://shop.jonerfootball.com/products/${handle}` : '')

export const top50Book = {
  title: 'Top 50 Coaching Drills',
  releaseDate: '2026-11-24',
  releaseLabel: '24 November',
  pdfPrice: 'A$24',
  paperbackPrice: 'A$49',
  pdfUrl: shop('top-50-coaching-drills-pdf-download'),
  paperbackUrl: shop('top-50-coaching-drills-paperback'),
  page: '/books/top-50-coaching-drills/',
  cover: '/images/books/top-50-coaching-drills/cover.webp',
  coverJpg: '/images/books/top-50-coaching-drills/cover.jpg',
  og: '/images/books/top-50-coaching-drills/og.jpg',
  leePhoto: '/images/books/top-50-coaching-drills/lee-coaching.webp',
  hqPhoto: '/images/books/top-50-coaching-drills/lee-hq.webp',
}

// Sample pages (the ones the book team released for launch).
export const samplePages = [
  {
    n: '01',
    title: 'Beginner Ball Mastery',
    chapter: 'Ball Control & Dribbling',
    age: '6 to 10',
    level: 'Easy',
    note: 'Never get bored of doing the drills. The best players are obsessed with getting better, so put the hours in at home.',
  },
  {
    n: '05',
    title: 'Drop Shoulder & Scissor',
    chapter: 'Ball Control & Dribbling',
    age: '9 to 14',
    level: 'Medium',
    note: 'The drop shoulder is one of the most used skills at the top level. Get close to the ball, sell the fake, then be super explosive past the defender.',
  },
  {
    n: '18',
    title: 'Colour Box First Touch',
    chapter: 'Passing & First Touch',
    age: '12 to 16',
    level: 'Advanced',
    note: 'There is a huge difference between tempo and quality. Good midfielders control the tempo. Slow your brain down, get the bounce pass right, then go again.',
  },
  {
    n: '36',
    title: 'Cutback Finishing',
    chapter: 'Finishing',
    age: '12 to 16',
    level: 'Medium',
    note: 'Got this one off Alan Russell. Top strikers score from cutbacks for fun. Head over the ball, find the corners, and if you break a pole I will send you the invoice.',
  },
  {
    n: '44',
    title: 'Find Half a Yard & Finish',
    chapter: 'Finishing',
    age: '13 to 16',
    level: 'Pro',
    note: 'Shift it, shoot. That is your coaching point. You’ve just found half a yard. There’s your chance. Don’t turn down the opportunity.',
  },
  {
    n: '46',
    title: '1v1 Defending: Distance Control',
    chapter: 'Defending',
    age: '9 to 14',
    level: 'Medium',
    note: 'One of my favourites for defenders. Too close and you dive in, too far and you allow too much space. Shift your feet, turn your hips, eyes on the ball.',
  },
].map((p) => ({ ...p, src: `/images/books/top-50-coaching-drills/drill-${p.n}.webp` }))

// The contents page, as printed.
export const chapters = [
  {
    n: '01',
    name: 'Ball Control & Dribbling',
    line: 'Own the ball first. Every player, every session, starts right here.',
    start: 1,
    drills: [
      'Beginner Ball Mastery', 'Dribbling Square', '2 Player Passing Drills', '3 Modern Turns', 'Drop Shoulder & Scissor',
      'Fake Shot Circle Dribble', 'String Line First Touch', 'Advanced Box Drill', 'Rebound Board Combos', 'First Touch Pressure',
    ],
  },
  {
    n: '02',
    name: 'Passing & First Touch',
    line: 'The Joner signature. Weight of pass, timing, and a first touch with a purpose.',
    start: 11,
    drills: [
      '2 Cone Drills', 'Rebounder Passing Box', '1 Metre First Touch Box', 'L Shape Passing Drills', 'Triangle Passing Drills',
      'Slip Him Through the Gate', 'One Two Box Game', 'Colour Box First Touch', 'Read the Pressure Gates', 'Chicken Combos',
      'Scan & Fire Boxes', 'Elite Cognitive Drill', 'Low Driven Pass', '1st Touch Under Pressure', 'First Touch Change of Direction',
    ],
  },
  {
    n: '03',
    name: 'Speed & Agility',
    line: 'Fast feet, sharp turns and the explosive change of pace that beats a marker.',
    start: 26,
    drills: [
      'Trapezium Fast Feet', 'Battle Diamond', 'Indoor SAQ Drills', 'Ladder Colour Calls', 'Stop-Drop-Go Acceleration',
      'Red or Yellow Reactions', 'Figure of Eight Dribble', 'Buy Your Time 1v1', 'Beat Your Marker', 'Cognitive Fast Feet',
    ],
  },
  {
    n: '04',
    name: 'Finishing',
    line: 'Put it in the net. Movement, composure and cold finishing under pressure.',
    start: 36,
    drills: [
      'Cutback Finishing', 'Scan and Shoot 1v1', 'Crossing: Near, Far, Cutback', 'Striker Movement Finishing', 'Cross & Finish: Time Your Run',
      'Yamal Cut Inside & Whip', 'Passing and Shooting Drill', 'Finishing Inside the Box', 'Find Half a Yard & Finish', '5 Shot Shooting Drill',
    ],
  },
  {
    n: '05',
    name: 'Defending',
    line: 'Win the ball back. The mentality and the technique that complete a player.',
    start: 46,
    drills: ['1v1 Defending: Distance Control', 'Winning the Tackle', '1v1 Confidence Drill', 'Defender’s Gauntlet', '1v1 to 2v2 Recovery Run'],
  },
]

// "Ten rules I coach by", as printed on the coaching principles page.
export const rules = [
  ['Learn how to train properly', 'Teach your players what makes a coachable player and what real training looks like. For me, players need to look like they want to be there, train hard and train with a purpose.'],
  ['Bring the energy', 'Players are energised by the coach. Be energetic, be fun, be serious, and learn to switch it up. Energy is my number one rule in coaching. The kids need to love it. It is always about them, not you.'],
  ['Be positive', 'Your job as a coach is to build confidence, not break it. For those who know me, this is my style of coaching. Players perform at their best when their confidence is sky high, and that is the coach’s job.'],
  ['First touch with purpose', 'First touch, for me, is in the top three technical attributes a player must be good at. If players can’t receive the ball in multiple ways, you will struggle to coach them to the top. It is the catalyst for your next action!'],
  ['Progress one thing at a time', 'Give repetition a purpose. Let players learn the drill, give feedback and repeat it. Add the progression once they are consistent.'],
  ['Both feet, every session', 'Practise on the weaker side too. Make it part of the drill from the start.'],
  ['Stay balanced', 'A low, balanced position and small steps in tight areas. Keep control as you change direction.'],
  ['Add a decision', 'When you run these drills, or your own, give the player something to think about. Not every drill has one, but decision-making is the most important attribute in the game.'],
  ['Quality first. Then speed.', 'Walk through the pattern and get the technique right. Then build towards match tempo while keeping that quality.'],
  ['Scanning', 'A buzzword you hear a lot in coaching now, so make sure your players understand the why behind it. Add it into your sessions as much as you can for your level.'],
]

export const isShopUrl = (url: string) => /^https:\/\//.test(url)
