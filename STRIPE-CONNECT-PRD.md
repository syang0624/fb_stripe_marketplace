# PRD: Trusted Meetup Payments with Stripe Connect

**Product:** SOLID  
**Status:** Hackathon MVP specification  
**Currency:** USD only  
**Payment provider:** Stripe, in test mode for the demo  
**Last updated:** July 30, 2026

## 1. Summary

SOLID currently searches Facebook Marketplace, ranks listings, simulates buyer-side AI negotiations, and ends when the buyer accepts a final offer. This feature extends that flow into a trusted meetup payment:

1. The buyer-side AI agent and seller agree on a final price during negotiation.
2. The buyer accepts the final offer and pays that exact price before the meetup.
3. SOLID keeps the payment on the platform's Stripe balance and does not transfer it to the seller yet.
4. At the meetup, both buyer and seller select **Confirm deal**.
5. When both confirmations are recorded, SOLID transfers the agreed amount to the seller's connected Stripe account.
6. If either party selects **Deal did not happen**, SOLID immediately initiates a full refund to the buyer and does not pay the seller.

For the hackathon, this is a trusted payment-release flow built with Stripe Connect. It must not be marketed as legal escrow.

## 2. Existing Product Context

The current Next.js application has five client-side steps:

`Profile → Search → Deals → Negotiate → Review`

The negotiation system produces a `FinalOffer` containing:

- listing ID and item title
- seller name
- negotiated final price
- meetup time and place
- extras and notes

On the Review screen, the buyer can currently **Accept**, **Modify**, or **Decline**. Selecting **Accept** only sets local React state and displays a static "Deal accepted" screen. There is currently:

- no Stripe dependency
- no payment or seller payout flow
- no seller-side experience
- no user authentication
- no database or durable transaction state
- no webhook processing

The payment feature must preserve the existing search and negotiation experience and replace the current post-Accept dead end.

## 3. Problem

Buyers and individual sellers arranging an in-person exchange lack a trusted way to:

- lock in the AI-negotiated price before meeting
- show the seller that the buyer has paid
- prevent seller payment until the physical exchange succeeds
- automatically return the buyer's money if the exchange does not happen

The current product can negotiate a deal but cannot complete it.

## 4. Product Goal

Enable a credible end-to-end hackathon demo in which a negotiated physical-goods deal becomes a funded transaction, remains unreleased until the meetup succeeds, and is then either paid to the seller or refunded to the buyer.

### Success criteria

- The checkout amount always equals the accepted AI-negotiated final price.
- A successful Stripe test payment moves the transaction into a funded state.
- No seller transfer is created before both parties confirm.
- Two confirmations create exactly one transfer to the intended seller.
- A cancellation creates exactly one full refund and no seller transfer.
- Refreshing or retrying does not create duplicate charges, transfers, or refunds.
- The UI clearly shows who has confirmed and what happens next.

## 5. Non-goals

The hackathon MVP does not need to support:

- production launch or live-mode readiness
- legal escrow positioning
- platform fees or commissions
- partial payments, deposits, tips, taxes, shipping, or installments
- non-USD currencies
- business sellers
- chargebacks, evidence submission, or negative-balance recovery
- arbitration, evidence review, or manual dispute resolution
- prohibited-item enforcement or category-specific compliance
- multiple sellers in one checkout
- partial refunds
- changing the price after payment
- real Facebook account or messaging integration

## 6. Users

### Buyer

An individual using SOLID's AI agent to find and negotiate for a physical item. The buyer pays before the meetup and confirms only after receiving and inspecting the item.

### Seller

An individual seller represented by the existing simulated seller during the demo. The seller receives a demo transaction link, completes Stripe Connect onboarding, and confirms after handing over the item.

### Platform

SOLID accepts the buyer's payment, holds the funds in its platform Stripe balance, and decides whether to create a seller transfer or buyer refund based on the transaction state.

## 7. Core User Flow

### 7.1 Negotiate and accept

