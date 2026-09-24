# Website master contact capture: local review handoff

Scope: local implementation only on HEAD aed0165. No commit, push, deploy, live form submission or live API writes. Existing .vercel linkage, .env.local, vercel.json and term/player/payment writers are not edited. No customer-facing copy/design changed.

## Coverage inventory

Seven submission endpoints, eight submission branches:

1. `api/contact-enquiry.js`: `phone`, all general, training-sydney, game-analysis, joners-juniors, coaching-role and team-subscriptions enquiries. Pages: contact, training, training/professional-training, training/jfp-program, training/game-analysis, teams, hq, and parked about page. New-coaching-role redirects/links into contact. Capture runs after existing validation, duplicate suppression, email, Brevo and Teams sheet handling. Existing duplicate fast-return remains unchanged.
2. `api/subscribe.js`: optional `phone`; workshops/coaches-course and workshops/mindset-seminars submit via the BaseLayout generic Brevo handler. All other subscribe forms remain supported: missing phone does nothing. Uscreen webhook branch stays separate and does not capture. Capture runs after existing successful subscription/notification handling.
3. `api/camp-registration.js`: `mobile`; dynamic camps/[slug], camps/test-signup and draft San Diego form. All camp variants share this handler. Capture runs after existing pending registration, checkout fallback, Brevo and conditional emails; no paid-state change.
4. `api/selection-application.js`: `mobileNumber`; draft LA TCPE form. Capture runs after existing email/Brevo. Parent label and player evidence remain separate; absent parent name does NOT make player the phone owner.
5. `api/juniors-registration.js`: `mobile`, normalised registration.parent. Page jonersjuniors. Capture runs after existing pending sheet/Brevo/checkout/session update. Does not touch the paid webhook or Juniors term table.
6. `api/jfp-book.js`: `mobile` for BOTH direct submit and action=apply (Pathway). Parent and player evidence captured after existing booking/application operations. reserve/release accept no new contact details. payApproved consumes the already stored application, not new phone input, so no duplicate capture at payment time.
7. `api/holiday-book.js`: `mobile`, successful booking submit only. reserve/release excluded; no new phone input. Existing seat holds, price, Stripe requests and booking writes preserved.

Other phone-bearing handlers inspected and deliberately excluded:
- `juniors-email-test.js`: authenticated synthetic email preview, not a customer lead; capturing here would pollute the master.
- `track-event.js`: analytics user_data phone hashing, not a contact submission; never turn tracking events into directory consent.
- `camp-payment-webhook.js`, `juniors-payment-webhook.js`, `camp-confirm-payment.js`: existing stored registration/payment processing, not new form contacts.
- `camp-unpaid-reminders.js`: reads existing pending registration, not new intake.
- `holiday-admin.js`, `jfp-portal-data.js`: administrative/readback use of stored phone details, not new customer intake.
- Website player waiver route is absent (existing regression test confirms this). Native Airtable waiver forms are outside this website change.
- `master-contact-capture-replay.js`: NEW authenticated operator-only capture service, not a customer submission endpoint.

The inventory test scans current API source for phone/mobile/mobileNumber/normaliseRegistration and requires each public handler to be classified. Manual frontend scan also covers generic BaseLayout forms and drafts.

## Persistence and identity rules

- Disabled by default. Generic existing AIRTABLE_API_TOKEN cannot accidentally activate this lane.
- Only the canonical base and two canonical directory table IDs are accepted. No schema mutation, term/player/payment write or linked-record creation exists in the helper.
- E.164 validated using libphonenumber-js/max. USA routing uses actual numbering region, NOT +1 alone, and makes no residence claim. Canadian/other +1 remains main.
- AU national-number hint exists only for server-known local programmes: Sydney training/Juniors contact, Juniors registration, JFP and holiday bookings. Explicit country/countryCode can accompany other form payloads. International + or 00 numbers self-describe.
- National numbers on global forms without country context are NOT guessed. They are retained in the private durable review queue, not silently discarded or assigned an invented country. No frontend country selector has been added.
- Query BOTH directories by canonical `phone:+E164` key. Conflicting/duplicate matches stop for review. Existing regional placement is preserved.
- Existing names, recipient names, blank identity fields, permissions, suppressions and player links are untouched. Source labels include new submitted name/role; evidence retains separate player names. A shared number is an endpoint, not proof of a person merge.
- New records get Marketing Permission = `Unknown - consent review required`. No promotional permission is granted. Existing approval/do-not-contact checkboxes are never changed; new checkboxes remain absent/false under existing schema defaults.
- No emergency phone, DOB, medical, signature, attachment, message, payment secret or raw arbitrary body is copied. Capture uses explicit fields only.
- Queue first using atomic Redis HSETNX, no TTL. Same payload hashes to the same queue key. Per-phone Redis NX/EX lease serialises this writer; Airtable create uses performUpsert on Master Contact Key. Conditional Lua unlock checks ownership.
- Exact written-field readback required before removing the queued item. Provider outage, collision or readback mismatch leaves the capture queued. Each request has a 1200ms timeout; capture errors are nonfatal to original form success.
- This is not a transaction with unrelated Airtable/manual writers. Operator must avoid simultaneous directory migration/import. Deployment must provide a function budget allowing the bounded additional capture calls.
- If KV itself is unavailable, forms keep their existing result, a redacted failure is logged, and no persistence success is claimed. That case cannot be durably queued in the unavailable store; recover using existing enquiry email/booking evidence. Monitor logs and pending queue before enabling.
- No automatic replay cron or new customer automation is installed. Pending review requires an operator; HSCAN is cursor-based and COUNT is a Redis hint, not a complete-list limit.

