import { paymentErrorResponse, PaymentError } from "@/lib/server/paymentErrors";
import { processStripeEvent } from "@/lib/server/transactionService";
import { stripeClient } from "@/lib/server/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!signature || !webhookSecret) {
      throw new PaymentError(
        "PAYMENT_NOT_CONFIGURED",
        "Stripe webhook verification is not configured.",
        503
      );
    }

    const rawBody = await request.text();
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
    } catch {
      throw new PaymentError(
        "INVALID_REQUEST",
        "Invalid Stripe webhook signature.",
        400
      );
    }
    await processStripeEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
