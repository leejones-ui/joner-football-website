# Sales attribution runbook (2026-08-19)

Architecture decision: see `docs/adr-sales-attribution-2026-08-19.md`. This file is the
operating guide. Owner: Lee. Implementer: Claude Fable Five. Verifier: Barry.

## The chain

Facebook ad click (fbclid, url_tags with campaign/adset/ad ids)
-> jonerfootball.com (journey minted via POST /api/journey, jf_journey_id cookie at
   Domain=.jonerfootball.com, fbc/fbp shared, CTA links decorated with the __jfa1__ pack)
-> app.jonerfootball.com checkout (Uscreen Head Code v1.4 posts checkout_bridge and
   checkout_identity to /api/checkout-bridge; email hash and Uscreen user id join the journey)
-> Uscreen webhook POST /api/uscreen-webhook (secret required)
-> reconcilePayment (uscreen user id, signed journey token, then unique hashed email)
-> durable sale row in KV (jfa:reliability:sale:*, archive on trim, never silently deleted)
-> automatic canonical Meta event JF_First_Paid_Membership when every gate passes
   (positive amount, real currency, web Stripe charge, first paid ever, send lock,
   Meta events_received receipt)
-> dashboard: https://joner-dashboard.vercel.app/sales-attribution (owner only)

## Routines

- Hourly (Vercel cron, minute 10): `/api/attribution-cron`. Retries held canonical sends
  (enriching value/currency from the Uscreen invoice API), re-reconciles unknown sales
  younger than 7 days, compares Uscreen's paid invoices against the ledger and imports
  genuine webhook gaps, updates health counters, writes alerts.
- Daily deep sweep: the cron run in the 21:00 UTC hour (07:00 Sydney) widens the lookback
  to 7 days and stamps `daily_last_run_at`.
- Late identity: a checkout_identity arriving after the payment webhook re-reconciles
  matching unknown sales immediately (bounded to 10) via the checkout bridge.
- Operator commands (Bearer `USCREEN_RELIABILITY_TOKEN`):
  - `GET /api/uscreen-reliability` sales + dead letters + aggregates
  - `POST /api/uscreen-reliability {action:'replay', event_id}` replays a dead letter
  - `POST /api/attribution-cron?deep=1` manual deep sweep
- Deploy verification: `GET /api/version` must return the expected git commit. The
  dashboard shows RED on Deploy integrity when the ledger stops serving from git.

## Alerts (visible on the dashboard)

`webhook_gap_backfill` (a paid invoice the webhook never delivered), `webhook_silent`
(no webhook events for 24 h), `canonical_event_send_failed`, `cron_failed`.

## What must never happen

- Never deploy from an uncommitted working tree. Push to main; the git integration deploys.
- Never count a trial, freebie, zero-value invoice, refund or renewal as a first paid buyer.
- Never backfill an unknown sale into a channel without join evidence.
- Never put raw email, phone, tokens or click ids in the dashboard payload.

## Manual steps that remain with Lee

1. Paste `scripts/uscreen-head-attribution-v1.js` (v1.4.0) into Uscreen Admin -> Settings
   -> Custom code -> Head Code, replacing v1.3.0. v1.4 adds the packed-journey-token
   fallback for cookie-blocked browsers and posts checkout click identity.
2. The controlled Max Annual purchase test (protocol in the Fable audit report). Do not
   run it until Barry's verification pass is complete.
3. Rotated secrets: `ATTRIBUTION_REPORT_TOKEN` and `USCREEN_RELIABILITY_TOKEN` were
   rotated on 2026-08-19; anything on the Mac mini using the old values must be updated.

## Known limitations

- Sales that predate the journey system (or arrive with no identity at all) stay unknown;
  that is deliberate honesty, not a bug.
- Uscreen webhook payloads often omit currency; the hourly cron enriches held canonical
  events from the invoice API, but old ledger rows may show an Unknown currency bucket.
- `JF_Paid_Purchase` and the CompleteRegistration/Subscribe/Purchase streams come from
  Uscreen's own integration and Mac mini scripts, not this repo. The ad set optimises on
  `JF_First_Paid_Membership` only; the other streams must not be used as buyer counts.
