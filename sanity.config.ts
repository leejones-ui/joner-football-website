import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './src/sanity/schemas'

const singletonTypes = new Set(['siteSettings', 'campRegistrationSettings', 'staffGuide'])

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
            S.listItem().title('Global Site Settings').schemaType('siteSettings').child(S.document().schemaType('siteSettings').documentId('siteSettings')),
            S.listItem().title('Pages').schemaType('page').child(S.documentTypeList('page').title('Pages')),
            S.divider(),
            S.listItem().title('Camps').schemaType('camp').child(S.documentTypeList('camp').title('Camps')),
            S.listItem().title('Camp Registration Settings').schemaType('campRegistrationSettings').child(S.document().schemaType('campRegistrationSettings').documentId('campRegistrationSettings')),
            S.divider(),
            S.listItem().title('Blog Posts').schemaType('blogPost').child(S.documentTypeList('blogPost').title('Blog Posts')),
            S.listItem().title('FAQs').schemaType('faq').child(S.documentTypeList('faq').title('FAQs')),
            S.listItem().title('Testimonials').schemaType('testimonial').child(S.documentTypeList('testimonial').title('Testimonials')),
            S.listItem().title('Team Members').schemaType('teamMember').child(S.documentTypeList('teamMember').title('Team Members')),
            S.listItem().title('Partners').schemaType('partner').child(S.documentTypeList('partner').title('Partners')),
            S.listItem().title('Shop Blocks').schemaType('shopBlock').child(S.documentTypeList('shopBlock').title('Shop Blocks')),
            S.listItem().title('Hub Content').schemaType('hubContent').child(S.documentTypeList('hubContent').title('Hub Content')),
            S.divider(),
            S.listItem().title('Staff Editing Guide').schemaType('staffGuide').child(S.document().schemaType('staffGuide').documentId('staffGuide')),
            ...S.documentTypeListItems().filter((item) => !singletonTypes.has(item.getId() || '') && !['page', 'camp', 'blogPost', 'faq', 'testimonial', 'teamMember', 'partner', 'shopBlock', 'hubContent'].includes(item.getId() || '')),
          ]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
