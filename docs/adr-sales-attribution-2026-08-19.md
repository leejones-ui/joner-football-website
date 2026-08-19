# ADR: Sales attribution system of record (2026-08-19)

Status: accepted. Owner: Claude Fable Five. Independent verifier: Barry.

## Decision

Two architectures existed on 2026-08-19: the git `main` attribution v2 stack (journey ledger,
checkout bridge, Uscreen webhook, reliability ledger) and an unpushed working tree on the Mac
mini that was being CLI-deployed to production and had removed `/api/journey`. This record
chooses the git stack. Any code from the unpushed tree must arrive as a reviewed PR.

1. **Authoritative website journey and webhook code:** `github.com/leejones-ui/joner-football-website`, branch `main`.
2. **Uscreen webhook route:** `https://jonerfootball.com/api/uscreen-webhook` (vercel.json rewrite to `/api/subscribe?uscreen_webhook=1`, processing in `api/_uscreen-webhook.js`). Secret required (`USCREEN_WEBHOOK_SECRET`).
3. **Durable journey ledger:** Upstash KV via Vercel env, keys `jf:journey:*` (signed uuid.hmac tokens, 180 day TTL). Legacy `jfa:journey:*` retained read-only for classification.
4. **Durable per-sale ledger:** KV `jfa:reliability:sale:*` + index `jfa:reliability:sales:index` (10 year TTL, detailed cap 400 with archive-on-trim, anonymous per-channel aggregates forever).
5. **Reconciliation writers:** the webhook at receipt time, `api/attribution-cron.js` (hourly retry + daily sweep), `api/checkout-bridge.js` late-identity retrigger, and the operator endpoint `api/uscreen-reliability.js` (manual replay only).
6. **Dashboard read path:** website `GET /api/attribution-report` (Bearer `ATTRIBUTION_REPORT_TOKEN`), consumed server-side by joner-dashboard `/api/sales-attribution` proxy. No token in the browser.
7. **Vercel projects:** `joner-football-website` (site, webhook, ledger, CAPI, cron) and `joner-dashboard` (dashboard). The projects `joner-dashboard-sales-attribution`, `jf-attribution-production`, and `jf-meta-first-paid-20260810` are frozen experiments: do not point anything at them; delete after Barry's verification pass.
8. **Cron:** Vercel cron in `joner-football-website` hits `/api/attribution-cron` hourly; the run in the 21:00 UTC hour (07:00 Sydney) performs the daily deep sweep.
9. **Canonical Meta event sender:** the webhook (automatic, gated) with cron retry. Event: `JF_First_Paid_Membership`, one per Uscreen user forever (KV NX claim + send lock + Meta `events_received:1` receipt). The operator script remains a manual backstop only. Uscreen's native `Purchase` stream is not a buyer metric (contains renewals). `JF_Paid_Purchase` originates outside this repo (Mac mini scripts); it must be retired or documented by its owner and is not part of this contract.
10. **Deploy protection:** git-based deploys only. `GET /api/version` returns the deployed commit; the dashboard flags a mismatch against the expected repo. CLI deploys from working trees are banned; check `vercel ls` before any push while the freeze is in effect.

## Consequences

- Deploying `main` supersedes the unpushed production tree (its deployments remain addressable on their unique Vercel URLs for rollback and diffing).
- `ATTRIBUTION_REPORT_TOKEN` is rotated as part of this change because sensitive values cannot be read back for reuse; consumers must use the new value.
- The Uscreen Head Code (v1.4) must be re-pasted into Uscreen once by Lee; the repo copy is the source of truth.
