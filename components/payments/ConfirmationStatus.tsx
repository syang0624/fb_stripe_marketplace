"use client";

// Renders the two confirmation states independently — a buyer confirmation
// never implies anything about the seller's, and vice versa.

interface ConfirmationStatusProps {
  buyerConfirmedAt: string | null;
  sellerConfirmedAt: string | null;
  // Which side is viewing; affects the row labels only, never the states.
  perspective: "buyer" | "seller";
}

function ConfirmationRow({ label, confirmed }: { label: string; confirmed: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-ink/70">{label}</span>
      {confirmed ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-positive">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Confirmed
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/25 animate-pulseDot" />
          Waiting
        </span>
      )}
    </div>
  );
}

export function ConfirmationStatus({
  buyerConfirmedAt,
  sellerConfirmedAt,
  perspective
}: ConfirmationStatusProps) {
  const buyerLabel = perspective === "buyer" ? "You (buyer)" : "Buyer";
  const sellerLabel = perspective === "seller" ? "You (seller)" : "Seller";
  return (
    <div className="divide-y divide-line border-y border-line">
      <ConfirmationRow label={buyerLabel} confirmed={buyerConfirmedAt !== null} />
      <ConfirmationRow label={sellerLabel} confirmed={sellerConfirmedAt !== null} />
    </div>
  );
}
