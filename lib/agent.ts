// MRI v3 — autonomous simulated negotiation engine.
//
// N11: runNegotiation async loop + startAll parallel execution
// N12: seller persona generation from live listings (persona_from_listing)
// N13: offer evaluation (evaluate_offer) + stage progression rules
// N14: modify_logistics and reopen_counter for post-negotiation changes
//
// Runs in the browser. Each negotiation ticks independently; the dashboard
// re-renders whenever a lane emits an update.

import { personaFromTemplate } from "@/lib/data";
import {
  AgentMove,
  BuyerProfile,
  FinalOffer,
  Listing,
  Message,
  Negotiation,
  NegotiationStage,
  OfferVerdict,
  RankedDeal,
  SellerPersona,
  SellerReply,
} from "@/lib/types";
import { checkForScam, shouldAutoStop } from "@/lib/scamDetection";

const MAX_TURNS = 8; // safety cap so a lane always reaches a terminal stage

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function now() {
  return Date.now();
}

function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

async function callApi<T>(
  mode: string,
  messages: Message[] | Array<{ role: string; content: string }>,
  context: Record<string, unknown>
): Promise<T | null> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, messages, context }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { reply?: string };
    return extractJson<T>(data.reply ?? "");
  } catch {
    return null;
  }
}

// Emit a shallow clone so React state consumers see a new reference.
function emit(neg: Negotiation, onUpdate: (n: Negotiation) => void) {
  onUpdate({ ...neg, messages: [...neg.messages], persona: { ...neg.persona } });
}

// --- N12: persona generation + negotiation construction ---------------------

// Generate a simulated seller persona from a live listing. Tries the LLM
// (persona_from_listing); falls back to a deterministic template so the three
// lanes still demonstrate distinct behaviors (easy / firm / condition issue).
export async function buildPersona(
  listing: Listing,
  profile: BuyerProfile,
  index = 0
): Promise<SellerPersona> {
  const llm = await callApi<SellerPersona>("persona_from_listing", [], { listing, profile });
  if (
    llm &&
    typeof llm.priceFloor === "number" &&
    llm.name &&
    llm.concessionPattern
  ) {
    // Guard: floor must never exceed listing price.
    return { ...llm, priceFloor: Math.min(llm.priceFloor, listing.price) };
  }
  return personaFromTemplate(listing, index);
}

// Build the three negotiations from the confirmed ranked deals. Indexing keeps
// the demo personas distinct across lanes.
export async function createNegotiations(
  deals: RankedDeal[],
  profile: BuyerProfile
): Promise<Negotiation[]> {
  return Promise.all(
    deals.map(async (deal, index) => {
      const persona = await buildPersona(deal.listing, profile, index);
      const negotiation: Negotiation = {
        sellerId: deal.listing.id,
        sellerName: persona.name,
        listing: deal.listing,
        messages: [],
        stage: "outreach",
        currentPrice: deal.listing.price,
        agentReasoning: "Preparing to reach out.",
        persona,
        userTookOver: false,
      };
      return negotiation;
    })
  );
}

// --- N13: offer evaluation --------------------------------------------------

export async function evaluateOffer(
  neg: Negotiation,
  profile: BuyerProfile
): Promise<OfferVerdict> {
  const llm = await callApi<OfferVerdict>("evaluate_offer", neg.messages, {
    negotiation: neg,
    profile,
  });
  if (llm && llm.verdict) return llm;

  // Deterministic fallback applying the buyer's hard limits.
  if (neg.currentPrice <= profile.autoAcceptThreshold) {
    return { verdict: "accept", reasoning: "At or below auto-accept threshold." };
  }
  if (neg.currentPrice > profile.walkAwayPrice) {
    return { verdict: "walk_away", reasoning: "Above the buyer's walk-away price." };
  }
  return { verdict: "continue", reasoning: "Within range — keep negotiating." };
}

// Build the final offer card from the negotiation state.
function extractFinalOffer(neg: Negotiation, profile: BuyerProfile): FinalOffer {
  // Pull any seller-mentioned extras heuristically.
  const sellerText = neg.messages
    .filter((m) => m.role === "seller")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const extras: string[] = [];
  if (/case|charger|cable|screen protector|airpods|applecare|earbuds|adapter|box/i.test(sellerText)) {
    if (/case/i.test(sellerText)) extras.push("case");
    if (/charger|cable/i.test(sellerText)) extras.push("charging cable");
    if (/screen protector/i.test(sellerText)) extras.push("screen protector");
    if (/airpods|earbuds/i.test(sellerText)) extras.push("earbuds");
    if (/applecare/i.test(sellerText)) extras.push("AppleCare+");
    if (/original box|box/i.test(sellerText)) extras.push("original box");
  }

  return {
    listingId: neg.listing.id,
    sellerName: neg.sellerName,
    bikeTitle: neg.listing.title,
    finalPrice: neg.currentPrice,
    meetTime: profile.meetWindows || "this weekend",
    meetPlace: "Powell Station, SF",
    extras,
    notes: neg.agentReasoning,
  };
}

// --- N11: the negotiation loop ----------------------------------------------

// Pause cooperatively while the buyer has taken over this lane.
async function waitForUserAction(neg: Negotiation) {
  while (neg.userTookOver) {
    await sleep(500);
  }
}

function isTerminal(stage: NegotiationStage) {
  return stage === "final_offer" || stage === "withdrawn" || stage === "scam_detected";
}

