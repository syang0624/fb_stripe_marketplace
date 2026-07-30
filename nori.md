# Nori — Backend and Stripe Work Plan

**Owner:** Nori  
**Area:** Stripe Connect, payments, persistence, APIs, webhooks, and transaction integrity  
**Product:** SOLID  
**Source of truth:** [STRIPE-CONNECT-PRD.md](./STRIPE-CONNECT-PRD.md)  
**Frontend counterpart:** [steven.md](./steven.md)

## Goal

Build the trusted server-side transaction layer behind SOLID's existing negotiated deals:

1. Snapshot the accepted AI-negotiated price.
2. Charge the buyer before the meetup.
3. Keep funds on the platform account.
4. Onboard the individual seller to Stripe Connect.
5. Transfer the full agreed amount only after both parties confirm.
6. Initiate a full refund if either party cancels before release.

Use Stripe test mode for the hackathon. Implement this as a Stripe Connect separate-charges-and-transfers flow, not as legal escrow.

## File Ownership

Nori owns:

- `package.json`
- `package-lock.json`
- payment types shared with the frontend
- new server-only helpers under `lib/server/`
- new transaction and Stripe API routes under `app/api/`
- persistence schema, migrations, and repository code
- Stripe webhook handling
- environment-variable documentation
- backend and money-movement tests

Avoid editing Steven-owned presentation files unless coordinating an integration fix:

- `app/page.tsx`
- `app/globals.css`
- `components/FinalOffersReview.tsx`
- `components/payments/**`
- `components/seller/**`
- `app/seller/**`

## Critical Backend Rule

The browser is never authoritative for:

- transaction amount
- currency
- seller connected account
- payment success
- buyer/seller identity
- confirmation status
- refund eligibility
- transfer eligibility

All money movement and state transitions happen on the server against durable records.

## Architecture

### Stripe flow

Use Stripe Connect with separate charges and transfers:

1. Create a PaymentIntent on SOLID's platform account.
2. Capture the payment before the meetup.
3. Wait without creating a seller Transfer.
4. Create a Transfer for the full agreed amount after dual confirmation.
5. If canceled first, create a full Refund against the PaymentIntent.

The seller receives the full negotiated price. SOLID absorbs Stripe processing fees in the demo.

### Persistence

Use a durable database for:

- transaction state
- immutable deal snapshot
- confirmation timestamps
- connected account ID
- Stripe object IDs
- idempotency records
- processed webhook event IDs
- audit events

If the demo runs only on one local process, SQLite is acceptable. If it deploys to a serverless host, use a managed relational database. Keep transaction operations behind a repository/service boundary so Steven's API contract does not depend on the storage vendor.

## Canonical Shared Types

Create a shared payment type file that is safe to import from client components, for example:

`lib/paymentTypes.ts`

It should expose:

```ts
export type TransactionState =
  | "draft"
  | "payment_pending"
  | "payment_failed"
  | "funded"
  | "awaiting_confirmation"
  | "release_queued"
  | "paid_to_seller"
  | "refund_queued"
  | "refunded"
  | "canceled"
  | "needs_attention";

export interface PublicTransaction {
  id: string;
  listingTitle: string;
  sellerDisplayName: string;
  amountCents: number;
  currency: "usd";
  meetTime: string;
  meetPlace: string;
  state: TransactionState;
  buyerConfirmedAt: string | null;
  sellerConfirmedAt: string | null;
  sellerOnboardingComplete: boolean;
  transferStatus: "not_started" | "pending" | "complete" | "failed";
  refundStatus: "not_started" | "pending" | "complete" | "failed";
  createdAt: string;
  updatedAt: string;
}
```

Do not expose secret tokens, client secrets, Stripe account details, Charge IDs, or internal error data through this general public shape.

## Suggested Persistent Model

### `transactions`

- `id`
- `buyer_token_hash`
- `seller_token_hash`
- `negotiation_id`
- `listing_id`
- `listing_title`
- `seller_display_name`
- `amount_cents`
- `currency`
- `meet_time`
- `meet_place`
- `state`
- `buyer_confirmed_at`
- `seller_confirmed_at`
- `cancel_requested_by`
- `cancel_requested_at`
- `stripe_payment_intent_id`
- `stripe_charge_id`
- `stripe_connected_account_id`
- `stripe_transfer_id`
- `stripe_refund_id`
- `last_error_code`
- `created_at`
- `updated_at`

