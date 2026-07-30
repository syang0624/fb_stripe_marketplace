"use client";

// Confirmation dialog for "Deal did not happen". Opening the dialog is the
// first click; the destructive action always requires this explicit second
// click and is disabled while the request is in flight.

interface CancelDealDialogProps {
  amountLabel: string;
  // "buyer" copy mentions the refund destination; "seller" copy mentions that
  // the payment will not be released.
  perspective: "buyer" | "seller";
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function CancelDealDialog({
  amountLabel,
  perspective,
  busy,
  onConfirm,
  onClose
}: CancelDealDialogProps) {
  const detail =
    perspective === "buyer"
      ? `The full ${amountLabel} payment will be refunded to your original payment method. This cannot be undone.`
      : `The buyer's ${amountLabel} payment will be fully refunded and nothing will be released to you. This cannot be undone.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 animate-fadeIn">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border border-line bg-paper shadow-card">
        <div className="p-6">
          <h3 className="text-sm font-medium text-ink">Deal did not happen?</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink/60">{detail}</p>
          <div className="mt-6 flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-mist disabled:opacity-50"
            >
              Keep the deal
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex-1 rounded-md bg-critical px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-critical/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Canceling…" : "Yes, cancel & refund"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
