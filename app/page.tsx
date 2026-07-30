"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DealCards } from "@/components/DealCards";
import { FinalOffersReview } from "@/components/FinalOffersReview";
import { NegotiationDashboard } from "@/components/NegotiationDashboard";
import { OnboardingChat } from "@/components/OnboardingChat";
import { SearchProgress } from "@/components/SearchProgress";
import { fallbackListings, getSellerPersona } from "@/lib/data";
import { findTopDeals } from "@/lib/searchAgent";
import { BuyerProfile, Negotiation, RankedDeal } from "@/lib/types";
import { checkForScam, shouldAutoStop } from "@/lib/scamDetection";

type Step = "onboarding" | "searching" | "deals" | "negotiate" | "review";

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "onboarding", label: "Profile" },
  { key: "searching", label: "Search" },
  { key: "deals", label: "Deals" },
  { key: "negotiate", label: "Negotiate" },
  { key: "review", label: "Review" }
];

// Derive meet time/place from the buyer's stated preferences so the final offer
// reflects their authority (meet windows + location + travel radius) rather than
// a hardcoded default.
function deriveMeetDetails(profile: BuyerProfile | null): {
  meetTime: string;
  meetPlace: string;
} {
  if (!profile) {
    return { meetTime: "this weekend", meetPlace: "Powell Station, SF" };
  }
  const firstWindow = profile.meetWindows?.split(",")[0]?.trim();
  const meetTime = firstWindow && firstWindow.length > 0 ? firstWindow : "this weekend";
  const meetPlace = "Powell Station, SF";
  return { meetTime, meetPlace };
}

