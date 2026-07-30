"use client";

// Seller deal page, reached via the unguessable tokenized link created with
// the transaction. Fully server-driven: every render reflects the latest
// polled transaction, and each mutation response replaces the local copy.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PublicTransaction } from "@/lib/client/transactionTypes";
import { formatUsd } from "@/lib/client/format";
import { transactionsApi } from "@/lib/client/transactionsApi";
import { useTransactionPolling } from "@/lib/client/useTransactionPolling";
import { SellerDealStatus } from "@/components/seller/SellerDealStatus";
import { CancelDealDialog } from "@/components/payments/CancelDealDialog";

export default function SellerDealPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const fetcher = useCallback(
    () => transactionsApi.getSellerDeal(token).then((r) => r.transaction),
    [token]
  );
  const polling = useTransactionPolling(token ? fetcher : null);

  // Latest transaction wins, whether it came from polling or a mutation.
  const [mutated, setMutated] = useState<PublicTransaction | null>(null);
  const transaction = pickLatest(polling.transaction, mutated);

  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reload status when the tab regains focus — e.g. returning from the
  // Stripe-hosted onboarding flow.
  useEffect(() => {
    const onFocus = () => polling.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [polling]);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    setActionError(null);
    try {
      const res = await transactionsApi.sellerConfirm(token);
      setMutated(res.transaction);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not confirm");
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (canceling) return;
    setCanceling(true);
    setActionError(null);
    try {
      const res = await transactionsApi.sellerCancel(token);
      setMutated(res.transaction);
      setCancelOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not cancel");
      setCancelOpen(false);
    } finally {
      setCanceling(false);
    }
  };

  const handleStartOnboarding = async () => {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setActionError(null);
    try {
      const { url } = await transactionsApi.startSellerOnboarding(token);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not start onboarding"
      );
    } finally {
      setOnboardingBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-base font-semibold tracking-tight text-ink">SOLID</span>
          <span className="text-xs font-medium uppercase tracking-widest text-ink/40">
            Seller view
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-6 py-10">
        {polling.networkIssue && (
          <p className="mb-6 rounded-md border border-line bg-mist px-4 py-2.5 text-center text-xs text-ink/60">
            Connection issue — retrying. This says nothing about the deal itself;
            the status below is the last one confirmed by the server.
          </p>
        )}

        {actionError && (
          <p className="mb-6 rounded-md border border-critical/30 bg-critical/5 px-4 py-2.5 text-center text-xs font-medium text-critical">
            {actionError}
          </p>
        )}

        {transaction ? (
          <>
            <SellerDealStatus
              transaction={transaction}
              confirming={confirming}
              canceling={canceling}
              onboardingBusy={onboardingBusy}
              onConfirm={handleConfirm}
              onCancelRequest={() => setCancelOpen(true)}
              onStartOnboarding={handleStartOnboarding}
            />
            {cancelOpen && (
              <CancelDealDialog
                amountLabel={formatUsd(transaction.amountCents)}
                perspective="seller"
                busy={canceling}
                onConfirm={handleCancel}
                onClose={() => setCancelOpen(false)}
              />
            )}
          </>
        ) : polling.apiError ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-medium text-ink">Deal not found</h2>
            <p className="mt-2 text-sm text-ink/50">
              This link may be invalid or expired. Check the link you received.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 py-16">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot"
                style={{ animationDelay: `${i * 0.18}s` }}
              />
            ))}
            <span className="ml-2 text-sm text-ink/50">Loading deal…</span>
          </div>
        )}
      </div>
    </main>
  );
}

function pickLatest(
  a: PublicTransaction | null,
  b: PublicTransaction | null
): PublicTransaction | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.updatedAt).getTime() >= new Date(b.updatedAt).getTime() ? a : b;
}