## Required runtime configuration (parent provisions; not changed here)

- `MASTER_CONTACT_CAPTURE_ENABLED=true` only after controlled validation; default false.
- `MASTER_CONTACT_AIRTABLE_TOKEN`: dedicated PAT with data.records:read and data.records:write access to the canonical base. No schema write scope needed. Airtable PAT access is generally base-scoped; code additionally hard-limits tables.
- `MASTER_CONTACT_BASE_ID=apphU4R0BtVIu5YqT`
- `MASTER_CONTACT_TABLE_ID=tblpG1ONWlnNcpt0p`
- `MASTER_CONTACT_USA_TABLE_ID=tblokhiB50ouldnAu`
- Existing `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or UPSTASH_REDIS_REST_URL/TOKEN), supporting HSETNX/HGET/HDEL/HSCAN/SET/EVAL. Private PII queue namespace `master-contact-capture:outbox:index`; per-phone lock namespace `master-contact-capture:outbox:lock:*`. Restrict access and review unresolved PII retention.
- `MASTER_CONTACT_CAPTURE_REPLAY_SECRET`: strong random operator secret, used only in a header, never a query parameter.
- No change to existing Brevo/Stripe/Sheets/JFP variables.

## Schema requirements

No new tables or fields required. Uses existing master fields documented in Airtable.md and local schema snapshots: Contact Name, Master Contact Key, Mobile Number, Contact Type, Identity Status, Source Contact Labels, Sources, Emails from Sources, Source Evidence, Import Batch, Marketing Permission. Existing links, recipient fields and suppression flags are preserved. Parent must verify both live schemas and that Master Contact Key is unique per endpoint before activation; no live schema request was made for this local task.

## Notification-free operator entrypoint

`POST /api/master-contact-capture-replay`, authenticated by `x-master-capture-secret` (or Bearer header). Cache-Control: no-store. Do NOT invoke public forms for persistence verification.

Bodies:
- `{ "action": "dryRun", "payload": { "phone": "+...", "country": "AU", "name": "Approved verification label", "email": "approved@example.test", "endpoint": "operator-verification", "source": "controlled-verification" } }`: pure mapping, no network/write.
- Same payload with `action=capture`: directory-only capture plus private KV; result.status=persisted includes exact table/recordId after readback. No Brevo/Sheets/Stripe/customer notifications.
- `{ "action": "list", "limit": 20, "cursor": "0" }`: pending IDs with cursor. Follow until cursor=0.
- `{ "action": "replay", "id": "<64-char capture hash>" }`: retries that queued payload only, performs exact readback, then removes it. Missing/finished ID returns not_found. Invalid/ambiguous phone remains review_required.

HTTP 200 on operator capture is NOT proof of persistence; inspect result.status. Only persisted is verified. DryRun returns sensitive mapping to an authenticated operator, so do not paste it into public logs. Parent controls any live fixture and subsequent approved cleanup. No live fixture was submitted here.

## Local tests

- `npm run test:master-contact-capture`: helper/stateful fake Airtable+KV tests and isolated real-handler characterization against HEAD. All network is intercepted; only fake credentials are used.
- Handler tests execute the actual handler source using Node VM modules and synthetic service dependencies. They compare original response, email/Brevo/payment/Sheets/service calls with HEAD for each fixture, for capture success AND failure, and reject GET without capture. Experimental VM flag is test-only.
- `npm test`: existing regression suite.
- `npm run test:juniors`, `npm run test:teams-crm`: extra affected-lane regressions.
- `npm run build`: Astro production build locally. Existing Sanity read-only build queries may run. This is NOT a serverless deployment or live persistence test.

Test logs and full review patch are in the parent `website-master-capture` directory. No commit/push/deploy required or performed.