Store hashes of public access tokens, not raw tokens, if the implementation allows.

### `stripe_events`

- `stripe_event_id` unique
- `event_type`
- `transaction_id`
- `processed_at`

### `operation_attempts`

- `transaction_id`
- `operation`
- `idempotency_key` unique
- `stripe_object_id`
- `status`
- `last_error`
- timestamps

### `transaction_events`

- `transaction_id`
- `event_type`
- `actor`
- `from_state`
- `to_state`
- `metadata`
- `created_at`

## API Contract

All successful mutation responses should include the latest frontend-safe `transaction`.

### Create transaction

`POST /api/transactions`

Request:

```json
{
  "negotiationId": "listing-or-negotiation-id"
}
```

Response:

```json
{
  "transaction": {},
  "buyerToken": "unguessable-buyer-token",
  "sellerUrl": "/seller/deal/unguessable-seller-token"
}
```

Important: the current negotiation is client-side. Before this endpoint is production-safe, the server must have or reconstruct trusted negotiation state. For the hackathon:

- persist the final offer server-side when it is generated, or
- sign the final-offer snapshot server-side before transaction creation

Do not accept a raw browser-supplied amount as trusted input.

### Create or reuse PaymentIntent

`POST /api/transactions/:id/payment-intent`

Response:

```json
{
  "clientSecret": "pi_..._secret_...",
  "transaction": {}
}
```

### Buyer read, confirm, and cancel

- `GET /api/transactions/:id?token=:buyerToken`
- `POST /api/transactions/:id/confirm`
- `POST /api/transactions/:id/cancel`

Confirm/cancel request:

```json
{
  "token": "buyer-token"
}
```

### Seller read and act

- `GET /api/seller/deals/:sellerToken`
- `POST /api/seller/deals/:sellerToken/onboarding`
- `POST /api/seller/deals/:sellerToken/confirm`
- `POST /api/seller/deals/:sellerToken/cancel`

Onboarding response:

```json
{
  "url": "https://connect.stripe.com/..."
}
```

### Webhook

`POST /api/stripe/webhook`

Verify the Stripe signature against the raw request body.

## Work Breakdown

### N1. Add dependencies and environment contract

- [ ] Install Stripe's server SDK.
- [ ] Install the Stripe browser/React packages Steven needs.
- [ ] Add public and server-only environment variable documentation.
- [ ] Fail with a clear configuration error when required payment secrets are missing.
- [ ] Ensure secret keys are never imported into client bundles.

Expected variables:

```text
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
APP_BASE_URL=
DATABASE_URL=
```

### N2. Add persistence and transaction service

- [ ] Choose the database appropriate to the demo deployment.
- [ ] Add schema and migration.
- [ ] Add a server-only transaction repository.
- [ ] Add cryptographically random buyer and seller access tokens.
- [ ] Add token verification.
- [ ] Add audit-event recording.
- [ ] Add atomic compare-and-set state transitions.
- [ ] Add transaction lookup by Stripe PaymentIntent ID and connected account ID.

Keep state-machine logic out of route handlers. Suggested services:

- `lib/server/transactions.ts`
- `lib/server/stripe.ts`
- `lib/server/authTokens.ts`
- `lib/server/paymentStateMachine.ts`

### N3. Make negotiated offers server-trusted

This is the main integration gap in the current code.

- [ ] Persist or server-sign the final offer produced by the negotiation flow.
- [ ] Bind the offer to negotiation/listing ID, final price, seller, meetup details, and expiration.
- [ ] Create a transaction only from a valid `final_offer`.
- [ ] Convert dollars to integer cents exactly once on the server.
- [ ] Reject modified, expired, withdrawn, scam-detected, zero, or negative offers.
- [ ] Prevent more than one active funded transaction for the same accepted offer.

### N4. Create the buyer PaymentIntent

