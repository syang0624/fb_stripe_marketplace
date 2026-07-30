import { Negotiation } from "@/lib/types";
import { paymentErrorResponse, PaymentError } from "@/lib/server/paymentErrors";
import { registerReviewedFinalOffer } from "@/lib/server/trustedOffers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { negotiation?: Negotiation };
    if (!body.negotiation) {
      throw new PaymentError("INVALID_REQUEST", "negotiation is required.");
    }
    const offer = registerReviewedFinalOffer(body.negotiation);
    return Response.json({ offer }, { status: 201 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
