// DEMO-ONLY mock implementation of Nori's transaction API (see steven.md,
// "Frontend Mocking Strategy"). Lets the buyer/seller UI be built and demoed
// before the real routes exist.
//
// - Backed by localStorage so state survives refresh and is visible across
//   tabs (buyer tab + seller tab), mirroring a shared server.
// - Simulates asynchronous server-side transitions (webhook funding, transfer,
//   refund, Stripe onboarding) with time-based lazy transitions applied on
//   every read — the UI only ever learns state by polling, exactly as it will
//   against the real API.
// - Simulates NO Stripe secret operations: no PaymentIntents, transfers,
//   refunds, or connected accounts — only the public state machine.
//
// DELETE this module (and the mock payment form) before the final demo build.

import {
  PublicTransaction,
  TransactionState
} from "@/lib/client/transactionTypes";
import type { TransactionsApi } from "@/lib/client/transactionsApi";
import { TransactionApiError } from "@/lib/client/apiError";

const STORE_KEY = "solid.mockTxStore.v1";

// Simulated server-side latencies.
const REQUEST_LATENCY_MS = 350;
const WEBHOOK_FUNDING_DELAY_MS = 2500;
const TRANSFER_DELAY_MS = 3000;
const REFUND_DELAY_MS = 3000;
const ONBOARDING_DELAY_MS = 4000;

interface MockTxRecord {
  tx: PublicTransaction;
  negotiationId: string;
  buyerToken: string;
  sellerToken: string;
  clientSecret: string;
  // Epoch-ms deadlines for pending async transitions ("the webhook will land
  // at T"). Applied lazily by advance() on every access.
  timers: {
    fundedAt?: number;
    transferCompleteAt?: number;
    refundCompleteAt?: number;
    onboardedAt?: number;
  };
}

