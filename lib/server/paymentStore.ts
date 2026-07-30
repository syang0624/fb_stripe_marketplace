import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  CreateTrustedOfferInput,
  CreatedTransaction,
  DealActor,
  PublicTransaction,
  RefundStatus,
  TransactionState,
  TransferStatus,
  TrustedOffer,
} from "@/lib/paymentTypes";
import { dealToken, hashToken, verifyToken } from "@/lib/server/authTokens";
import { PaymentError } from "@/lib/server/paymentErrors";

interface TransactionRow {
  id: string;
  buyer_token_hash: string;
  seller_token_hash: string;
  offer_id: string;
  negotiation_id: string;
  listing_id: string;
  listing_title: string;
  seller_display_name: string;
  amount_cents: number;
  currency: "usd";
  meet_time: string;
  meet_place: string;
  refund_after: string;
  state: TransactionState;
  buyer_confirmed_at: string | null;
  seller_confirmed_at: string | null;
  cancel_requested_by: string | null;
  cancel_requested_at: string | null;
  seller_onboarding_complete: number;
  transfer_status: TransferStatus;
  refund_status: RefundStatus;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_connected_account_id: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface OfferRow {
  id: string;
  negotiation_id: string;
  listing_id: string;
  listing_title: string;
  seller_display_name: string;
  amount_cents: number;
  currency: "usd";
  meet_time: string;
  meet_place: string;
  expires_at: string;
  refund_after: string;
  consumed_transaction_id: string | null;
  created_at: string;
}

export interface InternalTransaction extends PublicTransaction {
  offerId: string;
  negotiationId: string;
  listingId: string;
  refundAfter: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeConnectedAccountId: string | null;
  stripeTransferId: string | null;
  stripeRefundId: string | null;
  lastErrorCode: string | null;
}

export interface ConfirmResult {
  transaction: InternalTransaction;
  shouldRelease: boolean;
}

export interface CancelResult {
  transaction: InternalTransaction;
  shouldCancelPaymentIntent: boolean;
  shouldRefund: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultDbPath(): string {
  return process.env.PAYMENTS_DB_PATH || resolve(process.cwd(), ".data/solid-payments.sqlite");
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function requireText(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new PaymentError("INVALID_OFFER", `${field} is required.`);
  return result;
}

function parseFutureDate(value: string | undefined, fallback: string, field: string): string {
  const result = value ?? fallback;
  const timestamp = Date.parse(result);
  if (!Number.isFinite(timestamp)) {
    throw new PaymentError("INVALID_OFFER", `${field} must be a valid date.`);
  }
  return new Date(timestamp).toISOString();
}

export class PaymentStore {
  private readonly db: DatabaseSync;

  constructor(path = defaultDbPath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trusted_offers (
        id TEXT PRIMARY KEY,
        negotiation_id TEXT NOT NULL UNIQUE,
        listing_id TEXT NOT NULL,
        listing_title TEXT NOT NULL,
        seller_display_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 50),
        currency TEXT NOT NULL CHECK (currency = 'usd'),
        meet_time TEXT NOT NULL,
        meet_place TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        refund_after TEXT NOT NULL,
        consumed_transaction_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        buyer_token_hash TEXT NOT NULL,
        seller_token_hash TEXT NOT NULL,
        offer_id TEXT NOT NULL UNIQUE REFERENCES trusted_offers(id),
        negotiation_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        listing_title TEXT NOT NULL,
        seller_display_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 50),
        currency TEXT NOT NULL CHECK (currency = 'usd'),
        meet_time TEXT NOT NULL,
        meet_place TEXT NOT NULL,
        refund_after TEXT NOT NULL,
        state TEXT NOT NULL,
        buyer_confirmed_at TEXT,
        seller_confirmed_at TEXT,
        cancel_requested_by TEXT,
        cancel_requested_at TEXT,
        seller_onboarding_complete INTEGER NOT NULL DEFAULT 0,
        transfer_status TEXT NOT NULL DEFAULT 'not_started',
        refund_status TEXT NOT NULL DEFAULT 'not_started',
        stripe_payment_intent_id TEXT UNIQUE,
        stripe_charge_id TEXT,
        stripe_connected_account_id TEXT,
        stripe_transfer_id TEXT UNIQUE,
        stripe_refund_id TEXT UNIQUE,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_payment_intent
        ON transactions(stripe_payment_intent_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_connected_account
        ON transactions(stripe_connected_account_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_refund_after
        ON transactions(refund_after, state);

      CREATE TABLE IF NOT EXISTS stripe_events (
        stripe_event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        transaction_id TEXT,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operation_attempts (
        transaction_id TEXT NOT NULL REFERENCES transactions(id),
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        stripe_object_id TEXT,
        status TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (transaction_id, operation)
      );

      CREATE TABLE IF NOT EXISTS transaction_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL REFERENCES transactions(id),
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createTrustedOffer(input: CreateTrustedOfferInput): TrustedOffer {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 50) {
      throw new PaymentError(
        "INVALID_OFFER",
        "The final price must be at least $0.50 and use whole cents."
      );
    }

    const createdAt = nowIso();
    const expiresAt = parseFutureDate(
      input.expiresAt,
      addHours(createdAt, 2),
      "expiresAt"
    );
    const refundAfter = parseFutureDate(
      input.refundAfter,
      addHours(createdAt, 48),
      "refundAfter"
    );
    if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
      throw new PaymentError("INVALID_OFFER", "The offer expiration must be in the future.");
    }
    if (Date.parse(refundAfter) <= Date.parse(createdAt)) {
      throw new PaymentError("INVALID_OFFER", "The refund deadline must be in the future.");
    }

    const normalized = {
      id: randomUUID(),
      negotiationId: requireText(input.negotiationId, "negotiationId"),
      listingId: requireText(input.listingId, "listingId"),
      listingTitle: requireText(input.listingTitle, "listingTitle"),
      sellerDisplayName: requireText(input.sellerDisplayName, "sellerDisplayName"),
      amountCents: input.amountCents,
      meetTime: requireText(input.meetTime, "meetTime"),
      meetPlace: requireText(input.meetPlace, "meetPlace"),
      expiresAt,
      refundAfter,
      createdAt,
    };

    return this.transaction(() => {
      const existing = this.findOfferByNegotiationId(normalized.negotiationId);
      if (existing) {
        const sameOffer =
          existing.listingId === normalized.listingId &&
          existing.amountCents === normalized.amountCents &&
          existing.meetTime === normalized.meetTime &&
          existing.meetPlace === normalized.meetPlace;
        if (!sameOffer) {
          throw new PaymentError(
            "INVALID_OFFER",
            "A different final offer already exists for this negotiation."
          );
        }
        return existing;
      }

      this.db
        .prepare(
          `INSERT INTO trusted_offers (
            id, negotiation_id, listing_id, listing_title, seller_display_name,
            amount_cents, currency, meet_time, meet_place, expires_at,
            refund_after, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?)`
        )
        .run(
          normalized.id,
          normalized.negotiationId,
          normalized.listingId,
          normalized.listingTitle,
          normalized.sellerDisplayName,
          normalized.amountCents,
          normalized.meetTime,
          normalized.meetPlace,
          normalized.expiresAt,
          normalized.refundAfter,
          normalized.createdAt
        );
      return { ...normalized, currency: "usd" as const };
    });
  }

  findOfferByNegotiationId(negotiationId: string): TrustedOffer | null {
    const row = this.db
      .prepare("SELECT * FROM trusted_offers WHERE negotiation_id = ?")
      .get(negotiationId) as unknown as OfferRow | undefined;
    return row ? this.offerFromRow(row) : null;
  }

  getOffer(id: string): TrustedOffer | null {
    const row = this.db
      .prepare("SELECT * FROM trusted_offers WHERE id = ?")
      .get(id) as unknown as OfferRow | undefined;
    return row ? this.offerFromRow(row) : null;
  }

  createTransaction(offerId: string): CreatedTransaction {
    return this.transaction(() => {
      const offerRow = this.db
        .prepare("SELECT * FROM trusted_offers WHERE id = ?")
        .get(offerId) as unknown as OfferRow | undefined;
      if (!offerRow) throw new PaymentError("INVALID_OFFER", "Final offer not found.", 404);
      if (Date.parse(offerRow.expires_at) <= Date.now()) {
        throw new PaymentError("OFFER_EXPIRED", "This final offer has expired.", 409);
      }

      if (offerRow.consumed_transaction_id) {
        const existing = this.getInternalTransaction(offerRow.consumed_transaction_id);
        return {
          transaction: this.toPublic(existing),
          credentials: {
            buyerToken: dealToken(existing.id, "buyer"),
            sellerToken: dealToken(existing.id, "seller"),
          },
        };
      }

      const id = randomUUID();
      const buyerToken = dealToken(id, "buyer");
      const sellerToken = dealToken(id, "seller");
      const createdAt = nowIso();

      this.db
        .prepare(
          `INSERT INTO transactions (
            id, buyer_token_hash, seller_token_hash, offer_id, negotiation_id,
            listing_id, listing_title, seller_display_name, amount_cents,
            currency, meet_time, meet_place, refund_after, state,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, 'draft', ?, ?)`
        )
        .run(
          id,
          hashToken(buyerToken),
          hashToken(sellerToken),
          offerRow.id,
          offerRow.negotiation_id,
          offerRow.listing_id,
          offerRow.listing_title,
          offerRow.seller_display_name,
          offerRow.amount_cents,
          offerRow.meet_time,
          offerRow.meet_place,
          offerRow.refund_after,
          createdAt,
          createdAt
        );
      this.db
        .prepare("UPDATE trusted_offers SET consumed_transaction_id = ? WHERE id = ?")
        .run(id, offerRow.id);
      this.recordEvent(id, "transaction.created", "buyer", null, "draft");

      return {
        transaction: this.toPublic(this.getInternalTransaction(id)),
        credentials: { buyerToken, sellerToken },
      };
    });
  }

  getInternalTransaction(id: string): InternalTransaction {
    const row = this.db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(id) as unknown as TransactionRow | undefined;
    if (!row) {
      throw new PaymentError("TRANSACTION_NOT_FOUND", "Transaction not found.", 404);
    }
    return this.internalFromRow(row);
  }

  getByPaymentIntent(paymentIntentId: string): InternalTransaction | null {
    const row = this.db
      .prepare("SELECT * FROM transactions WHERE stripe_payment_intent_id = ?")
      .get(paymentIntentId) as unknown as TransactionRow | undefined;
    return row ? this.internalFromRow(row) : null;
  }

  getByConnectedAccount(accountId: string): InternalTransaction[] {
    return (
      this.db
        .prepare("SELECT * FROM transactions WHERE stripe_connected_account_id = ?")
        .all(accountId) as unknown as TransactionRow[]
    ).map((row) => this.internalFromRow(row));
  }

  authenticate(
    id: string,
    actor: "buyer" | "seller",
    token: string
  ): InternalTransaction {
    const row = this.db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(id) as unknown as TransactionRow | undefined;
    if (!row) {
      throw new PaymentError("TRANSACTION_NOT_FOUND", "Transaction not found.", 404);
    }
    const expected = actor === "buyer" ? row.buyer_token_hash : row.seller_token_hash;
    if (!token || !verifyToken(token, expected)) {
      throw new PaymentError(
        "UNAUTHORIZED_DEAL_ACCESS",
        "This deal link is invalid or expired.",
        401
      );
    }
    return this.internalFromRow(row);
  }

  findBySellerToken(token: string): InternalTransaction {
    const rows = this.db
      .prepare("SELECT * FROM transactions")
      .all() as unknown as TransactionRow[];
    const row = rows.find((candidate) => verifyToken(token, candidate.seller_token_hash));
    if (!row) {
      throw new PaymentError(
        "UNAUTHORIZED_DEAL_ACCESS",
        "This seller deal link is invalid or expired.",
        401
      );
    }
    return this.internalFromRow(row);
  }

  setPaymentIntent(id: string, paymentIntentId: string): InternalTransaction {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (
        !["draft", "payment_pending", "payment_failed"].includes(current.state)
      ) {
        return current;
      }
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET stripe_payment_intent_id = ?, state = 'payment_pending',
               last_error_code = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(paymentIntentId, at, id);
      this.recordEvent(
        id,
        "payment_intent.created",
        "system",
        current.state,
        "payment_pending"
      );
      return this.getInternalTransaction(id);
    });
  }

  markPaymentSucceeded(
    paymentIntentId: string,
    chargeId: string | null
  ): InternalTransaction | null {
    return this.transaction(() => {
      const current = this.getByPaymentIntent(paymentIntentId);
      if (!current) return null;
      if (
        [
          "awaiting_confirmation",
          "release_queued",
          "paid_to_seller",
          "refund_queued",
          "refunded",
        ].includes(current.state)
      ) {
        return current;
      }
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET stripe_charge_id = ?, state = 'awaiting_confirmation',
               last_error_code = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(chargeId, at, current.id);
      this.recordEvent(
        current.id,
        "payment.succeeded",
        "system",
        current.state,
        "awaiting_confirmation"
      );
      return this.getInternalTransaction(current.id);
    });
  }

  markPaymentFailed(paymentIntentId: string, code = "PAYMENT_FAILED") {
    return this.transaction(() => {
      const current = this.getByPaymentIntent(paymentIntentId);
      if (!current || current.state !== "payment_pending") return current;
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET state = 'payment_failed', last_error_code = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(code, at, current.id);
      this.recordEvent(
        current.id,
        "payment.failed",
        "system",
        current.state,
        "payment_failed"
      );
      return this.getInternalTransaction(current.id);
    });
  }

  markPaymentCanceled(paymentIntentId: string) {
    return this.transaction(() => {
      const current = this.getByPaymentIntent(paymentIntentId);
      if (!current || current.state !== "payment_pending") return current;
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET state = 'canceled', last_error_code = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(at, current.id);
      this.recordEvent(
        current.id,
        "payment.canceled",
        "system",
        current.state,
        "canceled"
      );
      return this.getInternalTransaction(current.id);
    });
  }

  queueRefundForLatePayment(
    paymentIntentId: string,
    chargeId: string | null
  ): InternalTransaction | null {
    return this.transaction(() => {
      const current = this.getByPaymentIntent(paymentIntentId);
      if (!current) return null;
      if (current.state === "refund_queued" || current.state === "refunded") {
        return current;
      }
      if (current.state !== "canceled") return null;
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET stripe_charge_id = ?, state = 'refund_queued',
               refund_status = 'pending', updated_at = ?
           WHERE id = ?`
        )
        .run(chargeId, at, current.id);
      this.recordEvent(
        current.id,
        "payment.succeeded_after_cancel",
        "system",
        "canceled",
        "refund_queued"
      );
      return this.getInternalTransaction(current.id);
    });
  }

  attachConnectedAccount(id: string, accountId: string): InternalTransaction {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (
        current.stripeConnectedAccountId &&
        current.stripeConnectedAccountId !== accountId
      ) {
        throw new PaymentError(
          "INVALID_STATE_TRANSITION",
          "This deal already belongs to another seller account.",
          409
        );
      }
      this.db
        .prepare(
          `UPDATE transactions
           SET stripe_connected_account_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(accountId, nowIso(), id);
      return this.getInternalTransaction(id);
    });
  }

  updateConnectedAccount(accountId: string, onboardingComplete: boolean) {
    this.db
      .prepare(
        `UPDATE transactions
         SET seller_onboarding_complete = ?, updated_at = ?
         WHERE stripe_connected_account_id = ?`
      )
      .run(onboardingComplete ? 1 : 0, nowIso(), accountId);
  }

  confirm(id: string, actor: "buyer" | "seller"): ConfirmResult {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (current.state === "paid_to_seller" || current.state === "release_queued") {
        return { transaction: current, shouldRelease: current.state === "release_queued" };
      }
      if (current.state === "refund_queued" || current.state === "refunded") {
        throw new PaymentError(
          "TRANSACTION_ALREADY_REFUNDED",
          "This deal is already being refunded.",
          409
        );
      }
      if (current.state !== "awaiting_confirmation" && current.state !== "funded") {
        throw new PaymentError(
          "TRANSACTION_NOT_FUNDED",
          "This deal cannot be confirmed until payment succeeds.",
          409
        );
      }

      const at = nowIso();
      const column = actor === "buyer" ? "buyer_confirmed_at" : "seller_confirmed_at";
      this.db
        .prepare(
          `UPDATE transactions
           SET ${column} = COALESCE(${column}, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(at, at, id);
      const afterConfirmation = this.getInternalTransaction(id);
      const shouldRelease = Boolean(
        afterConfirmation.buyerConfirmedAt && afterConfirmation.sellerConfirmedAt
      );
      if (shouldRelease) {
        this.db
          .prepare(
            `UPDATE transactions
             SET state = 'release_queued', transfer_status = 'pending', updated_at = ?
             WHERE id = ? AND state IN ('funded', 'awaiting_confirmation')`
          )
          .run(at, id);
      }
      this.recordEvent(
        id,
        `${actor}.confirmed`,
        actor,
        current.state,
        shouldRelease ? "release_queued" : current.state
      );
      return {
        transaction: this.getInternalTransaction(id),
        shouldRelease,
      };
    });
  }

  requestCancellation(id: string, actor: DealActor): CancelResult {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (current.state === "refunded" || current.state === "refund_queued") {
        return {
          transaction: current,
          shouldCancelPaymentIntent: false,
          shouldRefund: current.state === "refund_queued",
        };
      }
      if (current.state === "paid_to_seller" || current.state === "release_queued") {
        throw new PaymentError(
          "TRANSACTION_ALREADY_RELEASED",
          "This deal has already been released to the seller.",
          409
        );
      }

      const at = nowIso();
      const shouldRefund = ["funded", "awaiting_confirmation"].includes(current.state);
      const shouldCancelPaymentIntent =
        current.state === "payment_pending" && Boolean(current.stripePaymentIntentId);
      const nextState: TransactionState = shouldRefund ? "refund_queued" : "canceled";
      this.db
        .prepare(
          `UPDATE transactions
           SET state = ?, cancel_requested_by = ?, cancel_requested_at = ?,
               refund_status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextState,
          actor,
          at,
          shouldRefund ? "pending" : "not_started",
          at,
          id
        );
      this.recordEvent(id, "deal.canceled", actor, current.state, nextState);
      return {
        transaction: this.getInternalTransaction(id),
        shouldCancelPaymentIntent,
        shouldRefund,
      };
    });
  }

