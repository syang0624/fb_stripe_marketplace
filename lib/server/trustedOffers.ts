import "server-only";

import { BuyerProfile, Negotiation } from "@/lib/types";
import { TrustedOffer } from "@/lib/paymentTypes";
import { PaymentError } from "@/lib/server/paymentErrors";
import { paymentStore } from "@/lib/server/paymentStore";

interface AgentFinalMove {
  newStage?: string;
  currentPrice?: number;
}

function extractJson(text: string): AgentFinalMove | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as AgentFinalMove;
  } catch {
    return null;
  }
}

function priceToCents(price: number): number {
  const cents = Math.round(price * 100);
  if (!Number.isFinite(price) || !Number.isSafeInteger(cents) || cents < 50) {
    throw new PaymentError("INVALID_OFFER", "The negotiated price is invalid.");
  }
  return cents;
}

function firstMeetWindow(profile: BuyerProfile): string {
  return profile.meetWindows?.split(",")[0]?.trim() || "this weekend";
}

export function registerAgentFinalOffer(
  reply: string,
  negotiation: Negotiation | undefined,
  profile: BuyerProfile | undefined
): TrustedOffer | null {
  if (!negotiation || !profile || negotiation.stage === "scam_detected") return null;
  const move = extractJson(reply);
  if (move?.newStage !== "final_offer" || typeof move.currentPrice !== "number") {
    return null;
  }
  if (move.currentPrice > profile.walkAwayPrice) {
    throw new PaymentError(
      "INVALID_OFFER",
      "The final price exceeds the buyer's authorized maximum."
    );
  }

  return paymentStore().createTrustedOffer({
    negotiationId: negotiation.sellerId,
    listingId: negotiation.listing.id,
    listingTitle: negotiation.listing.title,
    sellerDisplayName: negotiation.sellerName,
    amountCents: priceToCents(move.currentPrice),
    meetTime: firstMeetWindow(profile),
    meetPlace: "Powell Station, SF",
  });
}

export function registerReviewedFinalOffer(
  negotiation: Negotiation
): TrustedOffer {
  const offer = negotiation.finalOffer;
  if (negotiation.stage !== "final_offer" || !offer) {
    throw new PaymentError(
      "INVALID_OFFER",
      "Only a completed final offer can be registered."
    );
  }
  if (
    offer.listingId !== negotiation.listing.id ||
    offer.finalPrice !== negotiation.currentPrice
  ) {
    throw new PaymentError(
      "INVALID_OFFER",
      "The reviewed offer does not match the negotiated result."
    );
  }

  return paymentStore().createTrustedOffer({
    negotiationId: negotiation.sellerId,
    listingId: negotiation.listing.id,
    listingTitle: negotiation.listing.title,
    sellerDisplayName: negotiation.sellerName,
    amountCents: priceToCents(offer.finalPrice),
    meetTime: offer.meetTime,
    meetPlace: offer.meetPlace,
  });
}