- [ ] Implement `POST /api/transactions/:id/payment-intent`.
- [ ] Read amount and currency exclusively from the database.
- [ ] Create the PaymentIntent on the platform account.
- [ ] Attach metadata containing only internal non-sensitive identifiers.
- [ ] Use an idempotency key derived from transaction ID and operation version.
- [ ] Reuse an existing valid PaymentIntent on duplicate requests.
- [ ] Store PaymentIntent ID before returning the client secret.
- [ ] Support standard Stripe test cards.

Do not set the transaction to funded from this endpoint.

### N5. Process payment webhooks

- [ ] Implement the raw-body webhook route.
- [ ] Verify webhook signatures.
- [ ] Persist Stripe event IDs before or atomically with processing.
- [ ] Make duplicate event delivery harmless.
- [ ] Reconcile:
  - [ ] `payment_intent.succeeded`
  - [ ] `payment_intent.payment_failed`
  - [ ] `payment_intent.canceled`
  - [ ] refund lifecycle events
  - [ ] `account.updated`
  - [ ] relevant transfer events
- [ ] Move a successful payment to `funded`/`awaiting_confirmation`.
- [ ] Store the latest Charge ID.
- [ ] Never let an older event regress a terminal state.

### N6. Build seller Connect onboarding

- [ ] Create one connected account for the demo seller identity.
- [ ] Configure the account for an individual seller.
- [ ] Create single-use Stripe-hosted onboarding links.
- [ ] Use correct refresh and return URLs.
- [ ] Persist connected account ID.
- [ ] Read Stripe account state server-side after onboarding return.
- [ ] Track whether the account can receive transfers.
- [ ] Reuse the same connected account rather than creating duplicates.
- [ ] Return only the hosted onboarding URL to Steven.

### N7. Implement confirmation

- [ ] Add buyer and seller confirmation endpoints.
- [ ] Authenticate each actor using their scoped token.
- [ ] Allow confirmation only when payment is funded.
- [ ] Store buyer and seller timestamps separately.
- [ ] Make repeat confirmation return the current state successfully.
- [ ] Atomically transition to `release_queued` only when both timestamps exist.
- [ ] Queue or invoke the seller transfer after winning that transition.

The request that records the second confirmation must not be able to race a cancellation into both refund and transfer paths.

### N8. Implement seller transfer

- [ ] Confirm the transaction is `release_queued`.
- [ ] Confirm the connected account is eligible to receive funds.
- [ ] Create one Transfer for the full `amount_cents`.
- [ ] Link it to the originating charge/payment where supported.
- [ ] Use a stable Stripe idempotency key.
- [ ] Persist the Transfer ID.
- [ ] Move to `paid_to_seller` only after successful creation/reconciliation.
- [ ] On a recoverable error, preserve `release_queued` or move to `needs_attention`.
- [ ] Provide a safe retry path.

If onboarding is incomplete after both confirmations, retain `release_queued`, prompt the seller to finish onboarding, and retry only when eligible.

### N9. Implement cancellation and refund

- [ ] Add buyer and seller cancel endpoints.
- [ ] Allow cancellation only before `paid_to_seller`.
- [ ] Atomically make `refund_queued` win over any later confirmation.
- [ ] Create one full Refund against the stored PaymentIntent.
- [ ] Use a stable refund idempotency key.
- [ ] Persist Refund ID and status.
- [ ] Move to `refunded` after Stripe confirms success.
- [ ] Preserve a safely retryable state on failure.
- [ ] Make duplicate cancellation requests return the established refund state.

### N10. Add timeout refund

- [ ] Add a configurable expiration based on meetup time.
- [ ] Default the hackathon rule to 24 hours after the scheduled meetup.
- [ ] Find funded transactions without both confirmations.
- [ ] Use the same atomic refund path as user cancellation.
- [ ] Make scheduled retries idempotent.

If parsing the current free-text `meetTime` is unreliable, add a normalized meetup timestamp to the transaction snapshot while retaining the display string.

### N11. Add status/read APIs

