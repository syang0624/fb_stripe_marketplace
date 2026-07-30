import { noStoreJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const token = requireToken(new URL(request.url).searchParams.get("token"));
    enforceRateLimit(`transaction:read:${id}`);
    const store = paymentStore();
    const transaction = store.authenticate(id, "buyer", token);
    return noStoreJson({ transaction: store.toPublic(transaction) });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
