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

export type TransferStatus = "not_started" | "pending" | "complete" | "failed";
export type RefundStatus = "not_started" | "pending" | "complete" | "failed";
export type DealActor = "buyer" | "seller" | "system";

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
  transferStatus: TransferStatus;
  refundStatus: RefundStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedOffer {
  id: string;
  negotiationId: string;
  listingId: string;
  listingTitle: string;
  sellerDisplayName: string;
  amountCents: number;
  currency: "usd";
  meetTime: string;
  meetPlace: string;
  expiresAt: string;
  refundAfter: string;
  createdAt: string;
}

export interface CreateTrustedOfferInput {
  negotiationId: string;
  listingId: string;
  listingTitle: string;
  sellerDisplayName: string;
  amountCents: number;
  meetTime: string;
  meetPlace: string;
  expiresAt?: string;
  refundAfter?: string;
}

export interface TransactionCredentials {
  buyerToken: string;
  sellerToken: string;
}

export interface CreatedTransaction {
  transaction: PublicTransaction;
  credentials: TransactionCredentials;
}
