import "server-only";

import Stripe from "stripe";
import { PublicTransaction } from "@/lib/paymentTypes";
import { PaymentError } from "@/lib/server/paymentErrors";
import {
  InternalTransaction,
  paymentStore,
} from "@/lib/server/paymentStore";
import {
  appBaseUrl,
  stripeClient,
  stripeErrorCode,
  stripeErrorMessage,
} from "@/lib/server/stripe";

function idempotencyKey(
  transactionId: string,
  operation: "payment_intent" | "transfer" | "refund"
): string {
  return `solid:${transactionId}:${operation}:v1`;
}

function latestChargeId(paymentIntent: Stripe.PaymentIntent): string | null {
  if (!paymentIntent.latest_charge) return null;
  return typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge.id;
}

function onboardingComplete(account: Stripe.Account): boolean {
  return Boolean(
    account.details_submitted &&
      account.payouts_enabled &&
      account.capabilities?.transfers === "active"
  );
}

export async function createOrReusePaymentIntent(
  transaction: InternalTransaction
): Promise<{ clientSecret: string; transaction: PublicTransaction }> {
  const store = paymentStore();
  if (
    [
      "awaiting_confirmation",
      "release_queued",
      "paid_to_seller",
      "refund_queued",
      "refunded",
    ].includes(transaction.state)
  ) {
    throw new PaymentError(
      "INVALID_STATE_TRANSITION",
      "Payment has already completed for this deal.",
      409
    );
  }

  const stripe = stripeClient();
  let paymentIntent: Stripe.PaymentIntent;
  if (transaction.stripePaymentIntentId) {
    paymentIntent = await stripe.paymentIntents.retrieve(
      transaction.stripePaymentIntentId
    );
  } else {
    const key = idempotencyKey(transaction.id, "payment_intent");
    store.upsertOperation(
      transaction.id,
      "payment_intent",
      key,
      "pending",
      null,
      null
    );
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: transaction.amountCents,
          currency: transaction.currency,
          capture_method: "automatic",
          payment_method_types: ["card"],
          description: `SOLID meetup purchase: ${transaction.listingTitle}`,
          transfer_group: `solid_${transaction.id}`,
          metadata: {
            solid_transaction_id: transaction.id,
            solid_listing_id: transaction.listingId,
          },
        },
        { idempotencyKey: key }
      );
      store.upsertOperation(
        transaction.id,
        "payment_intent",
        key,
        "complete",
        paymentIntent.id,
        null
      );
    } catch (error) {
      store.upsertOperation(
        transaction.id,
        "payment_intent",
        key,
        "failed",
        null,
        stripeErrorMessage(error)
      );
      throw error;
    }
  }

  if (!paymentIntent.client_secret) {
    throw new PaymentError(
      "PAYMENT_FAILED",
      "Stripe did not return a checkout client secret.",
      502
    );
  }
  const updated = store.setPaymentIntent(transaction.id, paymentIntent.id);
  return {
    clientSecret: paymentIntent.client_secret,
    transaction: store.toPublic(updated),
  };
}

