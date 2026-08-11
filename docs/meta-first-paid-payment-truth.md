# Meta first-paid payment truth

The Uscreen webhook is candidate-only. It cannot send `JF_First_Paid_Membership` directly.

## Authoritative evidence contract

Before release, export one Uscreen user record and every page of that user's payment history into a temporary JSON file:

```json
{
  "history_complete": true,
  "next_cursor": null,
  "user": {
    "id": 123,
    "plan_history": [{ "plan_id": 230698, "origin": "web" }]
  },
  "payments": []
}
```

`history_complete` may only be true after the Uscreen payment cursor is exhausted. Keep the evidence file outside Git and delete it after reconciliation because it contains customer payment data.

## Release flow

```bash
node scripts/first-paid-candidate.mjs inspect <uscreen-user-id>
node scripts/first-paid-candidate.mjs reconcile <uscreen-user-id> /private/path/evidence.json <provider-invoice-id> --confirm-authoritative-uscreen-history
node scripts/first-paid-candidate.mjs inspect <uscreen-user-id>
node scripts/first-paid-candidate.mjs send <uscreen-user-id> --confirm-verified-first-paid --test-event-code=<META_TEST_CODE>
```

The reconciliation step rejects incomplete history, renewals, Apple/Google/admin origins, free invoices, non-subscription rows, refunds, missing invoices and non-Stripe web payments. It replaces webhook value and currency with the authoritative Uscreen invoice amount and currency.

The send step requires a verified record, the production Pixel ID, one stable Uscreen-user-based event ID, a five-minute atomic lock, positive value, three-letter currency and Meta's `events_received: 1` receipt. A sent record cannot be replayed.

## CPA and ROAS gate

Export attributed Meta conversions and their exact event, campaign, ad set and ad IDs. Pair them with the minimal sent reconciliation records, then run:

```bash
node scripts/reconcile-meta-uscreen.mjs /private/path/meta.json /private/path/uscreen-records.json
```

The command fails if any Meta conversion lacks full attribution identity, an authoritative Uscreen invoice, complete history, or exact value/currency agreement. CPA is emitted only after every conversion reconciles. ROAS is emitted only when Meta also supplies each conversion value normalized into the ad account spend currency.
