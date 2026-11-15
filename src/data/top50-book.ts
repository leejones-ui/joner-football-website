// Top 50 Coaching Drills (Lee Jones), launch November 2026.
// Paste the shop links here when they exist. While a link is empty the button
// shows "Pre-order opens soon" and is not clickable.
export const top50Book = {
  title: 'Top 50 Coaching Drills',
  tagline: 'The drills that build technical players.',
  releaseDate: '2026-11-24',
  releaseLabel: '24 November',
  pdfPrice: 'A$24',
  // Joner shop product page for the PDF (Shopify agent is making it).
  pdfUrl: '',
  // Paperback pre-order (Joner shop or Amazon).
  paperbackUrl: '',
  page: '/books/top-50-coaching-drills/',
  cover: '/images/books/top-50-coaching-drills/cover.webp',
  coverJpg: '/images/books/top-50-coaching-drills/cover.jpg',
  backCover: '/images/books/top-50-coaching-drills/back-cover.webp',
  og: '/images/books/top-50-coaching-drills/og.jpg',
  samples: [
    { src: '/images/books/top-50-coaching-drills/drill-01.webp', label: 'Drill 01' },
    { src: '/images/books/top-50-coaching-drills/drill-05.webp', label: 'Drill 05' },
    { src: '/images/books/top-50-coaching-drills/drill-18.webp', label: 'Drill 18' },
    { src: '/images/books/top-50-coaching-drills/drill-36.webp', label: 'Drill 36' },
  ],
}

export const isShopUrl = (url: string) => /^https:\/\//.test(url)