export async function createSellerOnboardingLink(
  transaction: InternalTransaction,
  sellerToken: string,
  request?: Request
): Promise<{ url: string; transaction: PublicTransaction }> {
  const store = paymentStore();
  const stripe = stripeClient();
  let account: Stripe.Account;

  if (transaction.stripeConnectedAccountId) {
    account = await stripe.accounts.retrieve(transaction.stripeConnectedAccountId);
  } else {
    account = await stripe.accounts.create(
      {
        type: "express",
        business_type: "individual",
        capabilities: { transfers: { requested: true } },
        business_profile: {
          product_description: "Individual seller of secondhand physical goods",
        },
        metadata: { solid_transaction_id: transaction.id },
      },
      { idempotencyKey: `solid:${transaction.id}:connected_account:v1` }
    );
    transaction = store.attachConnectedAccount(transaction.id, account.id);
  }

  const complete = onboardingComplete(account);
  store.updateConnectedAccount(account.id, complete);
  const baseUrl = appBaseUrl(request);
  const encodedToken = encodeURIComponent(sellerToken);
  const link = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${baseUrl}/seller/deal/${encodedToken}?onboarding=refresh`,
    return_url: `${baseUrl}/seller/deal/${encodedToken}?onboarding=return`,
    type: "account_onboarding",
  });

  return {
    url: link.url,
    transaction: store.toPublic(store.getInternalTransaction(transaction.id)),
  };
}

export async function releaseToSeller(
  transactionId: string
): Promise<PublicTransaction> {
  const store = paymentStore();
  let transaction = store.getInternalTransaction(transactionId);
  if (transaction.state === "paid_to_seller") return store.toPublic(transaction);
  if (transaction.state !== "release_queued") {
    throw new PaymentError(
      "INVALID_STATE_TRANSITION",
      "Both parties must confirm before seller payment.",
      409
    );
  }
  if (!transaction.stripeConnectedAccountId) {
    throw new PaymentError(
      "SELLER_ONBOARDING_REQUIRED",
      "The seller must connect Stripe before receiving payment.",
      409
    );
  }
  if (!transaction.stripeChargeId) {
    throw new PaymentError(
      "STRIPE_OPERATION_PENDING",
      "The buyer payment is still settling.",
      409
    );
  }

  const stripe = stripeClient();
  const account = await stripe.accounts.retrieve(
    transaction.stripeConnectedAccountId
  );
  const complete = onboardingComplete(account);
  store.updateConnectedAccount(account.id, complete);
  if (!complete) {
    throw new PaymentError(
      "SELLER_ONBOARDING_REQUIRED",
      "The seller must finish Stripe onboarding before receiving payment.",
      409
    );
  }

  const key = idempotencyKey(transaction.id, "transfer");
  store.upsertOperation(transaction.id, "transfer", key, "pending", null, null);
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: transaction.amountCents,
        currency: transaction.currency,
        destination: account.id,
        source_transaction: transaction.stripeChargeId,
        transfer_group: `solid_${transaction.id}`,
        description: `SOLID payment for ${transaction.listingTitle}`,
        metadata: { solid_transaction_id: transaction.id },
      },
      { idempotencyKey: key }
    );
    store.upsertOperation(
      transaction.id,
      "transfer",
      key,
      "complete",
      transfer.id,
      null
    );
    transaction = store.markTransferComplete(transaction.id, transfer.id);
    return store.toPublic(transaction);
  } catch (error) {
    const code = stripeErrorCode(error);
    store.upsertOperation(
      transaction.id,
      "transfer",
      key,
      "failed",
      null,
      stripeErrorMessage(error)
    );
    store.markTransferFailed(transaction.id, code);
    throw error;
  }
}

export async function refundTransaction(
  transactionId: string
): Promise<PublicTransaction> {
  const store = paymentStore();
  let transaction = store.getInternalTransaction(transactionId);
  if (transaction.state === "refunded") return store.toPublic(transaction);
  if (transaction.state !== "refund_queued") {
    throw new PaymentError(
      "INVALID_STATE_TRANSITION",
      "This deal is not awaiting a refund.",
      409
    );
  }
  if (!transaction.stripePaymentIntentId) {
    throw new PaymentError(
      "PAYMENT_FAILED",
      "The original payment could not be found.",
      409
    );
  }

  const stripe = stripeClient();
  const key = idempotencyKey(transaction.id, "refund");
  store.upsertOperation(transaction.id, "refund", key, "pending", null, null);
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: transaction.stripePaymentIntentId,
        metadata: { solid_transaction_id: transaction.id },
      },
      { idempotencyKey: key }
    );
    store.upsertOperation(
      transaction.id,
      "refund",
      key,
      refund.status === "succeeded" ? "complete" : "pending",
      refund.id,
      null
    );
    transaction =
      refund.status === "succeeded"
        ? store.markRefundComplete(transaction.id, refund.id)
        : store.markRefundPending(transaction.id, refund.id);
    return store.toPublic(transaction);
  } catch (error) {
    const code = stripeErrorCode(error);
    store.upsertOperation(
      transaction.id,
      "refund",
      key,
      "failed",
      null,
      stripeErrorMessage(error)
    );
    store.markRefundFailed(transaction.id, code);
    throw error;
  }
}

export async function cancelDeal(
  transactionId: string,
  actor: "buyer" | "seller" | "system"
): Promise<PublicTransaction> {
  const store = paymentStore();
  const result = store.requestCancellation(transactionId, actor);
  if (result.shouldRefund) return refundTransaction(transactionId);

  if (
    result.shouldCancelPaymentIntent &&
    result.transaction.stripePaymentIntentId
  ) {
    const stripe = stripeClient();
    try {
      await stripe.paymentIntents.cancel(
        result.transaction.stripePaymentIntentId,
        {},
        { idempotencyKey: `solid:${transactionId}:cancel_payment_intent:v1` }
      );
    } catch (error) {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        result.transaction.stripePaymentIntentId
      );
      if (paymentIntent.status === "succeeded") {
        const queued = store.queueRefundForLatePayment(
          paymentIntent.id,
          latestChargeId(paymentIntent)
        );
        if (queued) return refundTransaction(queued.id);
      }
      throw error;
    }
  }

  return store.toPublic(store.getInternalTransaction(transactionId));
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const store = paymentStore();
  if (store.hasStripeEvent(event.id)) return;

  let transactionId: string | null = null;
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object;
      const current = store.getByPaymentIntent(paymentIntent.id);
      transactionId = current?.id ?? paymentIntent.metadata.solid_transaction_id ?? null;
      if (current?.state === "canceled") {
        const queued = store.queueRefundForLatePayment(
          paymentIntent.id,
          latestChargeId(paymentIntent)
        );
        if (queued) await refundTransaction(queued.id);
      } else {
        store.markPaymentSucceeded(paymentIntent.id, latestChargeId(paymentIntent));
      }
      break;
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      const current = store.getByPaymentIntent(paymentIntent.id);
      transactionId = current?.id ?? paymentIntent.metadata.solid_transaction_id ?? null;
      store.markPaymentFailed(
        paymentIntent.id,
        paymentIntent.last_payment_error?.code || "PAYMENT_FAILED"
      );
      break;
    }
    case "payment_intent.canceled": {
      const paymentIntent = event.data.object;
      const current = store.getByPaymentIntent(paymentIntent.id);
      transactionId = current?.id ?? paymentIntent.metadata.solid_transaction_id ?? null;
      store.markPaymentCanceled(paymentIntent.id);
      break;
    }
    case "refund.created":
    case "refund.updated": {
      const refund = event.data.object;
      transactionId = refund.metadata?.solid_transaction_id || null;
      const transaction = transactionId
        ? store.getInternalTransaction(transactionId)
        : store.findByRefundId(refund.id);
      if (transaction?.state === "refund_queued") {
        if (refund.status === "succeeded") {
          store.markRefundComplete(transaction.id, refund.id);
        } else if (refund.status === "failed" || refund.status === "canceled") {
          store.markRefundFailed(transaction.id, refund.failure_reason || refund.status);
        } else {
          store.markRefundPending(transaction.id, refund.id);
        }
      }
      break;
    }
    case "refund.failed": {
      const refund = event.data.object;
      transactionId = refund.metadata?.solid_transaction_id || null;
      const transaction = transactionId
        ? store.getInternalTransaction(transactionId)
        : store.findByRefundId(refund.id);
      if (transaction) {
        store.markRefundFailed(
          transaction.id,
          refund.failure_reason || "REFUND_FAILED"
        );
      }
      break;
    }
    case "account.updated": {
      const account = event.data.object;
      store.updateConnectedAccount(account.id, onboardingComplete(account));
      const transactions = store.getByConnectedAccount(account.id);
      transactionId = transactions[0]?.id ?? null;
      for (const transaction of transactions) {
        if (
          transaction.state === "release_queued" &&
          onboardingComplete(account)
        ) {
          await releaseToSeller(transaction.id);
        }
      }
      break;
    }
    default:
      break;
  }

  store.recordStripeEvent(event.id, event.type, transactionId);
}
