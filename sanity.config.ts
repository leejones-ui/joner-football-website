import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './src/sanity/schemas'
import { staticPageDefinitions } from './src/sanity/pageCatalog.js'

const singletonTypes = new Set(['siteSettings', 'campRegistrationSettings', 'staffGuide'])

const keyPages = [
  'home',
  'training',
  'joners-juniors',
  'game-analysis',
  'camps',
  'camp-la-tcpe-june',
  'camp-texas-houston-june',
  'camp-texas-dallas-june',
  'camp-sydney-july-2026',
  'app',
  'app-for-coaches',
  'teams',
  'coaches-course',
  'mindset-seminars',
  'shop',
  'about',
  'contact',
  'hq',
]

const pageByKey = Object.fromEntries(staticPageDefinitions.map((page) => [page.pageKey, page]))

export default defineConfig({
  name: 'joner-football-website',
  title: 'Joner Football Website',
  projectId: 'xlwi0cyg',
  dataset: 'production',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Joner Website Dashboard')
          .items([
            S.listItem().title('Website Pages').child(
              S.list().title('Edit Website Pages').items(
                keyPages.map((pageKey) => {
                  const page = pageByKey[pageKey]
                  return S.listItem()
                    .title(page?.title || pageKey)
                    .schemaType('page')
                    .child(S.document().schemaType('page').documentId(`page.${pageKey}`))
                })
              )
            ),
            S.listItem().title('Camps').schemaType('camp').child(S.documentTypeList('camp').title('Camps')),
            S.listItem().title('Training Programs').schemaType('page').child(
              S.list().title('Training Programs').items([
                S.listItem().title('Training hub').schemaType('page').child(S.document().schemaType('page').documentId('page.training')),
                S.listItem().title('JFP Program').schemaType('page').child(S.document().schemaType('page').documentId('page.jfp-program')),
                S.listItem().title('Professional Training').schemaType('page').child(S.document().schemaType('page').documentId('page.professional-training')),
                S.listItem().title('Joners Juniors').schemaType('page').child(S.document().schemaType('page').documentId('page.joners-juniors')),
                S.listItem().title('Game Analysis').schemaType('page').child(S.document().schemaType('page').documentId('page.game-analysis')),
              ])
            ),
            S.listItem().title('Workshops').schemaType('page').child(
              S.list().title('Workshops').items([
                S.listItem().title('Workshops hub').schemaType('page').child(S.document().schemaType('page').documentId('page.workshops')),
                S.listItem().title('Coaches Course').schemaType('page').child(S.document().schemaType('page').documentId('page.coaches-course')),
                S.listItem().title('Mindset Seminars').schemaType('page').child(S.document().schemaType('page').documentId('page.mindset-seminars')),
              ])
            ),
            S.listItem().title('App').schemaType('page').child(
              S.list().title('App').items([
                S.listItem().title('App Page').schemaType('page').child(S.document().schemaType('page').documentId('page.app')),
                S.listItem().title('Coaches App').schemaType('page').child(S.document().schemaType('page').documentId('page.app-for-coaches')),
              ])
            ),
            S.listItem().title('Shop Links').schemaType('shopBlock').child(S.documentTypeList('shopBlock').title('Shop Links')),
            S.listItem().title('Blog / Resources').child(
              S.list().title('Blog / Resources').items([
                S.listItem().title('Blog Posts').schemaType('blogPost').child(S.documentTypeList('blogPost').title('Blog Posts')),
                S.listItem().title('Hub Content').schemaType('hubContent').child(S.documentTypeList('hubContent').title('Hub Content')),
                S.listItem().title('FAQs').schemaType('faq').child(S.documentTypeList('faq').title('FAQs')),
                S.listItem().title('Testimonials').schemaType('testimonial').child(S.documentTypeList('testimonial').title('Testimonials')),
              ])
            ),
            S.listItem().title('SEO').schemaType('page').child(S.documentTypeList('page').title('SEO by Page')),
            S.listItem().title('Media Library').schemaType('partner').child(
              S.list().title('Media and reusable content').items([
                S.listItem().title('Team Members').schemaType('teamMember').child(S.documentTypeList('teamMember').title('Team Members')),
                S.listItem().title('Partners').schemaType('partner').child(S.documentTypeList('partner').title('Partners')),
              ])
            ),
            S.listItem().title('Global Settings').schemaType('siteSettings').child(S.document().schemaType('siteSettings').documentId('siteSettings')),
            S.listItem().title('Camp Registration Settings').schemaType('campRegistrationSettings').child(S.document().schemaType('campRegistrationSettings').documentId('campRegistrationSettings')),
            S.listItem().title('Staff Editing Guide').schemaType('staffGuide').child(S.document().schemaType('staffGuide').documentId('staffGuide')),
            S.divider(),
            ...S.documentTypeListItems().filter((item) => !singletonTypes.has(item.getId() || '') && !['page', 'camp', 'blogPost', 'faq', 'testimonial', 'teamMember', 'partner', 'shopBlock', 'hubContent'].includes(item.getId() || '')),
          ]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
