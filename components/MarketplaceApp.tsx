"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthAccountMenu } from "@/components/auth/AuthAccountMenu";
import { DealCards } from "@/components/DealCards";
import { FinalOffersReview } from "@/components/FinalOffersReview";
import { NegotiationDashboard } from "@/components/NegotiationDashboard";
import { OnboardingChat } from "@/components/OnboardingChat";
import { SearchProgress } from "@/components/SearchProgress";
import { BuyerDealStatus } from "@/components/payments/BuyerDealStatus";
import { CancelDealDialog } from "@/components/payments/CancelDealDialog";
import { CheckoutPanel } from "@/components/payments/CheckoutPanel";
import { DemoHandoffPanel } from "@/components/payments/DemoHandoffPanel";
import { PaymentStatus } from "@/components/payments/PaymentStatus";
import { PaymentSummary } from "@/components/payments/PaymentSummary";
import { fallbackListings, getSellerPersona } from "@/lib/data";
import { findTopDeals } from "@/lib/searchAgent";
import { BuyerProfile, Negotiation, RankedDeal } from "@/lib/types";
import { checkForScam, shouldAutoStop } from "@/lib/scamDetection";
import { formatUsd } from "@/lib/client/format";
import {
  ActiveTransactionRef,
  PublicTransaction,
  TransactionState
} from "@/lib/client/transactionTypes";
import {
  clearActiveTransaction,
  loadActiveTransaction,
  saveActiveTransaction,
  transactionsApi
} from "@/lib/client/transactionsApi";
import { useTransactionPolling } from "@/lib/client/useTransactionPolling";

type Step = "onboarding" | "searching" | "deals" | "negotiate" | "review";

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "onboarding", label: "Profile" },
  { key: "searching", label: "Search" },
  { key: "deals", label: "Deals" },
  { key: "negotiate", label: "Negotiate" },
  { key: "review", label: "Review" }
];

// Post-review flow steps appended to the progress nav once payment begins.
const PAYMENT_NAV_STEPS: { key: string; label: string }[] = [
  { key: "pay", label: "Pay" },
  { key: "meetup", label: "Meetup" },
  { key: "done", label: "Done" }
];

// Browser-side view of the post-negotiation flow. Local-only presentation
// state — `transaction.state` from the server remains authoritative and is
// what drives transitions between the server-backed views.
type PaymentView =
  | "summary"
  | "creating_transaction"
  | "checkout"
  | "processing"
  | "meetup"
  | "complete"
  | "refund"
  | "error";

function viewForState(state: TransactionState): PaymentView {
  switch (state) {
    case "draft":
    case "payment_pending":
    case "payment_failed":
      return "checkout";
    case "funded":
    case "awaiting_confirmation":
    case "release_queued":
      return "meetup";
    case "paid_to_seller":
      return "complete";
    case "refund_queued":
    case "refunded":
    case "canceled":
      return "refund";
    case "needs_attention":
      return "error";
  }
}

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

