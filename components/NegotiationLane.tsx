"use client";

import { Negotiation } from "@/lib/types";
import { StageTracker } from "@/components/StageTracker";
import { ProductImage } from "@/components/ProductImage";

interface NegotiationLaneProps {
  negotiation: Negotiation;
  onViewChat: () => void;
  onTakeOver: () => void;
}

export function NegotiationLane({ negotiation, onViewChat, onTakeOver }: NegotiationLaneProps) {
  const { listing, stage, currentPrice, agentReasoning, messages, sellerName, userTookOver, scamAlert } =
    negotiation;
  const lastMessage = [...messages].reverse().find((m) => m.role === "buyer" || m.role === "seller");
  const savings = listing.price - currentPrice;
  const savingsPercent = listing.price > 0 ? Math.round((savings / listing.price) * 100) : 0;
  const isScamStopped = stage === "scam_detected";

  if (isScamStopped) {
    return (
      <article className="relative flex flex-col gap-4 rounded-lg border-2 border-red-400 bg-red-50 p-5 shadow-md animate-fadeIn">
        {/* Scam shield badge */}
        <div className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Scam Detected
        </div>

        {/* Header */}
        <div className="mt-3 flex items-center gap-3">
          <div className="relative">
            <ProductImage
              src={listing.image}
              alt={listing.title}
              fallbackLabel="IMG"
              className="h-11 w-11 flex-shrink-0 rounded-md object-cover opacity-50 grayscale"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-red-900">{listing.title}</h3>
            <p className="text-xs text-red-600/60">{sellerName}</p>
          </div>
        </div>

        {/* Big scam alert */}
        <div className="rounded-lg bg-red-100 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">
            MRI stopped this negotiation
          </p>
          <p className="mt-1 text-xs leading-relaxed text-red-700">
            {scamAlert?.summary ?? "Scam indicators detected. Negotiation halted to protect you."}
          </p>
          {scamAlert && scamAlert.flags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {scamAlert.flags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                  <span className="mt-1 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">{i + 1}</span>
                  {flag}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Price struck through */}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-light tracking-tight text-red-400 line-through">${currentPrice}</span>
          <span className="text-xs font-medium text-red-600">Deal cancelled</span>
        </div>

        {/* Action */}
        <button
          onClick={onViewChat}
          className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
        >
          View flagged conversation
        </button>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ProductImage
          src={listing.image}
          alt={listing.title}
          fallbackLabel="IMG"
          className="h-11 w-11 flex-shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-ink">{listing.title}</h3>
          <p className="text-xs text-ink/40">{sellerName}</p>
        </div>
      </div>

      {/* Stage */}
      <StageTracker currentStage={stage} />

      {/* Medium/low scam warning (not stopped, just cautioned) */}
      {scamAlert && !isScamStopped && (
        <div className={`rounded-md px-3 py-2.5 text-xs leading-relaxed ${
          scamAlert.severity === "medium"
            ? "bg-amber-50 text-amber-800 border border-amber-200"
            : "bg-yellow-50 text-yellow-700 border border-yellow-200"
        }`}>
          <p className="font-semibold">&#9888; {scamAlert.severity === "medium" ? "Suspicious activity" : "Minor concern"}</p>
          <p className="mt-0.5">{scamAlert.summary}</p>
        </div>
      )}

      {/* Price */}
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-light tracking-tight text-ink">${currentPrice}</span>
        {savings > 0 && (
          <>
            <span className="text-xs text-ink/35 line-through">${listing.price}</span>
            <span className="text-xs font-medium text-positive">-{savingsPercent}%</span>
          </>
        )}
      </div>

      {/* Agent reasoning */}
      {agentReasoning && (
        <p className="border-l-2 border-line pl-3 text-xs italic leading-relaxed text-ink/50">
          {agentReasoning}
        </p>
      )}

      {/* Last message preview */}
      <div className="min-h-[2.5rem] flex-1">
        {lastMessage ? (
          <p className="text-xs leading-relaxed text-ink/60">
            <span className="font-medium text-ink/40">
              {lastMessage.role === "buyer" ? "You: " : "Seller: "}
            </span>
            {lastMessage.content.length > 90
              ? lastMessage.content.slice(0, 90) + "…"
              : lastMessage.content}
          </p>
        ) : (
          <p className="text-xs italic text-ink/30">Waiting to start...</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onViewChat}
          className="flex-1 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-mist"
        >
          View chat
        </button>
        <button
          onClick={onTakeOver}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
            userTookOver
              ? "bg-ink text-white hover:bg-ink/90"
              : "border border-line text-ink hover:bg-mist"
          }`}
        >
          {userTookOver ? "You control" : "Take over"}
        </button>
      </div>
    </article>
  );
}
