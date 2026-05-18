export default {
  name: 'staffGuide',
  title: 'Staff Editing Guide',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', initialValue: 'How To Edit The Joner Football Website' },
    { name: 'guide', title: 'Guide', type: 'text', rows: 18, initialValue: 'Lee/Joner rule: Telegram is the workroom, Obsidian is source of truth, dashboard is live status. In Sanity, use Website Pages to edit page copy, images, FAQs and SEO. Use Camps for camp details. Use Blog / Resources for posts and reusable content. Staff should save drafts or mark Needs Lee Review. Lee approves money pages before publish. Do not paste passwords, API keys, tokens, payment secrets or Brevo keys into Sanity. Trusted staff can edit Brevo list IDs, Google Sheet tabs and admin emails when needed, but must use the approved Joner routing details. Do not change payment links, brand colours, fonts or page render mode unless Lee approves it. Use Safe Joner Destination for buttons where possible. If unsure, leave it as draft and ask Lee or Barry.' },
  ],
}
