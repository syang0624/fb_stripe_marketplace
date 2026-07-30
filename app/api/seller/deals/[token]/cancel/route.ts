import { noStoreJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { cancelDeal } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { token: rawToken } = await context.params;
    const token = requireToken(decodeURIComponent(rawToken));
    enforceRateLimit(`seller:cancel:${token.slice(0, 16)}`, 10);
    const transaction = paymentStore().findBySellerToken(token);
    return noStoreJson({
      transaction: await cancelDeal(transaction.id, "seller"),
    });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
