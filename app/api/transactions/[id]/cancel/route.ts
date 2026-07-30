import { noStoreJson, readJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { cancelDeal } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ token?: string }>(request);
    const token = requireToken(body.token);
    enforceRateLimit(`buyer:cancel:${id}`, 10);
    paymentStore().authenticate(id, "buyer", token);
    return noStoreJson({ transaction: await cancelDeal(id, "buyer") });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
