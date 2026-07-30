import { noStoreJson, readJson, requireToken } from "@/lib/server/api";
import { PaymentError, paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { releaseToSeller } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ token?: string }>(request);
    const token = requireToken(body.token);
    enforceRateLimit(`buyer:confirm:${id}`, 10);
    const store = paymentStore();
    store.authenticate(id, "buyer", token);
    const result = store.confirm(id, "buyer");
    if (!result.shouldRelease) {
      return noStoreJson({ transaction: store.toPublic(result.transaction) });
    }
    try {
      const transaction = await releaseToSeller(id);
      return noStoreJson({ transaction });
    } catch (error) {
      if (
        error instanceof PaymentError &&
        error.code === "SELLER_ONBOARDING_REQUIRED"
      ) {
        return noStoreJson(
          {
            transaction: store.toPublic(store.getInternalTransaction(id)),
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