export async function runNegotiation(
  neg: Negotiation,
  profile: BuyerProfile,
  onUpdate: (n: Negotiation) => void
) {
  let turns = 0;

  while (!isTerminal(neg.stage) && turns < MAX_TURNS) {
    if (neg.userTookOver) {
      await waitForUserAction(neg);
      continue;
    }
    turns++;

    // 1. Agent decides its next move.
    const move = await callApi<AgentMove>("agent_turn", neg.messages, {
      negotiation: neg,
      profile,
    });
    if (!move) break;

    neg.messages.push({ role: "buyer", content: move.message, timestamp: now() });
    neg.messages.push({ role: "agent_note", content: move.reasoning, timestamp: now() });
    neg.stage = move.newStage;
    if (typeof move.currentPrice === "number" && move.currentPrice > 0) {
      neg.currentPrice = move.currentPrice;
    }
    neg.agentReasoning = move.reasoning;

    // N13: before locking a final offer, validate against buyer authority.
    if (neg.stage === "final_offer") {
      const verdict = await evaluateOffer(neg, profile);
      if (verdict.verdict === "walk_away") {
        neg.stage = "withdrawn";
        neg.agentReasoning = verdict.reasoning;
        neg.messages.push({
          role: "agent_note",
          content: `Walking away: ${verdict.reasoning}`,
          timestamp: now(),
        });
      }
    }

    emit(neg, onUpdate);
    if (isTerminal(neg.stage)) break;

    // 2. Simulated seller responds (jittered to feel live).
    await sleep(1500 + Math.random() * 1500);
    if (neg.userTookOver) continue;

    const reply = await callApi<SellerReply>("seller", neg.messages, {
      negotiation: neg,
      persona: neg.persona,
    });
    if (reply) {
      neg.messages.push({ role: "seller", content: reply.reply, timestamp: now() });
      if (typeof reply.newPrice === "number" && reply.newPrice > 0) {
        neg.currentPrice = reply.newPrice;
      }
      emit(neg, onUpdate);

      // Scam check after every seller reply
      const scamAlert = await checkForScam(neg);
      if (scamAlert) {
        neg.scamAlert = scamAlert;
        if (shouldAutoStop(scamAlert)) {
          neg.stage = "scam_detected";
          neg.agentReasoning = scamAlert.summary;
          neg.messages.push({
            role: "agent_note",
            content: `Scam detected: ${scamAlert.summary}`,
            timestamp: now(),
          });
          emit(neg, onUpdate);
          return;
        }
        // Medium/low: warn but continue
        neg.messages.push({
          role: "agent_note",
          content: `Caution: ${scamAlert.summary}`,
          timestamp: now(),
        });
        emit(neg, onUpdate);
      }
    }

    await sleep(1000);
  }

  // Reached the turn cap without resolving → settle into a final offer.
  if (!isTerminal(neg.stage)) {
    neg.stage = "final_offer";
  }

  if (neg.stage === "final_offer") {
    neg.finalOffer = extractFinalOffer(neg, profile);
  }
  emit(neg, onUpdate);
}

// Kick off all three negotiations in parallel — no shared lock.
export function startAll(
  negotiations: Negotiation[],
  profile: BuyerProfile,
  onUpdate: (n: Negotiation) => void
) {
  negotiations.forEach((neg) => {
    void runNegotiation(neg, profile, onUpdate);
  });
}

// --- N14: post-negotiation changes ------------------------------------------

// Modify only the logistics (meet time/place); price stays the same. Sends a
// confirmation message to the simulated seller and waits for an ack.
export async function modifyLogistics(
  neg: Negotiation,
  changes: {
    originalMeetTime?: string;
    originalMeetPlace?: string;
    newMeetTime?: string;
    newMeetPlace?: string;
  },
  onUpdate: (n: Negotiation) => void
): Promise<Negotiation> {
  const msg = await callApi<{ message: string }>("modify_logistics", neg.messages, {
    negotiation: neg,
    changes,
  });
  const message =
    msg?.message ??
    `Quick change — could we meet ${changes.newMeetTime ?? ""} at ${changes.newMeetPlace ?? ""}? Everything else stays the same.`;

  neg.messages.push({ role: "buyer", content: message, timestamp: now() });

  // Simulated seller ack.
  await sleep(1200);
  const ack = await callApi<SellerReply>("seller", neg.messages, {
    negotiation: neg,
    persona: neg.persona,
  });
  neg.messages.push({
    role: "seller",
    content: ack?.reply ?? "Works for me, see you then!",
    timestamp: now(),
  });

  if (neg.finalOffer) {
    neg.finalOffer = {
      ...neg.finalOffer,
      meetTime: changes.newMeetTime || neg.finalOffer.meetTime,
      meetPlace: changes.newMeetPlace || neg.finalOffer.meetPlace,
    };
  }
  emit(neg, onUpdate);
  return neg;
}

// Reopen price negotiation: flip the lane back to counter_offer at a new target
// and let the agent loop re-engage.
export async function reopenCounter(
  neg: Negotiation,
  profile: BuyerProfile,
  newTarget: number,
  onUpdate: (n: Negotiation) => void
): Promise<Negotiation> {
  const counter = await callApi<{ message: string; reasoning: string }>(
    "reopen_counter",
    neg.messages,
    { negotiation: neg, newTarget }
  );

  neg.stage = "counter_offer";
  neg.finalOffer = undefined;
  neg.agentReasoning =
    counter?.reasoning ?? `Re-engaging the seller to push toward $${newTarget}.`;
  neg.messages.push({
    role: "buyer",
    content: counter?.message ?? `Circling back — could you do $${newTarget}?`,
    timestamp: now(),
  });
  neg.messages.push({ role: "agent_note", content: neg.agentReasoning, timestamp: now() });
  emit(neg, onUpdate);

  // Resume the autonomous loop from the reopened stage.
  void runNegotiation(neg, profile, onUpdate);
  return neg;
}