1. The existing AI negotiation reaches `final_offer`.
2. The Review screen displays the final price, item, meetup time, and meetup place.
3. The buyer selects **Accept & pay**.
4. SOLID creates a durable transaction snapshot from the final offer.
5. The price, listing, buyer, and seller references become immutable for that transaction.

The accepted price must come from `negotiation.finalOffer.finalPrice`, represented server-side as integer cents. The browser must never be trusted to supply an arbitrary payable amount.

### 7.2 Buyer payment

1. SOLID creates a Stripe PaymentIntent on the platform account for the immutable transaction amount.
2. The buyer completes payment using Stripe's web payment UI.
3. The UI displays payment processing until a verified Stripe webhook marks the payment successful.
4. After success, the transaction displays **Payment secured — waiting for meetup**.

Payment must be captured before the meetup. Card authorization without capture is not the primary design because meetup timing can exceed authorization windows.

### 7.3 Seller onboarding

1. The seller opens a demo seller link tied to the transaction.
2. If the seller does not yet have a connected Stripe account, SOLID creates one for an individual seller.
3. The seller completes Stripe-hosted onboarding in Stripe test mode.
4. SOLID stores the connected account ID and monitors whether transfers/payouts are enabled.

Seller onboarding can happen before or after the buyer pays, but the seller cannot receive funds until onboarding requirements are satisfied. Stripe-hosted onboarding is preferred for the MVP because it requires the least custom compliance UI.

### 7.4 Meetup confirmation

Once the payment is funded, both transaction views show two actions:

- **Confirm deal**
- **Deal did not happen**

Rules:

- Buyer confirmation means the buyer received and accepted the physical item.
- Seller confirmation means the seller handed over the physical item.
- The UI must warn the buyer not to confirm before inspecting and receiving the item.
- The first confirmation is recorded and the UI displays which party is still pending.
- The second confirmation atomically queues seller payment.
- Confirmations are allowed only for a funded transaction.

### 7.5 Release to seller

When both parties have confirmed:

1. The server atomically changes the transaction to `release_queued`.
2. The server creates one Stripe Transfer from the platform to the seller's connected account for the full negotiated price.
3. A successful result changes the transaction to `paid_to_seller`.
4. Both parties see **Deal complete**.

No platform fee is deducted. The seller receives the full negotiated amount. SOLID absorbs Stripe processing fees in the demo.

“Paid to seller” means the transfer has reached the seller's Stripe balance. Arrival in the seller's bank account follows the connected account's payout schedule and is not necessarily immediate.

### 7.6 Cancellation and refund

If either party selects **Deal did not happen** before seller payment:

1. Show a confirmation dialog explaining that the transaction will be canceled.
2. On confirmation, atomically move the transaction to `refund_queued`.
3. Immediately create one full Stripe refund against the buyer's PaymentIntent.
4. Prevent all later confirmations and transfers.
5. Show both parties **Refund initiated** and then **Refunded** after webhook confirmation.

“Immediately refunded” means SOLID immediately submits the refund to Stripe. The UI must state that the buyer's bank may take additional time to post the funds.

For a no-show where neither party acts, the demo assumption is:

- automatically initiate a full refund 24 hours after the scheduled meetup time if both confirmations have not been received

This timeout should be configurable. A production product would need a more complete dispute and evidence policy.

## 8. State Model

### Transaction states

| State | Meaning | Allowed next states |
|---|---|---|
| `draft` | Final offer snapshotted; no PaymentIntent yet | `payment_pending`, `canceled` |
| `payment_pending` | Checkout started | `funded`, `payment_failed`, `canceled` |
| `payment_failed` | Payment did not complete | `payment_pending`, `canceled` |
| `funded` | Stripe webhook verified successful payment | `awaiting_confirmation`, `refund_queued` |
| `awaiting_confirmation` | Zero or one party has confirmed | `release_queued`, `refund_queued` |
| `release_queued` | Both confirmed; transfer creation in progress | `paid_to_seller`, `needs_attention` |
| `paid_to_seller` | Transfer created successfully | terminal |
| `refund_queued` | Cancellation won; refund creation in progress | `refunded`, `needs_attention` |
| `refunded` | Full refund confirmed | terminal |
| `canceled` | Canceled before successful payment | terminal |
| `needs_attention` | Stripe operation failed and requires safe retry | `paid_to_seller`, `refunded` |

