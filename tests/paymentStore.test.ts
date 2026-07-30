import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { PaymentError } from "@/lib/server/paymentErrors";
import { PaymentStore } from "@/lib/server/paymentStore";

const stores: PaymentStore[] = [];

function createStore() {
  const store = new PaymentStore(":memory:");
  stores.push(store);
  return store;
}

function createOffer(store: PaymentStore, suffix = "1") {
  return store.createTrustedOffer({
    negotiationId: `neg-${suffix}`,
    listingId: `listing-${suffix}`,
    listingTitle: "Test bicycle",
    sellerDisplayName: "Test Seller",
    amountCents: 72_500,
    meetTime: "Saturday at noon",
    meetPlace: "Public library",
  });
}

function createTransaction(store: PaymentStore, suffix = "1") {
  const offer = createOffer(store, suffix);
  return store.createTransaction(offer.id);
}

function fundTransaction(store: PaymentStore, transactionId: string) {
  store.setPaymentIntent(transactionId, `pi_${transactionId}`);
  return store.markPaymentSucceeded(
    `pi_${transactionId}`,
    `ch_${transactionId}`
  );
}

afterEach(() => {
  while (stores.length) stores.pop()?.close();
});

describe("trusted offers", () => {
  it("rejects a changed final price for the same negotiation", () => {
    const store = createStore();
    createOffer(store);

    assert.throws(
      () =>
        store.createTrustedOffer({
          negotiationId: "neg-1",
          listingId: "listing-1",
          listingTitle: "Test bicycle",
          sellerDisplayName: "Test Seller",
          amountCents: 70_000,
          meetTime: "Saturday at noon",
          meetPlace: "Public library",
        }),
      (error) =>
        error instanceof PaymentError && error.code === "INVALID_OFFER"
    );
  });

  it("creates one transaction and stable credentials on retry", () => {
    const store = createStore();
    const offer = createOffer(store);
    const first = store.createTransaction(offer.id);
    const second = store.createTransaction(offer.id);

    assert.equal(first.transaction.id, second.transaction.id);
    assert.equal(first.credentials.buyerToken, second.credentials.buyerToken);
    assert.equal(first.credentials.sellerToken, second.credentials.sellerToken);
  });
});

describe("deal access", () => {
  it("keeps buyer and seller credentials separate", () => {
    const store = createStore();
    const created = createTransaction(store);

    assert.equal(
      store.authenticate(
        created.transaction.id,
        "buyer",
        created.credentials.buyerToken
      ).id,
      created.transaction.id
    );
    assert.throws(
      () =>
        store.authenticate(
          created.transaction.id,
          "seller",
          created.credentials.buyerToken
        ),
      (error) =>
        error instanceof PaymentError &&
        error.code === "UNAUTHORIZED_DEAL_ACCESS"
    );
  });
});

describe("confirmation state machine", () => {
  it("does not allow confirmation before a verified payment", () => {
    const store = createStore();
    const created = createTransaction(store);

    assert.throws(
      () => store.confirm(created.transaction.id, "buyer"),
      (error) =>
        error instanceof PaymentError &&
        error.code === "TRANSACTION_NOT_FUNDED"
    );
  });

  it("queues release only after both parties confirm", () => {
    const store = createStore();
    const created = createTransaction(store);
    fundTransaction(store, created.transaction.id);

    const buyer = store.confirm(created.transaction.id, "buyer");
    assert.equal(buyer.shouldRelease, false);
    assert.equal(buyer.transaction.state, "awaiting_confirmation");
    assert.ok(buyer.transaction.buyerConfirmedAt);
    assert.equal(buyer.transaction.sellerConfirmedAt, null);

    const seller = store.confirm(created.transaction.id, "seller");
    assert.equal(seller.shouldRelease, true);
    assert.equal(seller.transaction.state, "release_queued");
    assert.ok(seller.transaction.sellerConfirmedAt);
  });

  it("makes duplicate confirmations idempotent", () => {
    const store = createStore();
    const created = createTransaction(store);
    fundTransaction(store, created.transaction.id);

    const first = store.confirm(created.transaction.id, "buyer");
    const second = store.confirm(created.transaction.id, "buyer");

    assert.equal(first.transaction.buyerConfirmedAt, second.transaction.buyerConfirmedAt);
    assert.equal(second.shouldRelease, false);
  });
});

describe("refund and release exclusivity", () => {
  it("prevents confirmation after cancellation wins", () => {
    const store = createStore();
    const created = createTransaction(store);
    fundTransaction(store, created.transaction.id);

    const cancellation = store.requestCancellation(
      created.transaction.id,
      "buyer"
    );
    assert.equal(cancellation.shouldRefund, true);
    assert.equal(cancellation.transaction.state, "refund_queued");

    assert.throws(
      () => store.confirm(created.transaction.id, "seller"),
      (error) =>
        error instanceof PaymentError &&
        error.code === "TRANSACTION_ALREADY_REFUNDED"
    );
  });

  it("prevents cancellation after both confirmations win", () => {
    const store = createStore();
    const created = createTransaction(store);
    fundTransaction(store, created.transaction.id);
    store.confirm(created.transaction.id, "buyer");
    store.confirm(created.transaction.id, "seller");

    assert.throws(
      () => store.requestCancellation(created.transaction.id, "seller"),
      (error) =>
        error instanceof PaymentError &&
        error.code === "TRANSACTION_ALREADY_RELEASED"
    );
  });

  it("records exactly one Stripe webhook event", () => {
    const store = createStore();

    assert.equal(store.recordStripeEvent("evt_1", "test.event", null), true);
    assert.equal(store.recordStripeEvent("evt_1", "test.event", null), false);
    assert.equal(store.hasStripeEvent("evt_1"), true);
  });
});