- [ ] Return frontend-safe transaction state to the buyer.
- [ ] Return a seller-safe view to the seller.
- [ ] Exclude tokens, client secrets, card data, private Stripe details, and raw errors.
- [ ] Return consistent HTTP status/error codes.
- [ ] Include `Cache-Control: no-store` for live transaction state.
- [ ] Add rate limiting to public token endpoints.

### N12. Backend tests

- [ ] Transaction creation rejects untrusted or altered prices.
- [ ] Duplicate PaymentIntent request creates one PaymentIntent.
- [ ] Browser success without webhook does not fund a transaction.
- [ ] Duplicate webhook delivery is harmless.
- [ ] Buyer-only confirmation creates no Transfer.
- [ ] Seller-only confirmation creates no Transfer.
- [ ] Second confirmation creates exactly one Transfer.
- [ ] Buyer cancellation creates exactly one Refund.
- [ ] Seller cancellation creates exactly one Refund.
- [ ] Concurrent cancel and confirm results in either Refund or Transfer, never both.
- [ ] Transfer failure remains safely retryable.
- [ ] Incomplete seller onboarding prevents transfer without losing confirmation state.
- [ ] Unauthorized buyer/seller tokens are rejected.
- [ ] Terminal states cannot regress.
- [ ] Run `npm run typecheck` and `npm run build`.

## Stripe Test Setup

- [ ] Activate Connect in the Stripe test environment.
- [ ] Configure platform branding for SOLID.
- [ ] Configure the webhook endpoint.
- [ ] Use Stripe CLI forwarding for a local demo if needed.
- [ ] Create/test an individual connected account.
- [ ] Record the successful test card scenario.
- [ ] Record a declined-card scenario.
- [ ] Verify one test Transfer in the Stripe Dashboard.
- [ ] Verify one test Refund in the Stripe Dashboard.

## Error Contract

Use a stable response envelope:

```json
{
  "error": {
    "code": "TRANSACTION_NOT_FUNDED",
    "message": "This deal cannot be confirmed until payment succeeds."
  }
}
```

Suggested codes:

- `INVALID_OFFER`
- `OFFER_EXPIRED`
- `TRANSACTION_NOT_FOUND`
- `UNAUTHORIZED_DEAL_ACCESS`
- `PAYMENT_NOT_CONFIGURED`
- `PAYMENT_FAILED`
- `TRANSACTION_NOT_FUNDED`
- `SELLER_ONBOARDING_REQUIRED`
- `TRANSACTION_ALREADY_REFUNDED`
- `TRANSACTION_ALREADY_RELEASED`
- `INVALID_STATE_TRANSITION`
- `STRIPE_OPERATION_PENDING`

Messages returned publicly must be safe for display. Log detailed Stripe errors only on the server.

## Sync Points

### Sync 1 — Contract and dependencies

Nori delivers first:

- shared public transaction types
- installed Stripe dependencies
- environment-variable names
- route paths and response envelopes
- temporary stub responses if full routes are not ready

Steven confirms frontend compilation.

### Sync 2 — Payment

Nori delivers:

- trusted transaction creation
- PaymentIntent endpoint
- payment webhook
- transaction read endpoint

Together verify a Stripe test payment becomes webhook-confirmed `funded`.

### Sync 3 — Seller and release/refund

Nori delivers:

- seller onboarding link
- buyer/seller confirmation
- dual-confirmation Transfer
- either-party Refund

Together verify both browser views update.

### Sync 4 — Final demo

Together run:

- happy path with one Transfer
- cancellation path with one Refund
- page refresh during payment processing
- duplicate confirmation/cancel clicks
- incomplete onboarding recovery

## Definition of Done

Nori's work is complete when:

- an accepted final offer becomes a durable, immutable transaction
- the buyer pays the exact server-trusted negotiated amount in Stripe test mode
- webhook state, not browser state, marks payment successful
- an individual seller can complete Stripe-hosted onboarding
- no Transfer occurs until both parties confirm
- either party can initiate a full Refund before release
- concurrent and duplicate requests cannot create both outcomes or duplicate money movement
- transaction status survives refresh and server restart
- server logs provide enough identifiers to demo and debug safely
- backend tests, typecheck, and production build pass

