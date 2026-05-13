import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { staticPageDefinitions } from '../src/sanity/pageCatalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const outputPath = path.resolve(__dirname, '../tmp-sanity-pages-seed.ndjson')

const docs = staticPageDefinitions.map((page) => {
  const slugCurrent = page.slug === '/' ? '' : page.slug.replace(/^\//, '')

  return {
    _id: `page.${page.pageKey}`,
    _type: 'page',
    title: page.title,
    pageKey: page.pageKey,
    pageMode: 'fallback',
    publishStatus: 'draft',
    slug: { current: slugCurrent },
    previewUrl: `https://jonerfootball.com${page.route === '/' ? '/' : page.route}`,
    lastEditedNotes: page.notes || `Seeded from ${page.route}`,
  }
})

await fs.writeFile(outputPath, `${docs.map((doc) => JSON.stringify(doc)).join('\n')}\n`)
console.log(`Wrote ${docs.length} page seed records to ${outputPath}`)
console.log('Import with: npx sanity dataset import tmp-sanity-pages-seed.ndjson production --replace')
