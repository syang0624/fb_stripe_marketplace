// Single adapter boundary between the frontend and the transaction API.
// All payment/transaction traffic goes through `transactionsApi`.

import {
  ActiveTransactionRef,
  PublicTransaction
} from "@/lib/client/transactionTypes";
import { TransactionApiError } from "@/lib/client/apiError";

export { TransactionApiError, isNetworkError } from "@/lib/client/apiError";

export interface CreateTransactionResponse {
  transaction: PublicTransaction;
  buyerToken: string;
  sellerUrl: string;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  transaction: PublicTransaction;
}

// Demo-only seed consumed exclusively by the mock adapter so it can render a
// realistic transaction without a backend. The real server derives every one of
// these fields from trusted application state; `realTransactionsApi` never
// sends this object.
export interface MockTransactionSeed {
  listingTitle: string;
  sellerDisplayName: string;
  amountCents: number;
  meetTime: string;
  meetPlace: string;
}

export interface TransactionsApi {
  createTransaction(
    negotiationId: string,
    mockSeed?: MockTransactionSeed
  ): Promise<CreateTransactionResponse>;
  createPaymentIntent(
    transactionId: string,
    buyerToken: string
  ): Promise<PaymentIntentResponse>;
  getTransaction(
    transactionId: string,
    buyerToken: string
  ): Promise<{ transaction: PublicTransaction }>;
  confirmTransaction(
    transactionId: string,
    buyerToken: string
  ): Promise<{ transaction: PublicTransaction }>;
  cancelTransaction(
    transactionId: string,
    buyerToken: string
  ): Promise<{ transaction: PublicTransaction }>;
  getSellerDeal(sellerToken: string): Promise<{ transaction: PublicTransaction }>;
  startSellerOnboarding(sellerToken: string): Promise<{ url: string }>;
  sellerConfirm(sellerToken: string): Promise<{ transaction: PublicTransaction }>;
  sellerCancel(sellerToken: string): Promise<{ transaction: PublicTransaction }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!resp.ok) {
    let message = `Request failed (${resp.status})`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new TransactionApiError(message, resp.status);
  }
  return (await resp.json()) as T;
}

export const realTransactionsApi: TransactionsApi = {
  createTransaction: (negotiationId) =>
    request("/api/transactions", {
      method: "POST",
      body: JSON.stringify({ negotiationId })
    }),
  createPaymentIntent: (transactionId, buyerToken) =>
    request(`/api/transactions/${transactionId}/payment-intent`, {
      method: "POST",
      body: JSON.stringify({ token: buyerToken })
    }),
  getTransaction: (transactionId, buyerToken) =>
    request(
      `/api/transactions/${transactionId}?token=${encodeURIComponent(buyerToken)}`
    ),
  confirmTransaction: (transactionId, buyerToken) =>
    request(`/api/transactions/${transactionId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ token: buyerToken })
    }),
  cancelTransaction: (transactionId, buyerToken) =>
    request(`/api/transactions/${transactionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ token: buyerToken })
    }),
  getSellerDeal: (sellerToken) =>
    request(`/api/seller/deals/${encodeURIComponent(sellerToken)}`),
  startSellerOnboarding: (sellerToken) =>
    request(`/api/seller/deals/${encodeURIComponent(sellerToken)}/onboarding`, {
      method: "POST"
    }),
  sellerConfirm: (sellerToken) =>
    request(`/api/seller/deals/${encodeURIComponent(sellerToken)}/confirm`, {
      method: "POST"
    }),
  sellerCancel: (sellerToken) =>
    request(`/api/seller/deals/${encodeURIComponent(sellerToken)}/cancel`, {
      method: "POST"
    })
};

export const transactionsApi: TransactionsApi = realTransactionsApi;

// ---------------------------------------------------------------------------
// Active-transaction persistence (S1: restore after refresh). Stores only the
// transaction id, buyer token, and seller link — server state stays
// authoritative and is re-fetched on load.
// ---------------------------------------------------------------------------

const ACTIVE_TX_KEY_PREFIX = "solid.activeTransaction.v3";
const LEGACY_ACTIVE_TX_KEYS = [
  "solid.activeTransaction.v1",
  "solid.activeTransaction.v2",
];

function activeTransactionKey(accountId: string): string {
  return `${ACTIVE_TX_KEY_PREFIX}:${encodeURIComponent(accountId)}`;
}

function clearLegacyActiveTransactions(): void {
  for (const key of LEGACY_ACTIVE_TX_KEYS) {
    window.localStorage.removeItem(key);
  }
}

export function saveActiveTransaction(
  accountId: string,
  ref: ActiveTransactionRef
): void {
  if (typeof window === "undefined") return;
  clearLegacyActiveTransactions();
  window.localStorage.setItem(activeTransactionKey(accountId), JSON.stringify(ref));
}

export function loadActiveTransaction(accountId: string): ActiveTransactionRef | null {
  if (typeof window === "undefined") return null;
  clearLegacyActiveTransactions();
  const key = activeTransactionKey(accountId);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveTransactionRef>;
    if (parsed.transactionId && parsed.buyerToken && parsed.sellerUrl) {
      return parsed as ActiveTransactionRef;
    }
  } catch {
    // corrupted pointer — treat as absent
  }
  window.localStorage.removeItem(key);
  return null;
}

export function clearActiveTransaction(accountId: string): void {
  if (typeof window === "undefined") return;
  clearLegacyActiveTransactions();
  window.localStorage.removeItem(activeTransactionKey(accountId));
}
