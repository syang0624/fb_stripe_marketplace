import { noStoreJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token: rawToken } = await context.params;
    const token = requireToken(decodeURIComponent(rawToken));
    enforceRateLimit(`seller:read:${token.slice(0, 16)}`);
    const store = paymentStore();
    const transaction = store.findBySellerToken(token);
    return noStoreJson({ transaction: store.toPublic(transaction) });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
