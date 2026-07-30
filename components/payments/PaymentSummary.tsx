"use client";

// Final payment summary shown after "Accept & pay" and before the transaction
// is created. This is the last screen that reads the price from local
// negotiation state (negotiation.finalOffer.finalPrice); every screen after
// transaction creation displays the server-derived transaction.amountCents.

import { Negotiation } from "@/lib/types";
import { formatUsd } from "@/lib/client/format";

interface PaymentSummaryProps {
  negotiation: Negotiation;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

export function PaymentSummary({ negotiation, busy, onConfirm, onBack }: PaymentSummaryProps) {
  const offer = negotiation.finalOffer;
  if (!offer) return null;

  return (
    <div className="mx-auto max-w-lg px-6 animate-fadeIn">
      <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Payment</p>
      <h2 className="mt-2 text-2xl font-light tracking-tight text-ink">Review & pay</h2>

      <div className="mt-8 rounded-lg border border-line bg-paper p-6">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">Item</dt>
            <dd className="text-right font-medium text-ink">
              {offer.bikeTitle || negotiation.listing.title}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">Seller</dt>
            <dd className="text-right text-ink">{negotiation.sellerName}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">Meet</dt>
            <dd className="text-right text-ink">{offer.meetTime}</dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt className="text-ink/40">At</dt>
            <dd className="text-right text-ink">{offer.meetPlace}</dd>
          </div>
        </dl>
        <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
          <span className="text-sm text-ink/40">Agreed price</span>
          <span className="text-3xl font-light tracking-tight text-ink">
            {formatUsd(Math.round(offer.finalPrice * 100))}
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-2 rounded-lg bg-mist p-4 text-xs leading-relaxed text-ink/60">
        <p>
          Your payment is held securely and the seller is paid only after both of
          you confirm the meetup happened.
        </p>
        <p>If the meetup doesn&apos;t happen, you get a full refund.</p>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={onBack}
          disabled={busy}
          className="flex-1 rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-mist disabled:opacity-50"
        >
          Back to offers
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Continue to payment"}
        </button>
      </div>
    </div>
  );
}