`funded` may immediately normalize to `awaiting_confirmation` after the payment webhook is processed.

### Race-condition rule

Release and refund are mutually exclusive terminal paths. The first valid server-side transition from `awaiting_confirmation` must win inside a database transaction:

- both confirmations completed → release path
- either party canceled → refund path

A late or duplicated request must return the already-established outcome without creating another Stripe object.

## 9. Functional Requirements

### FR-1: Immutable deal snapshot

- Create a transaction from one accepted `FinalOffer`.
- Store price as USD cents.
- Copy the listing title, listing ID, seller name, meetup details, and negotiated transcript reference.
- Reject transaction creation if the negotiation is not at `final_offer`.
- Reject zero, negative, missing, or non-integer-cent amounts.
- Do not allow Modify Price or Modify Logistics after payment begins. The buyer must cancel/refund and create a new transaction instead.

### FR-2: Stripe checkout

- Create PaymentIntents only from authenticated or unguessable server-side transaction IDs.
- Read the amount from the server's transaction record.
- Use idempotency keys based on transaction ID and operation.
- Store Stripe PaymentIntent and latest Charge IDs.
- Do not mark a transaction funded from a browser redirect alone.
- Show failed, canceled, processing, and successful payment states.

### FR-3: Seller Connect account

- Create or attach one Stripe connected account per seller identity.
- Configure the seller as an individual.
- Generate a single-use Stripe-hosted onboarding link.
- Track `details_submitted`, transfer capability, and payout readiness using Stripe state/webhooks.
- Do not create a transfer to an account that is not eligible to receive it.

For the current simulated demo, a seller session is represented by an unguessable, transaction-scoped seller link. This is demo access control, not production authentication.

### FR-4: Dual confirmation

- Record buyer and seller confirmations separately with timestamps.
- Confirmation requests must be idempotent.
- Show confirmation state to both parties.
- Do not allow one party to confirm on behalf of the other.
- Queue release only after both confirmations exist.

### FR-5: Seller payment

- Use Stripe Connect separate charges and transfers.
- Create one Transfer for the full transaction amount.
- Link the transfer to the originating payment where supported.
- Store the Stripe Transfer ID.
- Handle insufficient available balance or ineligible connected-account errors without losing transaction state.
- Retry safely using the same operation idempotency key.

### FR-6: Refund

- Permit cancellation only before `paid_to_seller`.
- Create a full refund for the original PaymentIntent.
- Store the Stripe Refund ID and status.
- Disable confirmation buttons as soon as `refund_queued` wins.
- Reconcile final refund status from Stripe webhooks.
- Tell users that bank posting time is outside SOLID's control.

### FR-7: Webhooks

- Verify Stripe webhook signatures using the raw request body.
- Handle at minimum:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `refund.created`
  - `refund.updated`
  - `refund.failed`
  - `account.updated`
  - relevant transfer failure/update events supported by the chosen Stripe integration
- Persist processed Stripe event IDs so duplicate deliveries are harmless.
- Return a successful webhook response only after the event is durably recorded or safely recognized as a duplicate.

### FR-8: Recovery

- Refreshing the page restores the current transaction state.
- A processing screen polls or subscribes to the server until the webhook-confirmed state arrives.
- Server operations can be retried without duplicating money movement.
- Stripe IDs and errors are visible in server logs but secret keys and payment details are never logged.

## 10. UX Requirements

### Buyer Review screen

Replace **Accept** with **Accept & pay**.

The button opens a summary containing:

