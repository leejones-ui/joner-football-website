# JFP player charges, invoices and Match to player

Money engineer, 14 Oct 2026. Branch `claude/money-charges`.

## Player charges (`api/_jfp-charges.js`)

A charge is money a player owes on top of their term: an extra session,
video analysis, or an invoice that is not a term fee. It is tied to the
player from the start and is the only payment path for extra sessions.

```js
import { createPlayerCharge } from './_jfp-charges.js'

const r = await createPlayerCharge({
  config,                      // getConfig()
  principal,                   // { email, name } of the coach or staff member (or the family)
  rowId,                       // the player's Term 4 row, or
  profileKey,                  // a profile key (`<normName>|<email>`) for a player with no row
  email,                       // optional with a rowId (taken from the row); needed otherwise
  playerName,                  // optional with a rowId
  amountCents: slot.priceCents,// A$1 to A$20,000, in cents
  label: `Extra session, ${slot.dateLabel} ${slot.time}`,
  kind: 'extra',               // 'extra' | 'analysis' | 'invoice'
  sessionDate: slot.date,      // 'YYYY-MM-DD', optional
  coachId: slot.coachId,       // a config.coaches id, optional (Money > Extra sessions by coach)
  groupId,                     // optional
  ref: `extra:${slot.id}:${booking.id}`, // idempotency key: the same ref gives back the same charge
  siteUrl,                     // optional, for the receipt's My account button
})
// r = { ok: true, payreqId, charge, payreq, existing }
//   | { ok: false, status, error, code? }
```

- **Idempotent on `ref`.** The same ref again returns the first charge
  (`existing: true`), never a second one. The same ref for a different
  player is refused (409, `code: 'ref_other_player'`): make refs unique per
  player and booking.
- **Program.** `extra` and `analysis` count in Extra sessions (`extra`). An
  `invoice` charge counts in its invoice's program (`extra` or `other`).
  A charge is never a JFP or Pro term fee.
- **What the family sees.** The charge's payment request (`PAY-...`,
  `reason: 'charge'`, `term4Ids: []`) is sent to the player's email, so it
  shows on My account Home and in Fees with Pay (the waiver is needed first,
  as for every payment; no kit step). Paying opens the usual Stripe Checkout
  with metadata `jfpProgramme: 'extra'`, `jfpCharge`, `jfpPlayer`, `jfpRowIds`.
- **Paid.** The webhook (`_jfp-finalise.js`, effects `charge`, `parentEmail`,
  `staffAlert`) marks the charge paid, keeps the Stripe fee, and emails a
  receipt. No Term 4 row and no term ledger line is touched, and
  `classifySession` puts it in "other", never JFP term income.
- **Reading the status.** `getPayreq(payreqId).status` is `'paid'` however it
  was paid: card, or bank or cash recorded by staff (then `paidOffline: true`
  and `paidMethod`). `'open'` or `'checkout'` while unpaid, `'cancelled'` if
  the charge was cancelled.

Other exports: `getCharge`, `listCharges`, `recordChargePayment` (bank, cash,
other), `cancelCharge`, `extraMoneyData`, `chargeCheckoutMeta`.

### Staff actions (`api/_jfp-money-actions.js`, admin only)

| action | does |
|---|---|
| `createCharge` | Money > Extra sessions > New charge: `{ rowId, amountCents, kind, label, sessionDate, coachId, ref }` |
| `chargeRecord` | a bank, cash or other payment `{ id, method, amountCents, date }`; part payments leave the rest to pay by card |
| `chargeCancel` | an unpaid charge |
| `extraMoney` | Money > Extra sessions: taken, fees, kept, by coach, by month, by player, still to pay |

## Money > Extra sessions

In the Program menu as "Extra sessions" (`#money?programme=extra`). Lines:
every payment on an `extra` charge, plus paid quick links made for Extra
sessions. None of it is in the JFP figures.

## Invoices (`api/_jfp-invoices.js`, page `/jfp-invoice/?i=<token>`)

Money > Invoices (`#money?programme=invoices`): New invoice (family and
players, lines from Prices or typed, due date, notes), Preview email and
Send, Mark ready (no email), Copy link, Record payment, Void, and a list
filtered by Draft, Sent, Viewed, Part paid, Paid, Void, Overdue.

- `INV-<n>`, numbered from 1001. The page link carries a 32 character random
  token; it shows that invoice only.
- Prices include GST (Xero: 2100 All Coaching Income and 220 In-Person
  Coaching are GST on Income). The invoice says "Includes GST of A$X" (one
  eleventh). The ABN shows only if saved in Settings > Invoices.
- Bank details show only once Settings > Invoices has the account name, BSB
  and account number. Reference format default `INV-<n> <player>`.
- PDF: Download PDF prints the page as an A4 invoice (no PDF library in the
  project, so the browser's own print to PDF).
- JFP and Pro sessions invoices are for a place: their payment request names
  the players' rows, so a payment records on the rows and the ledger as any
  JFP link. When the rows owe less than the invoice, the last row's fee goes
  up by the difference on Send (a Void puts it back).
- Extra sessions and Other invoices are player charges (`kind: 'invoice'`).
- A bank transfer whose reference names the invoice (`INV-1004`, `INV 1004`,
  `inv1004`) shows on Money > JFP > Bank transfers to check with
  "Record on INV-1004", guarded exactly like any bank line.

## Player-tied links and Match to player (`api/_jfp-stripe-match.js`)

- A quick link needs a player, or a reason for having none (`noPlayerReason`).
  Every portal link carries `jfpPlayer` and `jfpRowIds` in its Stripe
  metadata, and the player's name in the line item.
- Money > JFP > Stripe payments not matched > Match to player: on the term
  fee (`as: 'jfp'`, the old record) or as an extra session (`as: 'extra'`),
  and remember the Stripe payment link or the email. The Stripe sync then
  matches the next payment through that link or from that email by itself,
  and never flags it on Telegram. `stripeMatchRules` lists what is
  remembered; `stripeMatchForget` drops one.
