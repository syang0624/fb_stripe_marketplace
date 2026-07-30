import { noStoreJson, requireToken } from "@/lib/server/api";
import { paymentErrorResponse } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { createSellerOnboardingLink } from "@/lib/server/transactionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token: rawToken } = await context.params;
    const token = requireToken(decodeURIComponent(rawToken));
    enforceRateLimit(`seller:onboarding:${token.slice(0, 16)}`, 10);
    const transaction = paymentStore().findBySellerToken(token);
    return noStoreJson(
      await createSellerOnboardingLink(transaction, token, request)
    );
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
