import { noStoreJson, readJson } from "@/lib/server/api";
import { paymentErrorResponse, PaymentError } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

interface CreateTransactionBody {
  offerId?: string;
  negotiationId?: string;
}

export async function POST(request: Request) {
  try {
    enforceRateLimit(`transaction:create:${request.headers.get("x-forwarded-for") || "local"}`);
    const body = await readJson<CreateTransactionBody>(request);
    const store = paymentStore();
    const offer =
      (body.offerId ? store.getOffer(body.offerId) : null) ??
      (body.negotiationId
        ? store.findOfferByNegotiationId(body.negotiationId)
        : null);
    if (!offer) {
      throw new PaymentError(
        "INVALID_OFFER",
        "A trusted final offer must be registered before checkout.",
        404
      );
    }
    const created = store.createTransaction(offer.id);
    return noStoreJson(
      {
        transaction: created.transaction,
        buyerToken: created.credentials.buyerToken,
        sellerUrl: `/seller/deal/${encodeURIComponent(
          created.credentials.sellerToken
        )}`,
      },
      { status: 201 }
    );
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
