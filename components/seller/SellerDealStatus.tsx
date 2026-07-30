"use client";

// Seller-side deal view. Shows only the public transaction shape — never
// buyer card details, email, PaymentIntent ids, or any private Stripe data
// (PublicTransaction contains none of these by design).

import {
  PublicTransaction,
  isFunded
} from "@/lib/client/transactionTypes";
import { formatUsd } from "@/lib/client/format";
import { ConfirmationStatus } from "@/components/payments/ConfirmationStatus";
import { SellerOnboardingCard } from "@/components/seller/SellerOnboardingCard";

interface SellerDealStatusProps {
  transaction: PublicTransaction;
  confirming: boolean;
  canceling: boolean;
  onboardingBusy: boolean;
  onConfirm: () => void;
  onCancelRequest: () => void;
  onStartOnboarding: () => void;
}

export function SellerDealStatus({
  transaction,
  confirming,
  canceling,
  onboardingBusy,
  onConfirm,
  onCancelRequest,
  onStartOnboarding
}: SellerDealStatusProps) {
  const amountLabel = formatUsd(transaction.amountCents);
  const funded = isFunded(transaction.state);
  const releasing = transaction.state === "release_queued";
  const paid = transaction.state === "paid_to_seller";
  const refunding =
    transaction.state === "refund_queued" ||
    transaction.state === "refunded" ||
    transaction.state === "canceled";
  const needsAttention = transaction.state === "needs_attention";
  const sellerConfirmed = transaction.sellerConfirmedAt !== null;
  const actionsLocked =
    releasing || paid || refunding || needsAttention || confirming || canceling;

  return (
    <div className="animate-fadeIn">
      {/* Payment security indicator */}
      {paid ? (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-widest text-positive">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Payment sent
        </p>
      ) : refunding ? (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-widest text-critical">
          <span className="h-1.5 w-1.5 rounded-full bg-critical" />
          Deal canceled
        </p>
      ) : funded ? (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-widest text-positive">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Buyer payment secured
        </p>
      ) : (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-widest text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/25 animate-pulseDot" />
          Waiting for buyer payment
        </p>
      )}

      <h2 className="mt-3 text-center text-xl font-light tracking-tight text-ink">
        {transaction.listingTitle}
      </h2>
      <p className="mt-2 text-center text-3xl font-light tracking-tight text-ink">
        {amountLabel}
      </p>

      {/* Terminal messages */}
      {paid && (
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-ink/60">
          Payment sent to your Stripe balance. &ldquo;Sent&rdquo; means the funds
          reached your Stripe account — the payout to your bank follows Stripe&apos;s
          normal payout schedule and may take a bit longer.
        </p>
      )}
      {refunding && (
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-ink/60">
          Deal canceled — the payment will not be released and the buyer is being
          fully refunded.
        </p>
      )}
      {needsAttention && (
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-ink/60">
          This deal needs a manual look. Nothing is lost — check back shortly or
          refresh for the latest status.
        </p>
      )}

      {/* Meetup details */}
      <div className="mt-8 rounded-lg border border-line bg-paper p-6">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">Meet</dt>
            <dd className="text-right text-ink">{transaction.meetTime}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">At</dt>
            <dd className="text-right text-ink">{transaction.meetPlace}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-ink/40">
            Confirmations
          </p>
          <ConfirmationStatus
            buyerConfirmedAt={transaction.buyerConfirmedAt}
            sellerConfirmedAt={transaction.sellerConfirmedAt}
            perspective="seller"
          />
        </div>
      </div>

      {/* Stripe onboarding */}
      {!paid && !refunding && (
        <div className="mt-6">
          <SellerOnboardingCard
            onboardingComplete={transaction.sellerOnboardingComplete}
            busy={onboardingBusy}
            onStartOnboarding={onStartOnboarding}
          />
        </div>
      )}

      {/* Actions */}
      {releasing && (
        <div className="mt-6 rounded-lg bg-mist p-4 text-center">
          <p className="text-sm font-medium text-ink">
            Both sides confirmed — payment is on its way to your Stripe balance…
          </p>
          {!transaction.sellerOnboardingComplete && (
            <p className="mt-1 text-xs text-ink/50">
              Finish Stripe onboarding above to receive it.
            </p>
          )}
        </div>
      )}

      {!releasing && !paid && !refunding && !needsAttention && (
        <>
          {!funded && (
            <p className="mt-6 text-center text-xs text-ink/50">
              You can confirm the deal once the buyer&apos;s payment is secured.
            </p>
          )}
          {funded && sellerConfirmed && !transaction.buyerConfirmedAt && (
            <p className="mt-6 text-center text-sm text-ink/50">Waiting for buyer…</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={onConfirm}
              disabled={actionsLocked || !funded || sellerConfirmed}
              className="flex-1 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? "Confirming…" : sellerConfirmed ? "You confirmed" : "Confirm deal"}
            </button>
            <button
              onClick={onCancelRequest}
              disabled={actionsLocked || !funded}
              className="flex-1 rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink/60 transition-colors hover:text-critical disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deal did not happen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