- item
- seller
- agreed price
- meetup time and place
- “Seller receives funds only after both of you confirm the exchange”
- “If the deal does not happen, SOLID initiates a full refund”

### Buyer funded screen

Replace the current static "Deal accepted" screen with:

- **Payment secured**
- amount paid
- meetup details
- buyer confirmation status
- seller confirmation status
- **Confirm deal**
- **Deal did not happen**
- warning: “Inspect and receive the item before confirming”

### Seller transaction screen

Add a transaction-scoped seller route, for example `/seller/deal/[token]`, containing:

- item and agreed price
- payment status without exposing buyer payment details
- Stripe onboarding status/action
- meetup details
- buyer confirmation status
- seller confirmation status
- **Confirm deal**
- **Deal did not happen**
- expected seller amount: full negotiated price

### Completion screens

Buyer:

- “Deal complete”
- amount released to seller

Seller:

- “Payment sent to your Stripe balance”
- amount
- note that bank payout timing depends on Stripe

### Refund screens

Both:

- “Deal canceled”

Buyer:

- “Full refund initiated”
- refund amount
- note about bank processing time

Seller:

- “Payment will not be released”

## 11. Technical Design

### Stripe model

Use **Stripe Connect with separate charges and transfers**:

1. Create and capture the buyer's charge on SOLID's platform account.
2. Keep the net funds on the platform account while awaiting meetup confirmation.
3. If both confirm, create a separate Transfer to the seller's connected account.
4. If canceled before transfer, refund the platform charge.

This model fits the delayed-release requirement better than a destination charge because the seller transfer is intentionally created later.

### Required application additions

- Stripe server SDK
- Stripe web payment client components
- server-side transaction service
- persistent database
- webhook route
- buyer payment routes/components
- seller onboarding route/components
- seller deal-confirmation route
- scheduled timeout/refund job or demo-only trigger

### Suggested Next.js routes

| Route | Method | Purpose |
|---|---|---|
| `/api/transactions` | `POST` | Snapshot accepted final offer |
| `/api/transactions/[id]` | `GET` | Read buyer-safe transaction state |
| `/api/transactions/[id]/payment-intent` | `POST` | Create/reuse PaymentIntent |
| `/api/transactions/[id]/confirm` | `POST` | Record buyer confirmation |
| `/api/transactions/[id]/cancel` | `POST` | Buyer cancellation/refund |
| `/api/seller/deals/[token]` | `GET` | Read seller-safe transaction state |
| `/api/seller/deals/[token]/confirm` | `POST` | Record seller confirmation |
| `/api/seller/deals/[token]/cancel` | `POST` | Seller cancellation/refund |
| `/api/seller/deals/[token]/onboarding` | `POST` | Create/reuse Connect onboarding link |
| `/api/stripe/webhook` | `POST` | Reconcile Stripe events |

All money-moving routes must execute on the server.

### Suggested data model

#### `transactions`

- `id`
- `public_buyer_token`
- `public_seller_token`
- `negotiation_id`
- `listing_id`
- `listing_title`
- `seller_display_name`
- `amount_cents`
- `currency` (`usd`)
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
- `created_at`
- `updated_at`

#### `stripe_events`

- `stripe_event_id` (unique)
- `event_type`
- `processed_at`
- `transaction_id`

#### `operation_attempts`

- `transaction_id`
- `operation` (`charge`, `transfer`, or `refund`)
- `idempotency_key` (unique)
- `stripe_object_id`
- `status`
- `last_error`
- timestamps

For a deployed demo, use a durable database rather than React state or an in-memory map. The specific database vendor is an implementation choice.

## 12. Security and Integrity Requirements

- Stripe secret keys are server-only environment variables.
- Webhook signing secrets are server-only.
- Never trust the amount, seller account ID, transaction state, or confirmation identity sent by the client.
- Seller and buyer tokens must be cryptographically random, unguessable, and scoped to one transaction.
- Never expose one party's private Stripe or payment details to the other.
- Use Stripe-hosted or Stripe-provided UI for sensitive payment and identity information.
- Add server-side rate limits to checkout, onboarding-link, confirmation, and cancellation endpoints.
- Add an audit log for state transitions and money-moving operations.
- Use test-mode credentials and test connected accounts in the hackathon demo.

