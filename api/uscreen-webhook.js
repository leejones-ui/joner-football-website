// Public route configured in Uscreen Settings > Webhooks.
// Keep the implementation private so subscribe.js can reuse the same processor.
import uscreenWebhookHandler from './_uscreen-webhook.js'

export default async function handler(req, res) {
  return uscreenWebhookHandler(req, res)
}
