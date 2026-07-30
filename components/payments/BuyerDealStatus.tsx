"use client";

// Buyer meetup screen — shown while the payment is secured and the deal is
// waiting on confirmations (funded / awaiting_confirmation / release_queued).
// All displayed values come from the server transaction; actions are disabled
// the moment a terminal path (release or refund) begins.

import { PublicTransaction } from "@/lib/client/transactionTypes";
import { formatUsd } from "@/lib/client/format";
import { ConfirmationStatus } from "@/components/payments/ConfirmationStatus";

interface BuyerDealStatusProps {
  transaction: PublicTransaction;
  confirming: boolean;
  canceling: boolean;
  onConfirm: () => void;
  onCancelRequest: () => void;
}

export function BuyerDealStatus({
  transaction,
  confirming,
  canceling,
  onConfirm,
  onCancelRequest
}: BuyerDealStatusProps) {
  const releasing = transaction.state === "release_queued";
  const buyerConfirmed = transaction.buyerConfirmedAt !== null;
  const sellerConfirmed = transaction.sellerConfirmedAt !== null;
  // Once release is queued (or a refund starts) no further action is possible.
  const actionsLocked = releasing || confirming || canceling;

  return (
    <div className="mx-auto max-w-lg px-6 animate-fadeIn">
      <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-widest text-positive">
        <span className="h-1.5 w-1.5 rounded-full bg-positive" />
        Payment secured
      </p>
      <h2 className="mt-3 text-center text-xl font-light tracking-tight text-ink">
        {transaction.listingTitle}
      </h2>
      <p className="mt-2 text-center text-3xl font-light tracking-tight text-ink">
        {formatUsd(transaction.amountCents)}
      </p>
      <p className="mt-1 text-center text-xs text-ink/40">
        paid — held until both sides confirm
      </p>

      <div className="mt-8 rounded-lg border border-line bg-paper p-6">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">Seller</dt>
            <dd className="text-right text-ink">{transaction.sellerDisplayName}</dd>
          </div>
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
            perspective="buyer"
          />
        </div>

        {!transaction.sellerOnboardingComplete && (
          <p className="mt-4 text-xs leading-relaxed text-ink/50">
            The seller is still setting up payouts with Stripe. Your side isn&apos;t
            affected — payment stays secured either way.
          </p>
        )}
      </div>

      {releasing ? (
        <div className="mt-6 rounded-lg bg-mist p-4 text-center">
          <p className="text-sm font-medium text-ink">
            Both sides confirmed — releasing payment to the seller…
          </p>
        </div>
      ) : (
        <>
          <p className="mt-6 rounded-md border border-line bg-mist/60 px-4 py-3 text-center text-xs font-medium text-ink/60">
            Inspect and receive the item before confirming.
          </p>

          {buyerConfirmed && !sellerConfirmed && (
            <p className="mt-4 text-center text-sm text-ink/50">Waiting for seller…</p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={onConfirm}
              disabled={actionsLocked || buyerConfirmed}
              className="flex-1 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? "Confirming…" : buyerConfirmed ? "You confirmed" : "Confirm deal"}
            </button>
            <button
              onClick={onCancelRequest}
              disabled={actionsLocked}
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
