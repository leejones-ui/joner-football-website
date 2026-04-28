import { createClient } from '@sanity/client'

export const sanityClient = createClient({
  projectId: 'xlwi0cyg',
  dataset: 'production',
  useCdn: false,
  apiVersion: '2024-01-01',
})
