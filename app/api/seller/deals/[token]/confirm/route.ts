import { noStoreJson, requireToken } from "@/lib/server/api";
import { PaymentError, paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { releaseToSeller } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { token: rawToken } = await context.params;
    const token = requireToken(decodeURIComponent(rawToken));
    enforceRateLimit(`seller:confirm:${token.slice(0, 16)}`, 10);
    const store = paymentStore();
    const transaction = store.findBySellerToken(token);
    const result = store.confirm(transaction.id, "seller");
    if (!result.shouldRelease) {
      return noStoreJson({ transaction: store.toPublic(result.transaction) });
    }
    try {
      return noStoreJson({
        transaction: await releaseToSeller(transaction.id),
      });
    } catch (error) {
      if (
        error instanceof PaymentError &&
        error.code === "SELLER_ONBOARDING_REQUIRED"
      ) {
        return noStoreJson(
          {
            transaction: store.toPublic(
              store.getInternalTransaction(transaction.id)
            ),
            warning: { code: error.code, message: error.message },
          },
          { status: 202 }
        );
      }
      throw error;
    }
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
