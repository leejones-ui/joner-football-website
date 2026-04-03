import { createClient } from '@sanity/client'

export const sanityClient = createClient({
  projectId: 'xlwi0cyg',
  dataset: 'production',
  useCdn: true,
  apiVersion: '2024-01-01',
})
