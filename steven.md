# Steven — Frontend Work Plan

**Owner:** Steven  
**Area:** Buyer and seller frontend experiences  
**Product:** SOLID  
**Source of truth:** [STRIPE-CONNECT-PRD.md](./STRIPE-CONNECT-PRD.md)  
**Backend counterpart:** [nori.md](./nori.md)

## Goal

Extend the existing SOLID flow from:

`Profile → Search → Deals → Negotiate → Review`

to:

`Profile → Search → Deals → Negotiate → Review → Pay → Meetup confirmation → Complete or Refunded`

Steven owns presentation, browser-side state, Stripe payment UI, and integration with Nori's server APIs. Steven does not create Stripe PaymentIntents, transfers, refunds, connected accounts, or trusted transaction state in the browser.

## File Ownership

Steven owns:

- `app/page.tsx`
- `app/globals.css`
- `components/FinalOffersReview.tsx`
- new buyer payment and transaction components under `components/payments/`
- new seller pages/components under `app/seller/` and `components/seller/`
- frontend-only helpers under `lib/client/`

Steven should consume, but not independently change, Nori-owned payment types and API behavior.

Avoid editing:

- `app/api/**` payment, transaction, seller, and Stripe routes
- `lib/server/**`
- database schema and migrations
- Stripe webhook code
- `.env*`
- `package.json` and `package-lock.json` until Nori completes the shared dependency setup

If a shared contract must change, agree on the change with Nori before editing it.

## Existing Code to Preserve

- Keep onboarding, search, listing selection, simulated negotiation, scam detection, and final-offer modification working.
- `FinalOffersReview` already receives the selected `Negotiation`.
- The payable price is displayed from `negotiation.finalOffer.finalPrice`.
- The current `handleAccept` in `app/page.tsx` only sets local `accepted` state. Replace this behavior with transaction creation and checkout.
- Do not allow the frontend to choose or overwrite the server-side payable amount.

## Shared Transaction Shape

Nori will expose a frontend-safe transaction object equivalent to:

```ts
type TransactionState =
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

interface PublicTransaction {
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

Use the canonical shared type Nori adds to the repository rather than duplicating this interface in production code.

## API Contract Steven Consumes

### Create a transaction

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

The server derives the price and final-offer fields from trusted application state. Do not send an amount from the browser.

### Start or resume checkout

`POST /api/transactions/:id/payment-intent`

Response:

```json
{
  "clientSecret": "pi_..._secret_...",
  "transaction": {}
}
```

### Read buyer transaction

`GET /api/transactions/:id?token=:buyerToken`

Response:

```json
{
  "transaction": {}
}
```

### Buyer confirms

`POST /api/transactions/:id/confirm`

Request:

```json
{
  "token": "buyer-token"
}
```

### Buyer cancels

`POST /api/transactions/:id/cancel`

Request:

```json
{
  "token": "buyer-token"
}
```

### Read seller transaction

`GET /api/seller/deals/:sellerToken`

### Start seller onboarding

`POST /api/seller/deals/:sellerToken/onboarding`

Response:

```json
{
  "url": "https://connect.stripe.com/..."
}
```

### Seller confirms or cancels

- `POST /api/seller/deals/:sellerToken/confirm`
- `POST /api/seller/deals/:sellerToken/cancel`

Every mutation response should include the latest `transaction`.

## Work Breakdown

### S1. Introduce the payment UI state

- [ ] Replace the single `accepted` boolean/object path with a post-negotiation flow state.
- [ ] Add states for transaction creation, checkout, payment processing, funded, awaiting confirmation, release, completion, refund, and error.
- [ ] Keep the existing progress navigation understandable after Review.
- [ ] Store only the transaction ID and buyer token needed to reload state.
- [ ] Restore an active transaction after refresh.

Suggested frontend state:

```ts
type PaymentView =
  | "creating_transaction"
  | "checkout"
  | "processing"
  | "meetup"
  | "complete"
  | "refund"
  | "error";