  markTransferComplete(id: string, transferId: string): InternalTransaction {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (current.state === "paid_to_seller") return current;
      if (current.state !== "release_queued") {
        throw new PaymentError(
          "INVALID_STATE_TRANSITION",
          "The deal is not ready for seller payment.",
          409
        );
      }
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET state = 'paid_to_seller', transfer_status = 'complete',
               stripe_transfer_id = ?, last_error_code = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(transferId, at, id);
      this.recordEvent(
        id,
        "transfer.completed",
        "system",
        "release_queued",
        "paid_to_seller"
      );
      return this.getInternalTransaction(id);
    });
  }

  markTransferFailed(id: string, code: string): InternalTransaction {
    const at = nowIso();
    this.db
      .prepare(
        `UPDATE transactions
         SET transfer_status = 'failed', last_error_code = ?, updated_at = ?
         WHERE id = ? AND state = 'release_queued'`
      )
      .run(code, at, id);
    return this.getInternalTransaction(id);
  }

  markRefundComplete(id: string, refundId: string): InternalTransaction {
    return this.transaction(() => {
      const current = this.getInternalTransaction(id);
      if (current.state === "refunded") return current;
      if (current.state !== "refund_queued") {
        throw new PaymentError(
          "INVALID_STATE_TRANSITION",
          "The deal is not awaiting a refund.",
          409
        );
      }
      const at = nowIso();
      this.db
        .prepare(
          `UPDATE transactions
           SET state = 'refunded', refund_status = 'complete',
               stripe_refund_id = ?, last_error_code = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(refundId, at, id);
      this.recordEvent(id, "refund.completed", "system", "refund_queued", "refunded");
      return this.getInternalTransaction(id);
    });
  }

  markRefundPending(id: string, refundId: string): InternalTransaction {
    this.db
      .prepare(
        `UPDATE transactions
         SET stripe_refund_id = ?, refund_status = 'pending', updated_at = ?
         WHERE id = ? AND state = 'refund_queued'`
      )
      .run(refundId, nowIso(), id);
    return this.getInternalTransaction(id);
  }

  markRefundFailed(id: string, code: string): InternalTransaction {
    this.db
      .prepare(
        `UPDATE transactions
         SET refund_status = 'failed', last_error_code = ?, updated_at = ?
         WHERE id = ? AND state = 'refund_queued'`
      )
      .run(code, nowIso(), id);
    return this.getInternalTransaction(id);
  }

  findByRefundId(refundId: string): InternalTransaction | null {
    const row = this.db
      .prepare("SELECT * FROM transactions WHERE stripe_refund_id = ?")
      .get(refundId) as unknown as TransactionRow | undefined;
    return row ? this.internalFromRow(row) : null;
  }

  expiredAwaitingConfirmation(limit = 50): InternalTransaction[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE state IN ('funded', 'awaiting_confirmation')
           AND refund_after <= ?
           AND NOT (buyer_confirmed_at IS NOT NULL AND seller_confirmed_at IS NOT NULL)
         ORDER BY refund_after ASC
         LIMIT ?`
      )
      .all(nowIso(), limit) as unknown as TransactionRow[];
    return rows.map((row) => this.internalFromRow(row));
  }

  recordStripeEvent(
    eventId: string,
    eventType: string,
    transactionId: string | null
  ): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO stripe_events
          (stripe_event_id, event_type, transaction_id, processed_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(eventId, eventType, transactionId, nowIso());
    return result.changes === 1;
  }

  hasStripeEvent(eventId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 AS present FROM stripe_events WHERE stripe_event_id = ?")
        .get(eventId)
    );
  }

  upsertOperation(
    transactionId: string,
    operation: "payment_intent" | "transfer" | "refund",
    idempotencyKey: string,
    status: "pending" | "complete" | "failed",
    stripeObjectId: string | null,
    lastError: string | null
  ) {
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO operation_attempts (
          transaction_id, operation, idempotency_key, stripe_object_id,
          status, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(transaction_id, operation) DO UPDATE SET
          stripe_object_id = COALESCE(excluded.stripe_object_id, stripe_object_id),
          status = excluded.status,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`
      )
      .run(
        transactionId,
        operation,
        idempotencyKey,
        stripeObjectId,
        status,
        lastError,
        at,
        at
      );
  }

  toPublic(transaction: InternalTransaction): PublicTransaction {
    return {
      id: transaction.id,
      listingTitle: transaction.listingTitle,
      sellerDisplayName: transaction.sellerDisplayName,
      amountCents: transaction.amountCents,
      currency: transaction.currency,
      meetTime: transaction.meetTime,
      meetPlace: transaction.meetPlace,
      state: transaction.state,
      buyerConfirmedAt: transaction.buyerConfirmedAt,
      sellerConfirmedAt: transaction.sellerConfirmedAt,
      sellerOnboardingComplete: transaction.sellerOnboardingComplete,
      transferStatus: transaction.transferStatus,
      refundStatus: transaction.refundStatus,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }

  private offerFromRow(row: OfferRow): TrustedOffer {
    return {
      id: row.id,
      negotiationId: row.negotiation_id,
      listingId: row.listing_id,
      listingTitle: row.listing_title,
      sellerDisplayName: row.seller_display_name,
      amountCents: row.amount_cents,
      currency: row.currency,
      meetTime: row.meet_time,
      meetPlace: row.meet_place,
      expiresAt: row.expires_at,
      refundAfter: row.refund_after,
      createdAt: row.created_at,
    };
  }

  private internalFromRow(row: TransactionRow): InternalTransaction {
    return {
      id: row.id,
      offerId: row.offer_id,
      negotiationId: row.negotiation_id,
      listingId: row.listing_id,
      listingTitle: row.listing_title,
      sellerDisplayName: row.seller_display_name,
      amountCents: row.amount_cents,
      currency: row.currency,
      meetTime: row.meet_time,
      meetPlace: row.meet_place,
      refundAfter: row.refund_after,
      state: row.state,
      buyerConfirmedAt: row.buyer_confirmed_at,
      sellerConfirmedAt: row.seller_confirmed_at,
      sellerOnboardingComplete: Boolean(row.seller_onboarding_complete),
      transferStatus: row.transfer_status,
      refundStatus: row.refund_status,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeChargeId: row.stripe_charge_id,
      stripeConnectedAccountId: row.stripe_connected_account_id,
      stripeTransferId: row.stripe_transfer_id,
      stripeRefundId: row.stripe_refund_id,
      lastErrorCode: row.last_error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private recordEvent(
    transactionId: string,
    eventType: string,
    actor: DealActor,
    fromState: TransactionState | null,
    toState: TransactionState | null,
    metadata: Record<string, SQLInputValue> | null = null
  ) {
    this.db
      .prepare(
        `INSERT INTO transaction_events (
          transaction_id, event_type, actor, from_state, to_state, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        transactionId,
        eventType,
        actor,
        fromState,
        toState,
        metadata ? JSON.stringify(metadata) : null,
        nowIso()
      );
  }
}

const globalForPaymentStore = globalThis as typeof globalThis & {
  __solidPaymentStore?: PaymentStore;
};

export function paymentStore(): PaymentStore {
  if (!globalForPaymentStore.__solidPaymentStore) {
    globalForPaymentStore.__solidPaymentStore = new PaymentStore();
  }
  return globalForPaymentStore.__solidPaymentStore;
}