export default function HomePage() {
  const [step, setStep] = useState<Step>("onboarding");
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [deals, setDeals] = useState<RankedDeal[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [accepted, setAccepted] = useState<Negotiation | null>(null);
  // Holds the in-flight live search so the progress animation can await it.
  const searchPromiseRef = useRef<Promise<RankedDeal[]> | null>(null);
  // True once the live search has actually resolved — gates the "complete" UI.
  const [searchReady, setSearchReady] = useState(false);

  // Auto-advance to review when all negotiations are terminal
  useEffect(() => {
    if (step !== "negotiate" || negotiations.length === 0) return;
    const allDone = negotiations.every(
      (n) => n.stage === "final_offer" || n.stage === "withdrawn" || n.stage === "scam_detected"
    );
    if (allDone) {
      setTimeout(() => setStep("review"), 1000);
    }
  }, [negotiations, step]);

  const handleProfileDone = async (rawProfile: BuyerProfile) => {
    // Onboarding only asks for item, location, budget, and meet windows. Derive
    // everything else (price limits, radii, deadline) so negotiation still works.
    const nextProfile: BuyerProfile = {
      ...rawProfile,
      budgetMin: rawProfile.budgetMin > 0 ? rawProfile.budgetMin : 0,
      searchRadiusKm: rawProfile.searchRadiusKm || 25,
      meetRadius: rawProfile.meetRadius || 10,
      walkAwayPrice: rawProfile.budgetMax,
      autoAcceptThreshold: Math.round(rawProfile.budgetMax * 0.8),
      deadline: rawProfile.deadline || "no rush",
      // We no longer ask for dealbreakers; keep a light default so the agent still
      // walks away from clearly bad/undisclosed-damage deals.
      nonNegotiables:
        rawProfile.nonNegotiables && rawProfile.nonNegotiables.length > 0
          ? rawProfile.nonNegotiables
          : ["undisclosed crash or major damage"]
    };

    setProfile(nextProfile);
    setSearchReady(false);
    setStep("searching");
    // Kick off the live search agent immediately so it runs while SearchProgress
    // animates. findTopDeals does query planning → live ScrapeCreators search →
    // dedupe → enrich → hybrid rank, and falls back to seeded listings on failure.
    const promise = findTopDeals(nextProfile);
    searchPromiseRef.current = promise;
    // Signal completion only once the search actually settles, so the progress
    // UI never claims "complete" while the API is still running.
    promise.finally(() => setSearchReady(true));
  };

  const seededFallbackDeals = useCallback(
    (): RankedDeal[] =>
      fallbackListings
        .slice()
        .sort((a, b) => a.price - b.price)
        .slice(0, 3)
        .map((listing, index) => ({
          listing,
          score: 85 - index * 10,
          dealQuality: (index === 0 ? "great" : index === 1 ? "good" : "fair") as RankedDeal["dealQuality"],
          valueScore: 80 - index * 10,
          relevanceScore: 75 - index * 8,
          conditionScore: 70 - index * 10,
          distanceScore: 85 - index * 5,
          riskScore: 60 - index * 15,
          summary: "Fallback ranking — live search unavailable.",
          suggestedFirstOffer: Math.round(listing.price * 0.85),
          maxRecommendedPrice: Math.round(listing.price * 0.95)
        })),
    []
  );

  const handleSearchComplete = useCallback(async () => {
    if (!profile) return;

    let results: RankedDeal[] = [];
    try {
      results = (await searchPromiseRef.current) ?? [];
    } catch {
      results = [];
    }

    // findTopDeals already seeds its own fallback, but guard against a hard
    // throw before that path could run.
    setDeals(results.length > 0 ? results : seededFallbackDeals());
    setStep("deals");
  }, [profile, seededFallbackDeals]);

  const handleStartNegotiation = (selectedDeals: RankedDeal[]) => {
    const nextNegotiations: Negotiation[] = selectedDeals.map((deal, index) => {
      const persona = getSellerPersona(deal.listing, index);
      return {
        sellerId: deal.listing.id,
        sellerName: persona.name,
        listing: deal.listing,
        currentPrice: deal.listing.price,
        stage: "outreach" as const,
        agentReasoning: "Starting negotiation...",
        persona,
        userTookOver: false,
        messages: [
          {
            role: "system" as const,
            content: `Negotiation started for "${deal.listing.title}" ($${deal.listing.price}). Agent will negotiate autonomously.`,
            timestamp: Date.now()
          }
        ]
      };
    });
    setNegotiations(nextNegotiations);
    setStep("negotiate");

    // Start autonomous negotiation loops
    nextNegotiations.forEach((neg) => {
      runNegotiationLoop(neg);
    });
  };

  const runNegotiationLoop = async (neg: Negotiation) => {
    let current = { ...neg, messages: [...neg.messages] };
    let turns = 0;
    const maxTurns = 6;

    while (
      current.stage !== "final_offer" &&
      current.stage !== "withdrawn" &&
      current.stage !== "scam_detected" &&
      turns < maxTurns &&
      !current.userTookOver
    ) {
      turns++;

      // Agent turn
      try {
        const agentResp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "agent_turn",
            messages: current.messages.map((m) => ({
              role: m.role === "buyer" ? "user" : "assistant",
              content: m.content
            })),
            context: { negotiation: current, profile }
          })
        });
        const agentData = (await agentResp.json()) as { reply: string };
        let agentMove: {
          message: string;
          newStage: Negotiation["stage"];
          currentPrice: number;
          reasoning: string;
        };

        try {
          const parsed = JSON.parse(agentData.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
          agentMove = parsed;
        } catch {
          break;
        }

        current.messages = [
          ...current.messages,
          { role: "buyer", content: agentMove.message, timestamp: Date.now() },
          { role: "agent_note", content: agentMove.reasoning, timestamp: Date.now() }
        ];
        current.stage = agentMove.newStage;
        current.currentPrice = agentMove.currentPrice;
        current.agentReasoning = agentMove.reasoning;

        setNegotiations((prev) =>
          prev.map((n) => (n.sellerId === current.sellerId ? { ...current } : n))
        );

        if (current.stage === "withdrawn" || current.stage === "final_offer" || current.stage === "scam_detected") break;

        // Delay for realism
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));

        // Seller turn
        const sellerResp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "seller",
            messages: current.messages.map((m) => ({
              role: m.role === "buyer" ? "user" : "assistant",
              content: m.content
            })),
            context: { negotiation: current, persona: current.persona }
          })
        });
        const sellerData = (await sellerResp.json()) as { reply: string };
        let sellerReply: { reply: string; newPrice: number | null };

        try {
          sellerReply = JSON.parse(sellerData.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        } catch {
          sellerReply = { reply: sellerData.reply, newPrice: null };
        }

        current.messages = [
          ...current.messages,
          { role: "seller", content: sellerReply.reply ?? sellerData.reply, timestamp: Date.now() }
        ];
        if (typeof sellerReply.newPrice === "number") {
          current.currentPrice = sellerReply.newPrice;
        }

        setNegotiations((prev) =>
          prev.map((n) => (n.sellerId === current.sellerId ? { ...current } : n))
        );

        // Scam check after every seller reply
        const scamAlert = await checkForScam(current);
        if (scamAlert) {
          current.scamAlert = scamAlert;
          if (shouldAutoStop(scamAlert)) {
            current.stage = "scam_detected";
            current.agentReasoning = scamAlert.summary;
            current.messages = [
              ...current.messages,
              {
                role: "agent_note",
                content: `Scam detected: ${scamAlert.summary}`,
                timestamp: Date.now()
              }
            ];
            setNegotiations((prev) =>
              prev.map((n) => (n.sellerId === current.sellerId ? { ...current } : n))
            );
            break;
          }
          // Medium/low: warn but continue
          current.messages = [
            ...current.messages,
            {
              role: "agent_note",
              content: `Caution: ${scamAlert.summary}`,
              timestamp: Date.now()
            }
          ];
          setNegotiations((prev) =>
            prev.map((n) => (n.sellerId === current.sellerId ? { ...current } : n))
          );
        }

        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        break;
      }
    }

    // Generate final offer if we reached that stage
    if (current.stage === "final_offer") {
      const meet = deriveMeetDetails(profile);
      current.finalOffer = {
        listingId: current.listing.id,
        sellerName: current.sellerName,
        bikeTitle: current.listing.title,
        finalPrice: current.currentPrice,
        meetTime: meet.meetTime,
        meetPlace: meet.meetPlace,
        extras: [],
        notes: current.agentReasoning
      };
      setNegotiations((prev) =>
        prev.map((n) => (n.sellerId === current.sellerId ? { ...current } : n))
      );
    }
  };

  const handleNegotiationUpdate = (updated: Negotiation) => {
    setNegotiations((prev) =>
      prev.map((n) => (n.sellerId === updated.sellerId ? updated : n))
    );
  };

  const handleSendMessage = async (sellerId: string, content: string) => {
    const neg = negotiations.find((n) => n.sellerId === sellerId);
    if (!neg) return;

    const buyerMsg = { role: "buyer" as const, content, timestamp: Date.now() };
    const updated = { ...neg, messages: [...neg.messages, buyerMsg] };
    setNegotiations((prev) =>
      prev.map((n) => (n.sellerId === sellerId ? updated : n))
    );

    // Get seller response
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "seller",
          messages: updated.messages.map((m) => ({
            role: m.role === "buyer" ? "user" : "assistant",
            content: m.content
          })),
          context: { negotiation: updated, persona: updated.persona }
        })
      });
      const data = (await resp.json()) as { reply: string };
      let sellerReply: { reply: string; newPrice: number | null };
      try {
        sellerReply = JSON.parse(data.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
      } catch {
        sellerReply = { reply: data.reply, newPrice: null };
      }

      const sellerMsg = {
        role: "seller" as const,
        content: sellerReply.reply ?? data.reply,
        timestamp: Date.now()
      };
      const withSeller = {
        ...updated,
        messages: [...updated.messages, sellerMsg],
        currentPrice: typeof sellerReply.newPrice === "number" ? sellerReply.newPrice : updated.currentPrice
      };
      setNegotiations((prev) =>
        prev.map((n) => (n.sellerId === sellerId ? withSeller : n))
      );
    } catch {
      // silently fail
    }
  };

  const handleAccept = (neg: Negotiation) => {
    setAccepted(neg);
  };

  const handleDecline = (neg: Negotiation) => {
    setNegotiations((prev) =>
      prev.map((n) =>
        n.sellerId === neg.sellerId
          ? { ...n, stage: "withdrawn" as const, agentReasoning: "Declined by buyer." }
          : n
      )
    );
  };

  const handleModifyLogistics = (sellerId: string, meetTime: string, meetPlace: string) => {
    setNegotiations((prev) =>
      prev.map((n) =>
        n.sellerId === sellerId && n.finalOffer
          ? { ...n, finalOffer: { ...n.finalOffer, meetTime, meetPlace } }
          : n
      )
    );
  };

  const handleModifyPrice = (sellerId: string, newTarget: number) => {
    const neg = negotiations.find((n) => n.sellerId === sellerId);
    if (!neg) return;

    const reopened: Negotiation = {
      ...neg,
      stage: "counter_offer",
      currentPrice: newTarget,
      finalOffer: undefined,
      agentReasoning: `Buyer reopened the deal — pushing for $${newTarget}.`,
      messages: [
        ...neg.messages,
        {
          role: "agent_note" as const,
          content: `Reopening negotiation to push the price toward $${newTarget}.`,
          timestamp: Date.now()
        }
      ]
    };

    setNegotiations((prev) =>
      prev.map((n) => (n.sellerId === sellerId ? reopened : n))
    );
    setStep("negotiate");

    // Resume the autonomous loop from the reopened stage so it re-negotiates
    // and reaches a fresh final offer (otherwise the lane would stall here).
    runNegotiationLoop(reopened);
  };

  const activeIndex = STEP_LABELS.findIndex((x) => x.key === step);

  return (
    <main className="min-h-screen bg-paper">
      {/* Top bar */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-base font-semibold tracking-tight text-ink">MRI</span>
          {!accepted && (
            <nav className="flex items-center gap-1">
              {STEP_LABELS.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1">
                  <span
                    className={`text-xs font-medium transition-colors ${
                      step === s.key ? "text-ink" : i < activeIndex ? "text-ink/40" : "text-ink/25"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < STEP_LABELS.length - 1 && (
                    <span className="px-1 text-ink/20">·</span>
                  )}
                </div>
              ))}
            </nav>
          )}
        </div>
      </header>

      <div className="py-10">
        {/* Accepted state */}
        {accepted && (
          <div className="mx-auto max-w-lg px-6 py-16 text-center animate-fadeIn">
            <p className="text-xs font-medium uppercase tracking-widest text-ink/40">
              Deal accepted
            </p>
            <h2 className="mt-4 text-xl font-light tracking-tight text-ink">
              {accepted.listing.title}
            </h2>
            <p className="mt-6 text-5xl font-light tracking-tight text-ink">
              ${accepted.finalOffer?.finalPrice ?? accepted.currentPrice}
            </p>
            {accepted.finalOffer && (
              <p className="mt-6 text-sm text-ink/50">
                Meet {accepted.finalOffer.meetTime} at {accepted.finalOffer.meetPlace}
              </p>
            )}
            <p className="mt-10 text-sm text-ink/40">
              MRI turned a vague buying request into a real deal.
            </p>
          </div>
        )}

        {/* Steps */}
        {!accepted && step === "onboarding" && (
          <OnboardingChat onComplete={handleProfileDone} />
        )}

        {!accepted && step === "searching" && (
          <SearchProgress ready={searchReady} onComplete={handleSearchComplete} />
        )}

        {!accepted && step === "deals" && (
          <DealCards deals={deals} onSelect={handleStartNegotiation} />
        )}

        {!accepted && step === "negotiate" && profile && (
          <NegotiationDashboard
            negotiations={negotiations}
            profile={profile}
            onNegotiationUpdate={handleNegotiationUpdate}
            onSendMessage={handleSendMessage}
          />
        )}

        {!accepted && step === "review" && (
          <FinalOffersReview
            negotiations={negotiations}
            onAccept={handleAccept}
            onDecline={handleDecline}
            onModifyLogistics={handleModifyLogistics}
            onModifyPrice={handleModifyPrice}
          />
        )}
      </div>
    </main>
  );
}
