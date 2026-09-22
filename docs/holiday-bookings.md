# School holiday bookings

Parents book coaching sessions at `/holiday-bookings/` behind one shared password.
Lee manages availability at `/holiday-admin/`. Payment is Stripe Checkout on the
Sydney (AUD) account. Bookings land in the `Holiday Bookings` tab of the camp
registration Google Sheet, parents get a Brevo confirmation, Lee gets an alert.

## Pieces

| File | Job |
|---|---|
| `api/_holiday-store.js` | KV data model, atomic seat hold (Lua), access cookie, Sydney time helpers, Stripe fetch |
| `api/_holiday-finalise.js` | Turns a paid Stripe session into a confirmed seat, idempotently |
| `api/_holiday-email.js` | Confirmation email, Lee's alert, roster sheet row |
| `api/holiday-access.js` | Password -> signed HttpOnly cookie |
| `api/holiday-slots.js` | Open slots with places remaining (cookie required) |
| `api/holiday-book.js` | Hold seats, create Checkout Session (cookie required) |
| `api/holiday-confirm.js` | Success page asks Stripe directly; self-heals without the webhook |
| `api/holiday-payment-webhook.js` | `checkout.session.completed` / `expired` |
| `api/holiday-admin.js` | Slots, prices, coaches, bookings (admin secret required) |
| `src/pages/holiday-bookings.astro` | Parent page: gate, filters, slot cards, booking sheet |
| `src/pages/holiday-bookings/success.astro` | Confirmation, add to calendar |
| `src/pages/holiday-admin.astro` | Lee's admin |
| `scripts/test-holiday-store.mjs` | Unit checks (`npm run test:holiday`) |
| `scripts/holiday-local.mjs` | Local harness with mock KV and mock Stripe (see below) |

## One booking owns the hour

Lee's rule: whoever books an hour gets the whole hour. Choosing 1 to 1, shared
or group only sets the price per player and how many of **their own** players
they may bring (1, 2, or up to 6). No other family can buy into it. A paid or
held hour is shown as Booked and refuses every later booking of any type.

## How a booking works

1. Parent enters the password. Server checks it and sets a signed cookie (14 days).
   Changing `HOLIDAY_BOOKING_PASSWORD` invalidates every cookie.
2. Page fetches open slots. Places remaining = capacity minus confirmed seats minus live holds.
3. Parent picks a slot, number of players, enters details, taps Pay.
4. Server reserves the seats with one atomic Redis script (two families cannot both
   take the last place), creates a Stripe Checkout Session that expires in 30 minutes,
   saves the booking as `held`.
5. Parent pays on Stripe.
6. Stripe calls the webhook, or the success page calls `holiday-confirm`, whichever is
   first. Both call `finaliseBooking`, which takes a short lease, confirms the hour, then
   runs three effects (roster row, parent email, Lee alert). Each effect records its own
   outcome on the booking: done, failed, or uncertain. A crash mid-flight leaves a stale
   lease that the next caller takes over. Admin shows anything not done and offers Repair,
   which retries definite failures only. An uncertain outcome (the provider may or may not
   have acted) is never retried automatically, because a duplicate email is worse than a
   late one; the sheet is the exception, since a retry checks for the row first.
7. If the parent abandons, Stripe sends `checkout.session.expired` and the hold is
   released. Holds also lapse on their own after 31 minutes.

## Lee's setup (one time)

1. **Vercel -> Settings -> Environment Variables** (Production and Preview):
   - `HOLIDAY_BOOKING_PASSWORD` = the password for parents
   - `HOLIDAY_SIGNING_SECRET` = `openssl rand -hex 32`
   - `HOLIDAY_ADMIN_SECRET` = a long random string only you know
   - `STRIPE_HOLIDAY_WEBHOOK_SECRET_SYDNEY` = from step 2
   Redeploy after adding.
2. **Stripe (Sydney account) -> Developers -> Webhooks -> Add endpoint**
   - URL: `https://jonerfootball.com/api/holiday-payment-webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`
   - Save, click Reveal on the signing secret, paste it into Vercel as above.
3. Open `https://jonerfootball.com/holiday-admin/`, paste the admin secret.
   Prices and Coaches tab: set the six prices, check the coach list. Save.
   Slots tab: pick coach, type, duration, add dates and start times, Create.
4. Send parents `https://jonerfootball.com/holiday-bookings/` and the password.

### Dry run first (recommended)

Set `STRIPE_HOLIDAY_SECRET_KEY` to the Sydney **test** secret key, and register the
webhook in Stripe Test mode with the test signing secret. Make a booking with card
`4242 4242 4242 4242`. Check the sheet row, the two emails, and that the seat shows
as taken. Then delete `STRIPE_HOLIDAY_SECRET_KEY` and swap the webhook secret for the
live one.

## Day to day

- Roster: the `Holiday Bookings` tab in the camp sheet, or the Bookings tab in admin
  (filter, CSV download).
- Cancel a booking: Bookings tab -> Cancel. The seat is released. If it was paid, the
  Stripe payment opens so you can refund it there.
- Cancel a slot: Slots tab -> Cancel. Paid bookings in it are flagged in the Bookings
  tab for a refund.
- An hour booked offline: Slots tab -> Block, or tick Blocked when creating slots. Parents
  see it as Booked. Blocking refuses if a family already holds that hour.
- A booking showing a failed effect: Bookings tab -> Repair.
- New holiday period: add the new slots. Change the password if you want a fresh start.

## Local testing

```
npm run build
node scripts/holiday-local.mjs
```

`npm run test:holiday-flow -- <port>` runs the nine acceptance checks against a running
harness (exclusivity, concurrency, pricing, expiry, stale release, duplicate webhook,
failure recovery, blocked hours). `/__fail?what=sheet&on=1` injects provider failures.

Serves the built site at `http://localhost:4321` with an in-memory KV and a mock
Stripe page (pay, pay without webhook, expire, cancel). Parent password `holiday`,
admin secret `admin`. Nothing leaves the machine.
