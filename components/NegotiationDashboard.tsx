"use client";

import { useState } from "react";
import { BuyerProfile, Negotiation } from "@/lib/types";
import { NegotiationLane } from "@/components/NegotiationLane";
import { ChatDrawer } from "@/components/ChatDrawer";

interface NegotiationDashboardProps {
  negotiations: Negotiation[];
  profile: BuyerProfile;
  onNegotiationUpdate: (updated: Negotiation) => void;
  onSendMessage?: (sellerId: string, content: string) => void;
}

export function NegotiationDashboard({
  negotiations,
  profile,
  onNegotiationUpdate,
  onSendMessage
}: NegotiationDashboardProps) {
  const [drawerSellerId, setDrawerSellerId] = useState<string | null>(null);

  const drawerNegotiation = drawerSellerId
    ? negotiations.find((n) => n.sellerId === drawerSellerId) ?? null
    : null;

  const handleTakeOver = (negotiation: Negotiation) => {
    onNegotiationUpdate({
      ...negotiation,
      userTookOver: !negotiation.userTookOver
    });
  };

  const handleSendMessage = (content: string) => {
    if (drawerSellerId && onSendMessage) {
      onSendMessage(drawerSellerId, content);
    }
  };

  const handleReturnControl = () => {
    if (drawerNegotiation) {
      onNegotiationUpdate({
        ...drawerNegotiation,
        userTookOver: false
      });
    }
  };

  const scammedNeg = negotiations.find((n) => n.stage === "scam_detected");

  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      {/* Scam detected top banner */}
      {scammedNeg && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4 shadow-sm animate-fadeIn">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">
              Scam detected — negotiation with {scammedNeg.sellerName} stopped
            </p>
            <p className="mt-0.5 text-xs text-red-600">
              MRI identified scam indicators and automatically halted this deal to protect you.
              {scammedNeg.scamAlert?.flags?.[0] ? ` Reason: ${scammedNeg.scamAlert.flags[0]}.` : ""}
            </p>
          </div>
          <button
            onClick={() => setDrawerSellerId(scammedNeg.sellerId)}
            className="flex-shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
          >
            View details
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Step 3</p>
        <h2 className="mt-2 text-2xl font-light tracking-tight text-ink">Negotiations</h2>
        <p className="mt-1 text-sm text-ink/50">
          MRI is simulating negotiations against the live listings you selected.
          Not messaging real sellers.
        </p>
      </div>

      {/* 3-lane layout */}
      <div className="grid gap-6 md:grid-cols-3">
        {negotiations.map((neg) => (
          <NegotiationLane
            key={neg.sellerId}
            negotiation={neg}
            onViewChat={() => setDrawerSellerId(neg.sellerId)}
            onTakeOver={() => handleTakeOver(neg)}
          />
        ))}
      </div>

      {/* Chat drawer */}
      {drawerNegotiation && (
        <ChatDrawer
          negotiation={drawerNegotiation}
          onClose={() => setDrawerSellerId(null)}
          onSendMessage={handleSendMessage}
          onTakeOver={() => handleTakeOver(drawerNegotiation)}
          onReturnControl={handleReturnControl}
        />
      )}
    </div>
  );
}
