import { noStoreJson } from "@/lib/server/api";
import { paymentErrorResponse, PaymentError } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";
import { cancelDeal } from "@/lib/server/transactionService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (
      !secret ||
      request.headers.get("authorization") !== `Bearer ${secret}`
    ) {
      throw new PaymentError(
        "UNAUTHORIZED_DEAL_ACCESS",
        "Invalid scheduler credentials.",
        401
      );
    }

    const expired = paymentStore().expiredAwaitingConfirmation();
    const results = [];
    for (const transaction of expired) {
      try {
        const updated = await cancelDeal(transaction.id, "system");
        results.push({ id: transaction.id, state: updated.state });
      } catch (error) {
        console.error(
          `[payments] Timeout refund failed for ${transaction.id}`,
          error
        );
        results.push({ id: transaction.id, state: "failed" });
      }
    }
    return noStoreJson({ processed: results.length, results });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