interface MockStore {
  transactions: Record<string, MockTxRecord>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function requireBrowser(): void {
  if (typeof window === "undefined") {
    throw new TransactionApiError("Mock transaction API is browser-only");
  }
}

function readStore(): MockStore {
  requireBrowser();
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return { transactions: {} };
  try {
    const parsed = JSON.parse(raw) as MockStore;
    if (parsed && typeof parsed.transactions === "object") return parsed;
  } catch {
    // corrupted store — start fresh
  }
  return { transactions: {} };
}

function writeStore(store: MockStore): void {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function touch(tx: PublicTransaction): void {
  tx.updatedAt = new Date().toISOString();
}

// Apply any time-based transitions that "the server" would have performed
// since the last read (webhook funding, transfer settlement, refund
// settlement, onboarding completion).
function advance(rec: MockTxRecord): void {
  const now = Date.now();
  const tx = rec.tx;

  if (rec.timers.onboardedAt !== undefined && now >= rec.timers.onboardedAt) {
    if (!tx.sellerOnboardingComplete) {
      tx.sellerOnboardingComplete = true;
      touch(tx);
    }
    delete rec.timers.onboardedAt;
  }

  if (
    tx.state === "payment_pending" &&
    rec.timers.fundedAt !== undefined &&
    now >= rec.timers.fundedAt
  ) {
    tx.state = "funded";
    touch(tx);
    delete rec.timers.fundedAt;
  }

  if (tx.state === "release_queued") {
    // Transfer can only start once the seller has a connected account.
    if (tx.sellerOnboardingComplete && tx.transferStatus === "not_started") {
      tx.transferStatus = "pending";
      rec.timers.transferCompleteAt = now + TRANSFER_DELAY_MS;
      touch(tx);
    }
    if (
      tx.transferStatus === "pending" &&
      rec.timers.transferCompleteAt !== undefined &&
      now >= rec.timers.transferCompleteAt
    ) {
      tx.transferStatus = "complete";
      tx.state = "paid_to_seller";
      touch(tx);
      delete rec.timers.transferCompleteAt;
    }
  }

  if (
    tx.state === "refund_queued" &&
    rec.timers.refundCompleteAt !== undefined &&
    now >= rec.timers.refundCompleteAt
  ) {
    tx.refundStatus = "complete";
    tx.state = "refunded";
    touch(tx);
    delete rec.timers.refundCompleteAt;
  }
}

// Load a record, apply lazy transitions, run `mutate`, persist, and return a
// snapshot of the public transaction.
async function withRecord(
  find: (store: MockStore) => MockTxRecord | undefined,
  mutate?: (rec: MockTxRecord) => void
): Promise<MockTxRecord> {
  requireBrowser();
  await sleep(REQUEST_LATENCY_MS);
  const store = readStore();
  const rec = find(store);
  if (!rec) throw new TransactionApiError("Transaction not found", 404);
  advance(rec);
  if (mutate) mutate(rec);
  writeStore(store);
  // Snapshot so callers can't mutate the "server" copy through the reference.
  return JSON.parse(JSON.stringify(rec)) as MockTxRecord;
}

function byId(id: string) {
  return (store: MockStore) => store.transactions[id];
}

function byBuyer(id: string, token: string) {
  return (store: MockStore) => {
    const rec = store.transactions[id];
    return rec && rec.buyerToken === token ? rec : undefined;
  };
}

function bySellerToken(token: string) {
  return (store: MockStore) =>
    Object.values(store.transactions).find((r) => r.sellerToken === token);
}

function byClientSecret(secret: string) {
  return (store: MockStore) =>
    Object.values(store.transactions).find((r) => r.clientSecret === secret);
}

function assertState(
  tx: PublicTransaction,
  allowed: TransactionState[],
  action: string
): void {
  if (!allowed.includes(tx.state)) {
    throw new TransactionApiError(
      `Cannot ${action} while the transaction is "${tx.state}"`,
      409
    );
  }
}

function maybeQueueRelease(tx: PublicTransaction): void {
  if (tx.buyerConfirmedAt && tx.sellerConfirmedAt) {
    tx.state = "release_queued";
  } else if (tx.state === "funded") {
    tx.state = "awaiting_confirmation";
  }
}

export const mockTransactionsApi: TransactionsApi = {
  async createTransaction(negotiationId, mockSeed) {
    requireBrowser();
    if (!mockSeed) {
      throw new TransactionApiError(
        "Mock adapter needs a MockTransactionSeed (the real server derives these fields itself)"
      );
    }
    await sleep(REQUEST_LATENCY_MS);
    const store = readStore();
    const id = randomToken("tx");
    const buyerToken = randomToken("buyer");
    const sellerToken = randomToken("seller");
    const nowIso = new Date().toISOString();
    const rec: MockTxRecord = {
      negotiationId,
      buyerToken,
      sellerToken,
      clientSecret: randomToken("mock_pi_secret"),
      timers: {},
      tx: {
        id,
        listingTitle: mockSeed.listingTitle,
        sellerDisplayName: mockSeed.sellerDisplayName,
        amountCents: mockSeed.amountCents,
        currency: "usd",
        meetTime: mockSeed.meetTime,
        meetPlace: mockSeed.meetPlace,
        state: "draft",
        buyerConfirmedAt: null,
        sellerConfirmedAt: null,
        sellerOnboardingComplete: false,
        transferStatus: "not_started",
        refundStatus: "not_started",
        createdAt: nowIso,
        updatedAt: nowIso
      }
    };
    store.transactions[id] = rec;
    writeStore(store);
    return {
      transaction: JSON.parse(JSON.stringify(rec.tx)) as PublicTransaction,
      buyerToken,
      sellerUrl: `/seller/deal/${sellerToken}`
    };
  },

  async createPaymentIntent(transactionId, _buyerToken) {
    const rec = await withRecord(byId(transactionId), (r) => {
      assertState(
        r.tx,
        ["draft", "payment_pending", "payment_failed"],
        "start checkout"
      );
      if (r.tx.state === "payment_failed") {
        // Resuming after a decline gets a fresh attempt.
        r.tx.state = "draft";
        touch(r.tx);
      }
    });
    return { clientSecret: rec.clientSecret, transaction: rec.tx };
  },

  async getTransaction(transactionId, buyerToken) {
    const rec = await withRecord(byBuyer(transactionId, buyerToken));
    return { transaction: rec.tx };
  },

  async confirmTransaction(transactionId, buyerToken) {
    const rec = await withRecord(byBuyer(transactionId, buyerToken), (r) => {
      assertState(r.tx, ["funded", "awaiting_confirmation"], "confirm");
      if (!r.tx.buyerConfirmedAt) {
        r.tx.buyerConfirmedAt = new Date().toISOString();
        maybeQueueRelease(r.tx);
        touch(r.tx);
      }
    });
    return { transaction: rec.tx };
  },

  async cancelTransaction(transactionId, buyerToken) {
    const rec = await withRecord(byBuyer(transactionId, buyerToken), (r) =>
      cancelDeal(r)
    );
    return { transaction: rec.tx };
  },

  async getSellerDeal(sellerToken) {
    const rec = await withRecord(bySellerToken(sellerToken));
    return { transaction: rec.tx };
  },

  async startSellerOnboarding(sellerToken) {
    const rec = await withRecord(bySellerToken(sellerToken), (r) => {
      if (!r.tx.sellerOnboardingComplete && r.timers.onboardedAt === undefined) {
        // Simulates the seller completing the Stripe-hosted flow shortly after
        // opening it; polling picks up the completed status.
        r.timers.onboardedAt = Date.now() + ONBOARDING_DELAY_MS;
      }
    });
    // The real API returns a Stripe-hosted onboarding URL. The mock returns
    // the seller deal page itself so "open in new tab" stays harmless.
    return { url: `/seller/deal/${rec.sellerToken}#stripe-onboarding-demo` };
  },

  async sellerConfirm(sellerToken) {
    const rec = await withRecord(bySellerToken(sellerToken), (r) => {
      assertState(r.tx, ["funded", "awaiting_confirmation"], "confirm");
      if (!r.tx.sellerConfirmedAt) {
        r.tx.sellerConfirmedAt = new Date().toISOString();
        maybeQueueRelease(r.tx);
        touch(r.tx);
      }
    });
    return { transaction: rec.tx };
  },

  async sellerCancel(sellerToken) {
    const rec = await withRecord(bySellerToken(sellerToken), (r) => cancelDeal(r));
    return { transaction: rec.tx };
  }
};

function cancelDeal(rec: MockTxRecord): void {
  const tx = rec.tx;
  assertState(
    tx,
    ["draft", "payment_pending", "payment_failed", "funded", "awaiting_confirmation"],
    "cancel"
  );
  if (tx.state === "draft" || tx.state === "payment_failed") {
    // Nothing was charged — no refund needed.
    tx.state = "canceled";
  } else {
    tx.state = "refund_queued";
    tx.refundStatus = "pending";
    rec.timers.refundCompleteAt = Date.now() + REFUND_DELAY_MS;
    delete rec.timers.fundedAt;
  }
  touch(tx);
}

// ---------------------------------------------------------------------------
// Mock client-side payment confirmation — stands in for Stripe.js
// `confirmPayment`. Used ONLY by the mock payment form; deleted along with it
// when Stripe Elements lands.
// ---------------------------------------------------------------------------

const DECLINE_SUFFIX = "0002"; // mirrors Stripe's 4000 0000 0000 0002 test card

export async function mockConfirmCardPayment(
  clientSecret: string,
  card: { cardNumber: string }
): Promise<void> {
  const digits = card.cardNumber.replace(/\D/g, "");
  if (digits.length !== 16) {
    throw new TransactionApiError("Enter a valid 16-digit card number");
  }
  await sleep(900); // simulated confirmation round-trip
  if (digits.endsWith(DECLINE_SUFFIX)) {
    await withRecord(byClientSecret(clientSecret), (r) => {
      assertState(r.tx, ["draft", "payment_failed"], "pay");
      r.tx.state = "payment_failed";
      touch(r.tx);
    });
    throw new TransactionApiError("Your card was declined.", 402);
  }
  await withRecord(byClientSecret(clientSecret), (r) => {
    assertState(r.tx, ["draft", "payment_failed"], "pay");
    // Client confirmation succeeded; the "webhook" marks it funded shortly.
    r.tx.state = "payment_pending";
    r.timers.fundedAt = Date.now() + WEBHOOK_FUNDING_DELAY_MS;
    touch(r.tx);
  });
}