```

The server's `transaction.state` remains authoritative.

### S2. Update the final offer action

- [ ] Rename **Accept** to **Accept & pay**.
- [ ] On click, show a final payment summary.
- [ ] Display item, seller, agreed price, meetup time, and meetup place.
- [ ] Explain that seller payment waits for both confirmations.
- [ ] Explain that a failed meetup results in a full refund.
- [ ] Disable Modify and Decline once transaction creation or checkout begins.
- [ ] Call `POST /api/transactions`.
- [ ] Continue to checkout using the returned transaction.

### S3. Build Stripe checkout

Create:

- [ ] `components/payments/CheckoutPanel.tsx`
- [ ] `components/payments/PaymentStatus.tsx`

Requirements:

- [ ] Use Stripe's React payment components configured with the server-provided client secret.
- [ ] Display the amount from `transaction.amountCents`; never from local negotiation state after transaction creation.
- [ ] Handle loading, validation, declined card, canceled payment, processing, and success states.
- [ ] Do not mark payment successful based only on the client confirmation result or redirect URL.
- [ ] Poll the transaction endpoint until Nori's webhook marks it `funded` or `awaiting_confirmation`.
- [ ] Prevent repeated clicks while confirmation is in progress.

### S4. Build the buyer meetup screen

Create:

- [ ] `components/payments/BuyerDealStatus.tsx`
- [ ] `components/payments/ConfirmationStatus.tsx`
- [ ] `components/payments/CancelDealDialog.tsx`

Display:

- [ ] **Payment secured**
- [ ] item and amount paid
- [ ] meetup time and place
- [ ] buyer confirmation state
- [ ] seller confirmation state
- [ ] seller onboarding readiness when relevant
- [ ] **Confirm deal**
- [ ] **Deal did not happen**
- [ ] warning: “Inspect and receive the item before confirming”

Behavior:

- [ ] A buyer confirmation updates only the buyer's status.
- [ ] If seller confirmation is pending, show **Waiting for seller**.
- [ ] Disable all actions in release/refund terminal paths.
- [ ] Poll for seller confirmation and transaction state changes.
- [ ] Make duplicate button submissions visually impossible.

### S5. Build the seller deal page

Create:

- [ ] `app/seller/deal/[token]/page.tsx`
- [ ] `components/seller/SellerDealStatus.tsx`
- [ ] `components/seller/SellerOnboardingCard.tsx`

Display:

- [ ] item
- [ ] agreed amount
- [ ] meetup details
- [ ] whether buyer payment is secured
- [ ] Stripe onboarding status
- [ ] buyer and seller confirmation states
- [ ] **Connect Stripe** when onboarding is incomplete
- [ ] **Confirm deal**
- [ ] **Deal did not happen**

Rules:

- [ ] Never expose buyer card, email, PaymentIntent, or private Stripe details.
- [ ] Do not allow confirmation before buyer payment is funded.
- [ ] Open the Stripe-hosted onboarding URL returned by Nori's API.
- [ ] On return from onboarding, reload status from the server.
- [ ] Explain that “Payment sent” means funds reached the seller's Stripe balance and bank payout timing may differ.

### S6. Build terminal and failure states

- [ ] Buyer completed state: **Deal complete — payment released to seller**.
- [ ] Seller completed state: **Payment sent to your Stripe balance**.
- [ ] Buyer refund state: **Full refund initiated** followed by **Refunded**.
- [ ] Seller refund state: **Deal canceled — payment will not be released**.
- [ ] Payment failure state with retry action.
- [ ] `needs_attention` state with a neutral message and safe refresh/retry behavior.
- [ ] Network error state that does not imply payment failure or success.

### S7. Add a demo handoff panel

For the hackathon only:

- [ ] After transaction creation, show a copyable seller demo link.
- [ ] Label it clearly as a seller-side demo link.
- [ ] Provide an **Open seller view** action in a new tab.
- [ ] Do not display Stripe secret identifiers.

### S8. Frontend testing

- [ ] Component test: negotiated amount formats correctly as USD.
- [ ] Component test: both confirmation states render independently.
- [ ] Component test: cancel dialog requires an explicit second click.
- [ ] Integration test: Accept & pay → checkout.
- [ ] Integration test: funded → buyer confirm → waiting for seller.
- [ ] Integration test: seller confirm → completed.
- [ ] Integration test: either party cancels → refund pending.
- [ ] Integration test: refreshing restores the active transaction.
- [ ] Verify responsive layouts for buyer and seller pages.
- [ ] Verify existing onboarding/search/negotiation paths still work.
- [ ] Run `npm run typecheck` and `npm run build`.

## Frontend Mocking Strategy

Steven can work before Nori's routes are finished by adding a temporary client-only adapter under `lib/client/` that returns the shared `PublicTransaction` shape.

Rules for the mock:

- Keep it behind one adapter interface.
- Do not add mock behavior inside production components.
- Do not simulate Stripe secret operations.
- Replace the adapter with real `fetch` calls at the first integration sync.
- Remove the mock path before the final demo build.

## Sync Points

### Sync 1 — Contract and dependencies

Nori provides:

- canonical public transaction types
- installed Stripe packages
- public Stripe publishable-key variable name
- confirmed route paths and response envelopes

Steven confirms the UI can compile against the types.

### Sync 2 — Payment

Nori provides working test-mode transaction and PaymentIntent endpoints.

Steven demonstrates:

- Accept & pay
- Stripe test checkout
- webhook-confirmed funded state

### Sync 3 — Confirmation and onboarding

Nori provides seller onboarding, confirm, cancel, transfer, and refund endpoints.

Steven demonstrates:

- separate buyer and seller views
- two-party confirmation
- cancellation/refund status

### Sync 4 — Final demo

Together verify:

- one successful transfer scenario
- one full-refund scenario
- duplicate-click safety
- refresh recovery
- seller link in a second browser window

## Definition of Done

Steven's work is complete when:

- the existing negotiation experience still works
- **Accept & pay** opens a real Stripe test checkout
- the buyer can see funded, confirmation, transfer, and refund states
- the seller can onboard and act from a separate transaction link
- both views always reflect server-authoritative state
- no sensitive Stripe data or trusted price decisions live in the browser
- the happy-path and refund demo scripts work on desktop and mobile layouts
- typecheck and production build pass

