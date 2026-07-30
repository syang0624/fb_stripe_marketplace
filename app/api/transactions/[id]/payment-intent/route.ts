import { noStoreJson, readJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { createOrReusePaymentIntent } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ token?: string }>(request);
    const token = requireToken(body.token);
    enforceRateLimit(`payment-intent:${id}`, 10);
    const transaction = paymentStore().authenticate(id, "buyer", token);
    return noStoreJson(await createOrReusePaymentIntent(transaction));
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