export function MarketplaceApp({
  accountId,
  accountLabel,
}: {
  accountId: string;
  accountLabel: string;
}) {
  const [step, setStep] = useState<Step>("onboarding");
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [deals, setDeals] = useState<RankedDeal[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  // Holds the in-flight live search so the progress animation can await it.
  const searchPromiseRef = useRef<Promise<RankedDeal[]> | null>(null);
  // True once the live search has actually resolved — gates the "complete" UI.
  const [searchReady, setSearchReady] = useState(false);

  // --- Payment flow state (S1) -------------------------------------------
  const [paymentView, setPaymentView] = useState<PaymentView | null>(null);
  // The negotiation being paid for — only used pre-transaction (summary view).
  const [pendingNeg, setPendingNeg] = useState<Negotiation | null>(null);
  // Persisted pointer {id, buyerToken, sellerUrl}; the only local durable state.
  const [activeTx, setActiveTx] = useState<ActiveTransactionRef | null>(null);
  const [transaction, setTransaction] = useState<PublicTransaction | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const latestTxRef = useRef<PublicTransaction | null>(null);

  const paymentFlowActive = paymentView !== null || activeTx !== null;

  // Accept a fresh server transaction and derive the view from its state.
  const applyTransaction = useCallback((tx: PublicTransaction) => {
    const prev = latestTxRef.current;
    if (
      prev &&
      prev.id === tx.id &&
      new Date(prev.updatedAt).getTime() > new Date(tx.updatedAt).getTime()
    ) {
      return; // stale read — a newer snapshot already applied
    }
    latestTxRef.current = tx;
    setTransaction(tx);
    if (tx.state === "payment_failed") {
      setCheckoutError(
        (msg) => msg ?? "Your payment didn't go through. You haven't been charged — try again."
      );
    }
    setPaymentView((prevView) => {
      // Local-only views advance explicitly, not from polling.
      if (prevView === "summary" || prevView === "creating_transaction") return prevView;
      const next = viewForState(tx.state);
      // A poll that raced the card confirmation may still say "draft" — never
      // fall back from processing unless the payment actually failed.
      if (prevView === "processing" && next === "checkout" && tx.state !== "payment_failed") {
        return prevView;
      }
      return next;
    });
  }, []);

  // Restore an active transaction after refresh (S1). Server state decides
  // which screen the buyer lands on.
  useEffect(() => {
    const ref = loadActiveTransaction(accountId);
    if (ref) setActiveTx(ref);
  }, [accountId]);

  const buyerFetcher = useCallback(() => {
    if (!activeTx) return Promise.reject(new Error("no active transaction"));
    return transactionsApi
      .getTransaction(activeTx.transactionId, activeTx.buyerToken)
      .then((r) => r.transaction);
  }, [activeTx]);

  const polling = useTransactionPolling(activeTx ? buyerFetcher : null);

  useEffect(() => {
    if (polling.transaction) applyTransaction(polling.transaction);
  }, [polling.transaction, applyTransaction]);

  // Start or resume checkout: fetch the client secret whenever we're on the
  // checkout view without one.
  useEffect(() => {
    if (paymentView !== "checkout" || !activeTx || clientSecret) return;
    let disposed = false;
    transactionsApi
      .createPaymentIntent(activeTx.transactionId, activeTx.buyerToken)
      .then((res) => {
        if (disposed) return;
        setClientSecret(res.clientSecret);
        applyTransaction(res.transaction);
      })
      .catch((error) => {
        if (disposed) return;
        setFlowError(
          error instanceof Error ? error.message : "Could not start checkout"
        );
        setPaymentView("error");
      });
    return () => {
      disposed = true;
    };
  }, [paymentView, activeTx, clientSecret, applyTransaction]);

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

  // --- Payment flow handlers (S2–S6) -------------------------------------

  // "Accept & pay": show the final payment summary before creating anything.
  const handleAccept = (neg: Negotiation) => {
    setPendingNeg(neg);
    setPaymentView("summary");
  };

  const handleBackToReview = () => {
    setPendingNeg(null);
    setPaymentView(null);
  };

  // Create the transaction and move to checkout. The server derives the
  // amount from trusted state — the seed object below feeds the mock adapter
  // only and is ignored by the real API.
  const handleConfirmAndPay = async () => {
    const offer = pendingNeg?.finalOffer;
    if (!pendingNeg || !offer) return;
    setPaymentView("creating_transaction");
    try {
      const res = await transactionsApi.createTransaction(pendingNeg.sellerId, {
        listingTitle: offer.bikeTitle || pendingNeg.listing.title,
        sellerDisplayName: pendingNeg.sellerName,
        amountCents: Math.round(offer.finalPrice * 100),
        meetTime: offer.meetTime,
        meetPlace: offer.meetPlace
      });
      const ref: ActiveTransactionRef = {
        transactionId: res.transaction.id,
        buyerToken: res.buyerToken,
        sellerUrl: res.sellerUrl
      };
      saveActiveTransaction(accountId, ref);
      latestTxRef.current = res.transaction;
      setTransaction(res.transaction);
      setActiveTx(ref);
      setPendingNeg(null);
      setPaymentView("checkout");
    } catch (error) {
      setFlowError(
        error instanceof Error ? error.message : "Could not set up the transaction"
      );
      setPaymentView("error");
    }
  };

  const handleBuyerConfirm = async () => {
    if (!activeTx || confirming) return;
    setConfirming(true);
    try {
      const res = await transactionsApi.confirmTransaction(
        activeTx.transactionId,
        activeTx.buyerToken
      );
      applyTransaction(res.transaction);
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Could not confirm");
    } finally {
      setConfirming(false);
    }
  };

  const handleBuyerCancel = async () => {
    if (!activeTx || canceling) return;
    setCanceling(true);
    try {
      const res = await transactionsApi.cancelTransaction(
        activeTx.transactionId,
        activeTx.buyerToken
      );
      applyTransaction(res.transaction);
      setCancelOpen(false);
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Could not cancel");
      setCancelOpen(false);
    } finally {
      setCanceling(false);
    }
  };

  // Full reset after a terminal state — clears the stored pointer and starts
  // a fresh buying session.
  const handleStartNew = () => {
    clearActiveTransaction(accountId);
    latestTxRef.current = null;
    setActiveTx(null);
    setTransaction(null);
    setClientSecret(null);
    setPaymentView(null);
    setPendingNeg(null);
    setCheckoutError(null);
    setFlowError(null);
    setConfirming(false);
    setCanceling(false);
    setCancelOpen(false);
    setNegotiations([]);
    setDeals([]);
    setProfile(null);
    setSearchReady(false);
    setStep("onboarding");
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

  // --- Progress nav -------------------------------------------------------
  const navItems: { key: string; label: string }[] = paymentFlowActive
    ? [...STEP_LABELS, ...PAYMENT_NAV_STEPS]
    : STEP_LABELS;
  const activeNavKey = paymentFlowActive
    ? paymentView === "meetup"
      ? "meetup"
      : paymentView === "complete" || paymentView === "refund"
        ? "done"
        : "pay"
    : step;
  const activeNavIndex = navItems.findIndex((x) => x.key === activeNavKey);

  // Demo seller link is shown from transaction creation through the meetup.
  const showHandoffPanel =
    activeTx !== null &&
    (paymentView === "checkout" || paymentView === "processing" || paymentView === "meetup");

  return (
    <main className="min-h-screen bg-mist">
      {/* Top bar */}
      <header className="border-b border-line bg-paper shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-fb text-base font-bold text-white">
              S
            </span>
            <span className="text-xl font-bold tracking-tight text-ink">
              SOLID <span className="font-normal text-ink/40">Marketplace</span>
            </span>
          </div>
          <div className="flex items-center">
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1">
                  <span
                    className={`text-xs font-medium transition-colors ${
                      activeNavKey === s.key
                        ? "text-ink"
                        : i < activeNavIndex
                          ? "text-ink/40"
                          : "text-ink/25"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < navItems.length - 1 && <span className="px-1 text-ink/20">·</span>}
                </div>
              ))}
            </nav>
            <AuthAccountMenu accountId={accountId} label={accountLabel} />
          </div>
        </div>
      </header>

      <div className="py-10">
        {/* ---- Payment flow (post-review) ---- */}
        {paymentFlowActive && (
          <div className="mx-auto max-w-lg px-6">
            {polling.networkIssue && (
              <p className="mb-6 rounded-md border border-line bg-mist px-4 py-2.5 text-center text-xs text-ink/60">
                Connection issue — retrying. This says nothing about your payment;
                the status shown is the last one confirmed by the server.
              </p>
            )}

            {paymentView === "summary" && pendingNeg && (
              <PaymentSummary
                negotiation={pendingNeg}
                busy={false}
                onConfirm={handleConfirmAndPay}
                onBack={handleBackToReview}
              />
            )}

            {paymentView === "creating_transaction" && (
              <PaymentStatus
                title="Setting up your secure payment…"
                detail="Creating the transaction and locking in the agreed price."
                waiting
              />
            )}

            {paymentView === "checkout" && transaction && (
              <CheckoutPanel
                transaction={transaction}
                clientSecret={clientSecret}
                errorMessage={checkoutError}
                onClientConfirmed={() => {
                  setCheckoutError(null);
                  setPaymentView("processing");
                }}
                onFailure={(message) => setCheckoutError(message)}
              />
            )}

            {paymentView === "processing" && (
              <PaymentStatus
                title="Confirming your payment…"
                detail="Waiting for the payment to be confirmed server-side. This usually takes a few seconds."
                waiting
              />
            )}

            {paymentView === "meetup" && transaction && (
              <BuyerDealStatus
                transaction={transaction}
                confirming={confirming}
                canceling={canceling}
                onConfirm={handleBuyerConfirm}
                onCancelRequest={() => setCancelOpen(true)}
              />
            )}

            {paymentView === "complete" && transaction && (
              <PaymentStatus
                title="Deal complete — payment released to seller"
                detail={`${transaction.listingTitle} · ${formatUsd(transaction.amountCents)} paid to ${transaction.sellerDisplayName}.`}
                tone="positive"
              >
                <button
                  onClick={handleStartNew}
                  className="rounded-md bg-steel px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-line"
                >
                  Start a new search
                </button>
              </PaymentStatus>
            )}

            {paymentView === "refund" &&
              transaction &&
              (transaction.state === "refunded" ? (
                <PaymentStatus
                  title="Refunded"
                  detail={`The full ${formatUsd(transaction.amountCents)} payment has been refunded to your original payment method.`}
                  tone="positive"
                >
                  <button
                    onClick={handleStartNew}
                    className="rounded-md bg-steel px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-line"
                  >
                    Start a new search
                  </button>
                </PaymentStatus>
              ) : transaction.state === "canceled" ? (
                <PaymentStatus
                  title="Deal canceled"
                  detail="This deal was canceled before payment — nothing was charged."
                >
                  <button
                    onClick={handleStartNew}
                    className="rounded-md bg-steel px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-line"
                  >
                    Start a new search
                  </button>
                </PaymentStatus>
              ) : (
                <PaymentStatus
                  title="Full refund initiated"
                  detail={`The full ${formatUsd(transaction.amountCents)} payment is being refunded to your original payment method.`}
                  waiting
                />
              ))}

            {paymentView === "error" && (
              <PaymentStatus
                title="This deal needs a quick check"
                detail={
                  flowError ??
                  "Something on our side needs a manual look. Your payment is safe — refresh to get the latest status."
                }
              >
                <div className="flex justify-center gap-2">
                  {activeTx ? (
                    <button
                      onClick={polling.refresh}
                      className="rounded-md bg-steel px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-line"
                    >
                      Refresh status
                    </button>
                  ) : (
                    <button
                      onClick={handleBackToReview}
                      className="rounded-md bg-steel px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-line"
                    >
                      Back to offers
                    </button>
                  )}
                </div>
              </PaymentStatus>
            )}

            {/* Restoring after refresh — waiting for the first server read */}
            {paymentView === null && activeTx && (
              <PaymentStatus
                title="Restoring your deal…"
                detail="Fetching the latest status from the server."
                waiting
              />
            )}

            {showHandoffPanel && activeTx && (
              <DemoHandoffPanel sellerUrl={activeTx.sellerUrl} />
            )}

            {cancelOpen && transaction && (
              <CancelDealDialog
                amountLabel={formatUsd(transaction.amountCents)}
                perspective="buyer"
                busy={canceling}
                onConfirm={handleBuyerCancel}
                onClose={() => setCancelOpen(false)}
              />
            )}
          </div>
        )}

        {/* ---- Pre-payment steps ---- */}
        {!paymentFlowActive && step === "onboarding" && (
          <OnboardingChat onComplete={handleProfileDone} />
        )}

        {!paymentFlowActive && step === "searching" && (
          <SearchProgress ready={searchReady} onComplete={handleSearchComplete} />
        )}

        {!paymentFlowActive && step === "deals" && (
          <DealCards deals={deals} onSelect={handleStartNegotiation} />
        )}

        {!paymentFlowActive && step === "negotiate" && profile && (
          <NegotiationDashboard
            negotiations={negotiations}
            profile={profile}
            onNegotiationUpdate={handleNegotiationUpdate}
            onSendMessage={handleSendMessage}
          />
        )}

        {!paymentFlowActive && step === "review" && (
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
