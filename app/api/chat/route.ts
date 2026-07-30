// MRI v3 — single mode-switched chat route.
// All inference goes through NVIDIA Nemotron 3 Ultra on GMI Cloud via the
// OpenAI-compatible chat completions API. If no key is configured (or the call
// fails), we return a deterministic fallback so local dev + the demo survive.

import OpenAI from "openai";
import {
  ONBOARDING_PROMPT,
  agentTurnPrompt,
  evaluatePrompt,
  modifyLogisticsPrompt,
  normalizeListingPrompt,
  personaFromListingPrompt,
  queryPlannerPrompt,
  rankingPrompt,
  reopenCounterPrompt,
  scamCheckPrompt,
  sellerPrompt,
} from "@/lib/prompts";
import {
  BuyerProfile,
  ChatMode,
  Listing,
  MarketplaceRawListing,
  Negotiation,
  SellerPersona,
} from "@/lib/types";

interface ChatRequestBody {
  mode: ChatMode;
  messages: Array<{ role: string; content: string }>;
  context?: {
    profile?: BuyerProfile;
    rawListing?: MarketplaceRawListing;
    listing?: Listing;
    listings?: Listing[];
    negotiation?: Negotiation;
    persona?: SellerPersona;
    changes?: Record<string, string>;
    newTarget?: number;
  };
}

const MODEL = process.env.GMI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";

// GMI Cloud Model Hub is OpenAI-compatible. Base URL gets `/v1` appended.
const client =
  process.env.GMI_API_KEY && process.env.GMI_API_BASE_URL
    ? new OpenAI({
        baseURL: `${process.env.GMI_API_BASE_URL}/v1`,
        apiKey: process.env.GMI_API_KEY,
      })
    : null;

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequestBody;
  const { mode, messages, context } = body;

  let systemPrompt: string;
  switch (mode) {
    case "onboarding":
      systemPrompt = ONBOARDING_PROMPT;
      break;
    case "query_plan":
      systemPrompt = queryPlannerPrompt(context!.profile as BuyerProfile);
      break;
    case "normalize_listing":
      systemPrompt = normalizeListingPrompt(context!.rawListing as MarketplaceRawListing);
      break;
    case "rank":
      systemPrompt = rankingPrompt(context!.profile as BuyerProfile, context!.listings ?? []);
      break;
    case "persona_from_listing":
      systemPrompt = personaFromListingPrompt(
        context!.listing as Listing,
        context!.profile as BuyerProfile
      );
      break;
    case "agent_turn":
      systemPrompt = agentTurnPrompt(
        context!.negotiation as Negotiation,
        context!.profile as BuyerProfile
      );
      break;
    case "seller":
      systemPrompt = sellerPrompt(
        context!.negotiation as Negotiation,
        context!.persona as SellerPersona
      );
      break;
    case "evaluate_offer":
      systemPrompt = evaluatePrompt(
        context!.negotiation as Negotiation,
        context!.profile as BuyerProfile
      );
      break;
    case "modify_logistics":
      systemPrompt = modifyLogisticsPrompt(
        context!.negotiation as Negotiation,
        context!.changes ?? {}
      );
      break;
    case "reopen_counter":
      systemPrompt = reopenCounterPrompt(
        context!.negotiation as Negotiation,
        context!.newTarget ?? 0
      );
      break;
    case "scam_check":
      systemPrompt = scamCheckPrompt(context!.negotiation as Negotiation);
      break;
    default:
      return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Higher temperature for character/creative modes, low for structured ones.
  const temperature = mode === "seller" || mode === "persona_from_listing" ? 0.7 : 0.2;

  if (!client) {
    return Response.json({ reply: fallbackReply(mode, context, messages) });
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1000,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizeMessages(messages ?? []),
      ],
    });
    const text = response.choices[0]?.message?.content || "";
    return Response.json({ reply: text });
  } catch (err) {
    console.error("[/api/chat] GMI call failed, using fallback:", err);
    return Response.json({ reply: fallbackReply(mode, context, messages) });
  }
}

