// TEMPORARY mirror of the shared transaction contract from STRIPE-CONNECT-PRD /
// steven.md. Nori owns the canonical `PublicTransaction` type; once it lands in
// the repo (Sync 1), delete these local declarations and re-export from Nori's
// module so the frontend never drifts from the server shape.

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

// Pointer persisted in localStorage so a refresh can restore the active flow.
// Only the id + buyer token are stored — never amounts or Stripe secrets.
export interface ActiveTransactionRef {
  transactionId: string;
  buyerToken: string;
  sellerUrl: string;
}

// States where nothing further can happen and polling may stop.
export const TERMINAL_STATES: readonly TransactionState[] = [
  "paid_to_seller",
  "refunded",
  "canceled"
];

export function isTerminalState(state: TransactionState): boolean {
  return TERMINAL_STATES.includes(state);
}

// States in which the buyer's payment is secured in escrow.
export function isFunded(state: TransactionState): boolean {
  return (
    state === "funded" ||
    state === "awaiting_confirmation" ||
    state === "release_queued" ||
    state === "paid_to_seller"
  );
}
