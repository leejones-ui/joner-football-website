# Download delivery setup

This site supports automatic digital-product delivery for the Resources & Accessories Stripe Payment Links.

## Live flow

1. Buyer clicks Buy Now on `/shop/resources-accessories/`.
2. Buyer pays through Stripe Payment Links.
3. Stripe sends `checkout.session.completed` to `/api/download-webhook`.
4. The webhook creates a private download token with 5 download attempts.
5. Brevo sends the buyer an email with their private `/api/download?token=...` link.
6. `/api/download` proxies the Dropbox source file and decrements the token attempt count.

## Required Vercel env vars

- `STRIPE_DOWNLOAD_WEBHOOK_SECRET`: Stripe webhook signing secret for `/api/download-webhook`.
- `KV_REST_API_URL`: Vercel KV or Upstash Redis REST URL.
- `KV_REST_API_TOKEN`: Vercel KV or Upstash Redis REST token.
- `BREVO_API_KEY`: Brevo transactional API key already used by the website.
- `BREVO_SENDER_EMAIL`: Verified Brevo sender email.
- Optional `DOWNLOAD_EMAIL_SENDER_NAME`: defaults to `Joner Football`.
- Optional `PUBLIC_SITE_URL`: defaults to the request host.

## Stripe setup

Create a webhook endpoint in Stripe:

`https://joner-football-website.vercel.app/api/download-webhook`

Listen for:

- `checkout.session.completed`

Current product detection falls back to paid amount/currency:

- AUD 79.99 maps to `training-tools-5in1`
- AUD 24.99 maps to `numbers-tool`

Safer future setup: add `product_key` metadata on each Stripe Payment Link:

- 5 in 1 Training Tools: `product_key=training-tools-5in1`
- Numbers Tool: `product_key=numbers-tool`

## Current source files

- 5 in 1 Training Tools: Dropbox folder ZIP download source.
- Numbers Tool: Dropbox MP4 download source.

Do not expose these Dropbox links to customers. The buyer only receives a private `/api/download?token=...` link.