function normalizeMessages(
  messages: Array<{ role: string; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages.map((msg) => ({
    role:
      msg.role === "assistant" || msg.role === "seller" || msg.role === "system"
        ? "assistant"
        : "user",
    content: msg.content,
  }));
}

// Deterministic fallbacks so the demo never hard-fails without GMI keys.
function fallbackReply(
  mode: ChatMode,
  context?: ChatRequestBody["context"],
  messages?: Array<{ role: string; content: string }>
): string {
  switch (mode) {
    case "onboarding": {
      // Count user messages to decide which question we're on
      const userMsgs = (messages ?? []).filter((m) => m.role === "user");
      const turn = userMsgs.length;
      const lastMsg = userMsgs[userMsgs.length - 1]?.content ?? "";

      if (turn <= 1) {
        // User just said what they want — ask location
        const item = lastMsg.length > 50 ? lastMsg.slice(0, 50) + "..." : lastMsg;
        return `Nice, ${item} is a solid pick! I know the market for those pretty well. Where are you located? I'll search nearby listings so you don't have to drive across town.`;
      }
      if (turn === 2) {
        // User gave location — ask budget
        return `${lastMsg} — got it, I'll focus the search there. One more thing: what's your budget? Like, what's the most you'd want to spend? I'll make sure I only surface deals that make sense.`;
      }
      if (turn === 3) {
        // User gave budget — ask meet availability
        const budgetClean = lastMsg.replace(/[^0-9]/g, "") || lastMsg;
        return `$${budgetClean}, perfect. I'll filter out anything above that. Last thing — when are you usually free to meet up with a seller? Weekday evenings, weekends, flexible? Just so I can factor that into the deal.`;
      }
      // turn >= 4: all answers collected — return profile JSON
      const item = userMsgs[0]?.content ?? "iPhone";
      const location = userMsgs[1]?.content ?? "San Francisco, CA";
      const budgetRaw = userMsgs[2]?.content ?? "800";
      const budget = parseInt(budgetRaw.replace(/[^0-9]/g, ""), 10) || 800;
      const meetWindows = userMsgs[3]?.content ?? "weekends";

      return JSON.stringify({
        bikeType: item,
        frameSize: "",
        budgetMin: 0,
        budgetMax: budget,
        preferences: "",
        location,
        searchRadiusKm: 25,
        walkAwayPrice: budget,
        autoAcceptThreshold: Math.round(budget * 0.8),
        deadline: "no rush",
        meetRadius: 10,
        meetWindows,
        nonNegotiables: [],
      });
    }

    case "query_plan": {
      const p = context?.profile;
      return JSON.stringify({
        location: p?.location ?? "San Francisco, CA",
        radiusKm: p?.searchRadiusKm ?? 25,
        minPrice: p?.budgetMin ?? 0,
        maxPrice: p?.budgetMax ?? 1200,
        queries: [p?.bikeType ?? "iPhone 15 Pro", "iPhone used", "iPhone for sale"],
        includeTerms: [p?.bikeType ?? "iPhone", p?.frameSize ?? ""].filter(Boolean),
        excludeTerms: ["broken", "parts only", "iCloud locked", "cracked"],
        condition: "used",
        dateListed: "last_7_days",
        countPerQuery: 20,
      });
    }

    case "normalize_listing": {
      const r = context?.rawListing;
      return JSON.stringify({
        title: r?.title ?? "iPhone",
        price: r?.price ?? 0,
        fairValue: Math.round((r?.price ?? 0) * 1.3),
        specs: "",
        description: r?.description ?? "",
        riskFlags: [],
      });
    }

    case "rank": {
      const listings = context?.listings ?? [];
      const ranked = listings.slice(0, 3).map((l, i) => ({
        listingId: l.id,
        score: Math.max(55, 88 - i * 12),
        dealQuality: (i === 0 ? "great" : i === 1 ? "good" : "fair") as "great" | "good" | "fair",
        valueScore: 80 - i * 8,
        relevanceScore: 82 - i * 6,
        conditionScore: 70,
        distanceScore: 75,
        riskScore: 85 - (l.riskFlags?.length ?? 0) * 15,
        summary: `${l.title} at $${l.price}${
          l.riskFlags?.length ? ` — note: ${l.riskFlags[0]}` : " — solid match for your request."
        }`,
        suggestedFirstOffer: Math.round(l.price * 0.85),
        maxRecommendedPrice: Math.round(l.price * 0.98),
      }));
      return JSON.stringify(ranked);
    }

    case "persona_from_listing": {
      const l = context?.listing;
      return JSON.stringify({
        name: "Marketplace Seller",
        style: "friendly and responsive",
        priceFloor: Math.round((l?.price ?? 100) * 0.8),
        hiddenInfo: "prefers a quick local pickup",
        concessionPattern: "easy_drop",
      });
    }

    case "agent_turn": {
      const neg = context?.negotiation;
      const prof = context?.profile;
      const stage = neg?.stage ?? "outreach";
      const listingPrice = neg?.listing?.price ?? 100;
      const sellerPrice = neg?.currentPrice ?? listingPrice;
      const buyerMsgs = neg?.messages?.filter((m: { role: string }) => m.role === "buyer").length ?? 0;
      const autoAccept = prof?.autoAcceptThreshold ?? Math.round(listingPrice * 0.8);
      const meetWindows = prof?.meetWindows ?? "this weekend";
      const itemTitle = neg?.listing?.title ?? "the item";
      const sellerName = neg?.sellerName ?? "the seller";

      const offers = [
        Math.round(listingPrice * 0.82),
        Math.round(listingPrice * 0.85),
        Math.round(listingPrice * 0.88),
      ];

      if (stage === "outreach" || buyerMsgs === 0) {
        return JSON.stringify({
          message: `Hey there! Saw your listing for the ${itemTitle} — looks great. I've been looking for one like this. Any chance you'd consider $${offers[0]}? I'm local and can come grab it whenever works for you.`,
          newStage: "price_discovery",
          currentPrice: offers[0],
          reasoning: `Opening at $${offers[0]} (~18% below asking) to test ${sellerName}'s flexibility.`,
        });
      }

      if (sellerPrice <= autoAccept) {
        return JSON.stringify({
          message: `That price works for me! I'm free ${meetWindows} — want to meet at Powell Station? I'll have cash ready.`,
          newStage: "final_offer",
          currentPrice: sellerPrice,
          reasoning: `$${sellerPrice} is at or below our auto-accept threshold ($${autoAccept}). Closing the deal.`,
        });
      }

      if (stage === "price_discovery" || buyerMsgs === 1) {
        const midpoint = Math.round((offers[0] + sellerPrice) / 2);
        const offer = Math.min(midpoint, offers[1]);
        return JSON.stringify({
          message: `I hear you, that's fair — it's clearly been well taken care of. Could we meet around $${offer}? I can be flexible on pickup timing, happy to work around your schedule.`,
          newStage: "condition_qa",
          currentPrice: offer,
          reasoning: `Splitting the gap between my $${offers[0]} and ${sellerName}'s $${sellerPrice}. Building rapport before condition questions.`,
        });
      }

      if (stage === "condition_qa" || buyerMsgs === 2) {
        return JSON.stringify({
          message: `Quick question before we finalize — how's the battery health looking? And has anything been repaired or replaced? Just want to know what I'm getting so there's no surprises.`,
          newStage: "counter_offer",
          currentPrice: sellerPrice,
          reasoning: `Asking about battery health and repair history. If there are issues, we have leverage to push the price down further.`,
        });
      }

      if (buyerMsgs === 3) {
        const finalOffer = Math.min(offers[2], sellerPrice - 1);
        return JSON.stringify({
          message: `Appreciate the honesty! Given everything, I think $${finalOffer} is a fair number for both of us. I can meet at Powell Station ${meetWindows} — does that work?`,
          newStage: "logistics",
          currentPrice: finalOffer,
          reasoning: `Firm final counter at $${finalOffer}. Anchoring to Powell Station for the meetup to close things out.`,
        });
      }

      const walkAway = prof?.walkAwayPrice ?? listingPrice;
      if (sellerPrice <= walkAway) {
        const closingPrice = Math.min(Math.round((offers[2] + sellerPrice) / 2), sellerPrice);
        return JSON.stringify({
          message: `Alright let's do $${closingPrice} and call it done. I'm good for ${meetWindows} at Powell Station. See you there?`,
          newStage: "final_offer",
          currentPrice: closingPrice,
          reasoning: `Closing at $${closingPrice} — saved $${listingPrice - closingPrice} off asking. Deal locked.`,
        });
      }

      return JSON.stringify({
        message: `Hey, I appreciate you going back and forth with me on this. Unfortunately $${sellerPrice} is a bit more than I can swing right now. If you change your mind, feel free to reach out. Good luck with the sale!`,
        newStage: "withdrawn",
        currentPrice: sellerPrice,
        reasoning: `$${sellerPrice} is above our walk-away limit ($${walkAway}). Exiting gracefully.`,
      });
    }

    case "seller": {
      const persona = context?.persona;
      const neg = context?.negotiation;
      const floor = persona?.priceFloor ?? Math.round((neg?.listing?.price ?? 100) * 0.8);
      const listingP = neg?.listing?.price ?? 100;
      const current = neg?.currentPrice ?? listingP;
      const sellerMsgs = neg?.messages?.filter((m: { role: string }) => m.role === "seller").length ?? 0;
      const name = persona?.name ?? "Seller";

      const isScammy = persona?.style?.includes("off-platform") || persona?.style?.includes("upfront payment");
      if (isScammy) {
        const scamPrice = Math.max(floor, Math.round(current * 0.95));
        const scamReplies = [
          { reply: `Hey yeah $${scamPrice} would work. Only thing is I've had people flake on me before so can you send a $50 deposit through Venmo? Just to hold it. I'll take it off the price when you pick up.`, newPrice: scamPrice },
          { reply: `Actually I'm super busy this week so I can just ship it to you. Way easier for both of us. Just send payment through CashApp and I'll get it out tomorrow.`, newPrice: scamPrice },
          { reply: `Look I really can't do meetups right now, just pay through Zelle and I'll drop it off at your door. It's in perfect condition trust me, you won't be disappointed.`, newPrice: scamPrice },
        ];
        return JSON.stringify(scamReplies[Math.min(sellerMsgs, scamReplies.length - 1)]);
      }

      const pattern = persona?.concessionPattern ?? "easy_drop";

      if (sellerMsgs === 0) {
        if (pattern === "firm_price") {
          return JSON.stringify({
            reply: `Hey! Thanks for the interest. I've gotten a few messages about this one already. I'd really like to stay at $${listingP} — it's priced to sell honestly. Battery is at 95% and zero scratches.`,
            newPrice: listingP,
          });
        }
        if (pattern === "condition_issue") {
          const slight = Math.round(listingP * 0.95);
          return JSON.stringify({
            reply: `Hey thanks for reaching out! I could come down a bit, how about $${slight}? It's been in a case since day one, runs perfectly.`,
            newPrice: slight,
          });
        }
        const drop1 = Math.max(floor, Math.round(listingP * 0.9));
        return JSON.stringify({
          reply: `Hey! Yeah I've been looking to sell this quick honestly. That offer's a little low but I could probably do $${drop1} if you can grab it soon. Trying to upgrade this weekend.`,
          newPrice: drop1,
        });
      }

      if (sellerMsgs === 1) {
        if (pattern === "firm_price") {
          const budge = Math.max(floor, Math.round(listingP * 0.93));
          return JSON.stringify({
            reply: `Hmm I really don't want to go below $${budge}. I just saw similar ones going for more on Swappa. I'm including the original box and a case too. That's pretty solid for what you're getting.`,
            newPrice: budge,
          });
        }
        if (pattern === "condition_issue") {
          return JSON.stringify({
            reply: `So I should mention — the screen was replaced about 6 months ago. I dropped it and got it fixed at a repair shop downtown. Display looks perfect, no issues at all. But that's partly why I'm willing to negotiate on the price.`,
            newPrice: current,
          });
        }
        const drop2 = Math.max(floor, Math.round(current * 0.95));
        return JSON.stringify({
          reply: `Haha you're good at this! Okay look — $${drop2} and you pick up this week. That's really the lowest I want to go. It's barely been used.`,
          newPrice: drop2,
        });
      }

      if (sellerMsgs === 2) {
        if (pattern === "firm_price") {
          const meet = Math.max(floor, Math.round((current + floor) / 2));
          return JSON.stringify({
            reply: `Okay final offer from my side — $${meet}. I'll include the original box, cable, and a MagSafe case I bought separately. That's easily $40 worth of extras. Can't go lower than that.`,
            newPrice: meet,
          });
        }
        const almostFloor = Math.max(floor, Math.round(floor * 1.05));
        return JSON.stringify({
          reply: `Alright $${almostFloor} is genuinely the lowest I can go. Battery health is still at 92%, no iCloud issues, fully unlocked. It's a solid phone for that price. What do you think?`,
          newPrice: almostFloor,
        });
      }

      if (sellerMsgs === 3) {
        return JSON.stringify({
          reply: `Yeah that works for me. Powell Station sounds good — just text me when you're heading over and I'll be there. Cash works best.`,
          newPrice: current,
        });
      }

      return JSON.stringify({
        reply: `Sounds good ${name === "Marketplace Seller" ? "" : "— " + name}! See you there. I'll have it charged up and ready to go so you can check everything out.`,
        newPrice: current,
      });
    }

    case "evaluate_offer": {
      const neg = context?.negotiation;
      const profile = context?.profile;
      const price = neg?.currentPrice ?? 0;
      const verdict =
        profile && price <= profile.autoAcceptThreshold
          ? "accept"
          : profile && price > profile.walkAwayPrice
            ? "walk_away"
            : "continue";
      return JSON.stringify({
        verdict,
        reasoning: `Current price $${price} vs walk-away $${profile?.walkAwayPrice ?? "?"}.`,
      });
    }

    case "modify_logistics":
      return JSON.stringify({
        message: "Quick change on my end — could we adjust the meet time/place? Everything else stays the same.",
      });

    case "reopen_counter": {
      const target = context?.newTarget ?? 0;
      return JSON.stringify({
        message: `Circling back — could you do $${target}? I'm ready to close this week.`,
        reasoning: "Re-engaging with a firm but friendly counter at the buyer's new target.",
      });
    }

    case "scam_check":
      return JSON.stringify({
        isScam: false,
        severity: "low",
        flags: [],
        summary: "",
      });

    default:
      return "{}";
  }
}
