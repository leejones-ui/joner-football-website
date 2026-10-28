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

## Amendment 2026-10-28: sources, fbclid, fallback, report params

Approved by Lee on 28 Oct 2026.

- **One source list.** `api/_source-taxonomy.js` holds the canonical organic social sources (`main_instagram`, `app_instagram`, `main_instagram_linktree`, `manychat_instagram`, `manychat_facebook`, `youtube`, `youtube_coaches`, `youtube_es`, plus `instagram`, `facebook`, `manychat`, `tiktok`, `x`, `threads`), the organic mediums (`social`, `automation`, `organic_social`), the paid mediums and the aliases (`youtube-es` -> `youtube_es`, `ig`, `fb`, `twitter`). The journey ledger, `acquisitionCategory` and the webhook's `source_taxonomy` all read it. These sales classify as `organic_social`; the sale's `source` keeps the specific name. The Head Code needs no re-paste: the server accepts every name it emits, and `scripts/test-source-taxonomy.mjs` checks that.
- **fbclid is not paid proof.** Meta paid (`meta` / `exact_paid_meta`) needs a paid medium (`paid_social`, `cpc`, `paid`) or a `utm_id` / campaign id / ad-set id / ad id. An fbclid or fbc on its own is `organic_social`.
- **Landing page.** Sales carry `landing_page` (the touch's landing URL, else the signed journey's `first_page_path`) and `last_page` (`latest_page_path`).
- **Uscreen signup UTM fallback.** With no journey join, the sale is classified from the buyer's Uscreen signup UTMs with `confidence: 'inferred'`, evidence `uscreen_signup_utm`, `join_method: 'uscreen_signup_utm'`. It never replaces a journey join (enforced in `mergeReliableSale` too). The hourly cron applies it to unknown rows, including rows older than the 7-day journey retry window (one Uscreen read per row, 25 per hourly run, 100 in the daily deep sweep), and retries inferred rows for a real journey join inside the window.
- **`GET /api/attribution-report` params.** `limit` (1-200, default 50, rows returned only); `days` (int, back from `to` or now); `from` / `to` (ISO, `[from,to)`, they win over `days`); default last 30 days. `range_totals` and `coverage` are computed over the whole range, never the returned rows. `coverage` adds integer counts deduped per buyer: `new_buyers`, `tracked_buyers`, `untracked_buyers`, `app_store_buyers` (`new_buyers = tracked + untracked + app_store`), plus `tracked_rate` = tracked / (tracked + untracked). A new buyer is a positive, non-trial first payment. `range_totals` adds `new_buyers`, `new_buyers_by_acquisition`, `new_buyers_by_source`.
- **App store links.** Site links to the App Store get `ct=<last-touch source>` (max 40 chars, default `website`) and `mt=8`; `pt` is added once a provider token is set (none exists in the repo yet). Google Play links get `referrer=utm_source%3D...%26utm_medium%3D...`. `/go/linktree-app` redirects to the App Store with `ct=main_instagram_linktree` (and `/go/linktree-android` to Google Play).
