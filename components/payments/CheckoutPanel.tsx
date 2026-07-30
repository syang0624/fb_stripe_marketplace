"use client";

// Stripe checkout step. Amounts here come exclusively from the server-derived
// transaction (never local negotiation state), and a successful client
// confirmation is NOT treated as payment success — the parent switches to the
// processing view and polls until the webhook marks the transaction funded.

import { PublicTransaction } from "@/lib/client/transactionTypes";
import { formatUsd } from "@/lib/client/format";
import { PaymentForm } from "@/lib/client/paymentProvider";

interface CheckoutPanelProps {
  transaction: PublicTransaction;
  // null while the payment intent is being created/resumed on the server.
  clientSecret: string | null;
  // Card declined / previous attempt failed — shown above the form.
  errorMessage: string | null;
  onClientConfirmed: () => void;
  onFailure: (message: string) => void;
}

export function CheckoutPanel({
  transaction,
  clientSecret,
  errorMessage,
  onClientConfirmed,
  onFailure
}: CheckoutPanelProps) {
  const amountLabel = formatUsd(transaction.amountCents);

  return (
    <div className="mx-auto max-w-lg px-6 animate-fadeIn">
      <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Payment</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Secure checkout</h2>

      {/* Order summary — server-derived values only */}
      <div className="mt-8 rounded-lg bg-paper shadow-card p-6">
        <div className="flex items-baseline justify-between gap-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{transaction.listingTitle}</p>
            <p className="mt-0.5 text-xs text-ink/40">
              Seller: {transaction.sellerDisplayName}
            </p>
          </div>
          <span className="text-2xl font-semibold tracking-tight text-ink">{amountLabel}</span>
        </div>
        <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink/50">
          Held securely until both you and the seller confirm the meetup. Full
          refund if the deal doesn&apos;t happen.
        </p>
      </div>

      {errorMessage && (
        <div className="mt-4 rounded-md border border-critical/30 bg-critical/5 px-4 py-3">
          <p className="text-sm font-medium text-critical">{errorMessage}</p>
          <p className="mt-1 text-xs text-ink/50">
            You haven&apos;t been charged. Check the details and try again.
          </p>
        </div>
      )}

      <div className="mt-6 rounded-lg bg-paper shadow-card p-6">
        {clientSecret ? (
          <PaymentForm
            clientSecret={clientSecret}
            amountLabel={amountLabel}
            onClientConfirmed={onClientConfirmed}
            onFailure={onFailure}
          />
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-8">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
            <span className="ml-2 text-sm text-ink/50">Preparing checkout…</span>
          </div>
        )}
      </div>
    </div>
  );
}
