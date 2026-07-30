"use client";

import { useState } from "react";
import { Negotiation } from "@/lib/types";
import { ModifyDialog } from "@/components/ModifyDialog";
import { ChatDrawer } from "@/components/ChatDrawer";
import { ProductImage } from "@/components/ProductImage";

interface FinalOffersReviewProps {
  negotiations: Negotiation[];
  onAccept: (negotiation: Negotiation) => void;
  onDecline: (negotiation: Negotiation) => void;
  onModifyLogistics: (sellerId: string, meetTime: string, meetPlace: string) => void;
  onModifyPrice: (sellerId: string, newTarget: number) => void;
}

export function FinalOffersReview({
  negotiations,
  onAccept,
  onDecline,
  onModifyLogistics,
  onModifyPrice
}: FinalOffersReviewProps) {
  const [modifyingSellerId, setModifyingSellerId] = useState<string | null>(null);
  const [viewingSellerId, setViewingSellerId] = useState<string | null>(null);

  const finalOffers = negotiations.filter((n) => n.stage === "final_offer" && n.finalOffer);
  const scamDetected = negotiations.filter((n) => n.stage === "scam_detected");
  const withdrawn = negotiations.filter((n) => n.stage === "withdrawn");
  const modifyingNeg = modifyingSellerId
    ? negotiations.find((n) => n.sellerId === modifyingSellerId)
    : null;
  const viewingNeg = viewingSellerId
    ? negotiations.find((n) => n.sellerId === viewingSellerId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      <div className="mb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Step 4</p>
        <h2 className="mt-2 text-2xl font-light tracking-tight text-ink">Final offers</h2>
        <p className="mt-1 text-sm text-ink/50">Review your deals. Accept, modify, or decline.</p>
      </div>

      {/* Final offer cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {finalOffers.map((neg) => {
          const offer = neg.finalOffer!;
          const savings = neg.listing.price - offer.finalPrice;
          const savingsPercent =
            neg.listing.price > 0 ? Math.round((savings / neg.listing.price) * 100) : 0;

          return (
            <article
              key={neg.sellerId}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper"
            >
              {/* Image */}
              <div className="relative h-36 w-full bg-mist">
                <ProductImage
                  src={neg.listing.image}
                  alt={neg.listing.title}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* Content */}
              <div className="flex flex-1 flex-col gap-4 p-5">
                <h3 className="text-sm font-medium leading-snug text-ink">{offer.bikeTitle || neg.listing.title}</h3>

                {/* Price */}
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-light tracking-tight text-ink">
                    ${offer.finalPrice}
                  </span>
                  <span className="text-xs text-ink/35 line-through">${neg.listing.price}</span>
                  {savings > 0 && (
                    <span className="text-xs font-medium text-positive">
                      saved ${savings} ({savingsPercent}%)
                    </span>
                  )}
                </div>

                {/* Meet details */}
                <dl className="space-y-1.5 text-xs">
                  <div className="flex gap-3">
                    <dt className="w-12 flex-shrink-0 text-ink/40">Meet</dt>
                    <dd className="text-ink">{offer.meetTime}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-12 flex-shrink-0 text-ink/40">At</dt>
                    <dd className="text-ink">{offer.meetPlace}</dd>
                  </div>
                  {offer.extras.length > 0 && (
                    <div className="flex gap-3">
                      <dt className="w-12 flex-shrink-0 text-ink/40">Extras</dt>
                      <dd className="text-ink">{offer.extras.join(", ")}</dd>
                    </div>
                  )}
                </dl>

                {/* Notes */}
                {offer.notes && (
                  <p className="text-xs italic leading-relaxed text-ink/50">{offer.notes}</p>
                )}

                {/* Actions */}
                <div className="mt-auto space-y-2 pt-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => onAccept(neg)}
                      className="flex-1 rounded-md bg-ink px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-ink/90"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => setModifyingSellerId(neg.sellerId)}
                      className="flex-1 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-mist"
                    >
                      Modify
                    </button>
                    <button
                      onClick={() => onDecline(neg)}
                      className="flex-1 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink/60 transition-colors hover:text-critical"
                    >
                      Decline
                    </button>
                  </div>
                  <button
                    onClick={() => setViewingSellerId(neg.sellerId)}
                    className="w-full text-xs font-medium text-ink/50 transition-colors hover:text-ink"
                  >
                    View chat history
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Scam detected */}
      {scamDetected.length > 0 && (
        <div className="mt-12">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-red-600">
            <span>&#9888;</span> Scam Detected
          </h3>
          <div className="mt-4 space-y-3">
            {scamDetected.map((neg) => (
              <div
                key={neg.sellerId}
                className="rounded-lg border border-red-200 bg-red-50/50 p-4"
              >
                <div className="flex items-center gap-4">
                  <ProductImage
                    src={neg.listing.image}
                    alt={neg.listing.title}
                    fallbackLabel=""
                    className="h-9 w-9 flex-shrink-0 rounded-md object-cover opacity-60"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink/70">
                      {neg.listing.title}
                    </p>
                    <p className="truncate text-xs text-red-600">
                      {neg.scamAlert?.summary ?? "Scam indicators detected — negotiation stopped."}
                    </p>
                  </div>
                  <button
                    onClick={() => setViewingSellerId(neg.sellerId)}
                    className="text-xs font-medium text-ink/50 transition-colors hover:text-ink"
                  >
                    View chat
                  </button>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Stopped
                  </span>
                </div>
                {neg.scamAlert && neg.scamAlert.flags.length > 0 && (
                  <ul className="mt-3 ml-13 space-y-0.5 text-xs text-red-600/80">
                    {neg.scamAlert.flags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-0.5 h-1 w-1 flex-shrink-0 rounded-full bg-red-400" />
                        {flag}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Withdrawn */}
      {withdrawn.length > 0 && (
        <div className="mt-12">
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink/40">Withdrawn</h3>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {withdrawn.map((neg) => {
              const lastAgentNote = [...neg.messages]
                .reverse()
                .find((m) => m.role === "agent_note");
              return (
                <div key={neg.sellerId} className="flex items-center gap-4 py-4">
                  <ProductImage
                    src={neg.listing.image}
                    alt={neg.listing.title}
                    fallbackLabel=""
                    className="h-9 w-9 flex-shrink-0 rounded-md object-cover opacity-60"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink/70">{neg.listing.title}</p>
                    <p className="truncate text-xs text-ink/40">
                      {lastAgentNote?.content ?? "Negotiation withdrawn"}
                    </p>
                  </div>
                  <button
                    onClick={() => setViewingSellerId(neg.sellerId)}
                    className="text-xs font-medium text-ink/50 transition-colors hover:text-ink"
                  >
                    View chat
                  </button>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-critical">
                    <span className="h-1.5 w-1.5 rounded-full bg-critical" />
                    Walked away
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modify dialog */}
      {modifyingNeg && modifyingNeg.finalOffer && (
        <ModifyDialog
          negotiation={modifyingNeg}
          onClose={() => setModifyingSellerId(null)}
          onModifyLogistics={(meetTime, meetPlace) =>
            onModifyLogistics(modifyingNeg.sellerId, meetTime, meetPlace)
          }
          onModifyPrice={(newTarget) => onModifyPrice(modifyingNeg.sellerId, newTarget)}
        />
      )}

      {/* Read-only chat history (viewable from the review page) */}
      {viewingNeg && (
        <ChatDrawer
          negotiation={viewingNeg}
          onClose={() => setViewingSellerId(null)}
          readOnly
        />
      )}
    </div>
  );
}