## 13. Analytics and Demo Observability

Track:

- transaction created
- checkout started
- payment succeeded/failed
- seller onboarding started/completed
- buyer confirmed
- seller confirmed
- refund requested/completed
- seller transfer requested/completed
- operation failed/retried

The demo should include a developer/admin status panel or structured server logs showing:

- internal transaction ID and state
- Stripe PaymentIntent ID
- connected account readiness
- confirmation timestamps
- Transfer or Refund ID

## 14. Acceptance Tests

### Happy path

1. AI and seller negotiate from the existing flow.
2. Buyer accepts a `$725` final offer.
3. Checkout displays and charges exactly `$725.00 USD`.
4. Payment webhook moves the transaction to funded.
5. Seller completes test-mode Connect onboarding.
6. Buyer confirms; no transfer is created.
7. Seller confirms; one `$725.00` Transfer is created.
8. Both views show the completed state.

### Seller confirms first

1. Seller confirms.
2. No transfer is created.
3. Buyer confirms.
4. Exactly one transfer is created.

### Buyer cancels

1. Buyer pays.
2. Buyer selects **Deal did not happen**.
3. One full refund is created immediately.
4. Seller confirmation can no longer release funds.

### Seller cancels

1. Buyer pays.
2. Seller selects **Deal did not happen**.
3. One full refund is created.
4. Buyer sees the canceled/refund state.

### Confirmation/refund race

1. Buyer and seller confirmation/cancellation requests arrive concurrently.
2. The database accepts only one terminal path.
3. The transaction has either one transfer or one refund, never both.

### Duplicate delivery/retry

1. Submit confirmation twice and deliver the same webhook multiple times.
2. Only one state transition and one Stripe money movement occur.

### Payment failure

1. Stripe test card produces a failed payment.
2. The transaction is not funded.
3. Confirmation actions remain unavailable.
4. Buyer can retry checkout.

### Seller not onboarded

1. Both parties confirm before seller onboarding is complete.
2. Transaction remains safely queued and no funds are lost.
3. Seller is prompted to finish onboarding.
4. Transfer is retried only after the connected account can receive it.

## 15. Demo Script

1. Ask SOLID to find an item and show the live/fallback top listings.
2. Let the AI negotiate and reach a final price.
3. Select **Accept & pay**.
4. Complete Stripe test checkout.
5. Open the seller link in a second window.
6. Show that the buyer has paid but the seller has not been paid.
7. Confirm from one side and show that funds remain unreleased.
8. Confirm from the second side and show the Transfer ID/status.
9. Run a second deal where one party selects **Deal did not happen** and show the Refund ID/status.

## 16. Assumptions Requiring Revisit After the Hackathon

- Both parties are represented by transaction-scoped links rather than full accounts.
- Either party can trigger a full refund before release.
- A missing second confirmation results in refund 24 hours after the scheduled meetup.
- The platform absorbs Stripe processing fees.
- The platform is the merchant-facing party for the buyer charge.
- All demo activity occurs in Stripe test mode.
- Items are unregulated physical goods even though category enforcement is out of scope.

Before live launch, SOLID would need legal review, Stripe platform approval, seller/buyer authentication, prohibited-items policy, disputes and chargeback ownership, tax treatment, support operations, fraud controls, and a production-grade timeout/dispute policy.

## 17. Stripe References

- [Stripe Connect marketplace payment options](https://docs.stripe.com/connect/marketplace/tasks/accept-payment)
- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Stripe Connect onboarding options](https://docs.stripe.com/connect/onboarding)
- [Refund and cancel payments](https://docs.stripe.com/refunds)
- [Pay out to connected accounts](https://docs.stripe.com/connect/marketplace/tasks/payout)
