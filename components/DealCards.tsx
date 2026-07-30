"use client";

import { RankedDeal } from "@/lib/types";
import { ProductImage } from "@/components/ProductImage";

interface DealCardsProps {
  deals: RankedDeal[];
  onSelect: (selectedDeals: RankedDeal[]) => void;
}

const qualityLabel: Record<RankedDeal["dealQuality"], string> = {
  great: "Great deal",
  good: "Good deal",
  fair: "Fair price"
};

export function DealCards({ deals, onSelect }: DealCardsProps) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      <div className="mb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Step 2</p>
        <h2 className="mt-2 text-2xl font-light tracking-tight text-ink">Top deals for you</h2>
        <p className="mt-1 text-sm text-ink/50">
          Ranked from your profile by value, fit, and risk.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {deals.map((deal, index) => {
          const imgSrc = deal.listing.image || deal.listing.images[0];

          return (
            <article
              key={deal.listing.id}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-paper transition-shadow hover:shadow-card"
            >
              {/* Image */}
              <div className="relative h-44 w-full bg-mist">
                <ProductImage
                  src={imgSrc}
                  alt={deal.listing.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute left-3 top-3 rounded-md bg-paper/90 px-2 py-0.5 text-xs font-medium tabular-nums text-ink backdrop-blur">
                  #{index + 1}
                </div>
              </div>

              {/* Content */}
              <div className="flex flex-1 flex-col gap-4 p-5">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink/40">
                    {qualityLabel[deal.dealQuality]}
                  </p>
                  <h3 className="mt-1 text-sm font-medium leading-snug text-ink">
                    {deal.listing.title}
                  </h3>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-light tracking-tight text-ink">
                    ${deal.listing.price}
                  </span>
                  {deal.listing.fairValue > 0 && (
                    <span className="text-xs text-ink/40">fair ${deal.listing.fairValue}</span>
                  )}
                </div>

                {/* Risk flags */}
                {deal.listing.riskFlags.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {deal.listing.riskFlags.map((flag) => (
                      <span key={flag} className="flex items-center gap-1 text-[11px] text-critical">
                        <span className="h-1 w-1 rounded-full bg-critical" />
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                {/* AI summary */}
                <p className="text-sm leading-relaxed text-ink/70">{deal.summary}</p>

                {/* Suggested offers */}
                {deal.suggestedFirstOffer > 0 && (
                  <div className="flex gap-6 text-xs">
                    <div>
                      <span className="block text-ink/40">Open at</span>
                      <span className="font-medium tabular-nums text-ink">
                        ${deal.suggestedFirstOffer}
                      </span>
                    </div>
                    <div>
                      <span className="block text-ink/40">Max</span>
                      <span className="font-medium tabular-nums text-ink">
                        ${deal.maxRecommendedPrice}
                      </span>
                    </div>
                  </div>
                )}

                {/* Score */}
                <div className="mt-auto">
                  <div className="flex items-center justify-between text-xs text-ink/40">
                    <span>Match score</span>
                    <span className="tabular-nums text-ink">{deal.score}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-ink" style={{ width: `${deal.score}%` }} />
                  </div>
                </div>

                {/* Source */}
                <div className="flex items-center justify-between border-t border-line pt-3 text-[11px]">
                  <span className="text-ink/40">
                    {deal.listing.source === "scrapecreators"
                      ? "Live Marketplace · ScrapeCreators"
                      : "Demo data"}
                  </span>
                  {deal.listing.link && (
                    <a
                      href={deal.listing.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-ink hover:underline"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-10">
        <button
          onClick={() => onSelect(deals)}
          className="rounded-md bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-ink/90"
        >
          Negotiate all {deals.length}
        </button>
      </div>
    </div>
  );
}
