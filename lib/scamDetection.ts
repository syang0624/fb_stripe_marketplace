// Scam detection engine — runs after each seller reply during negotiation.
// Two layers: fast pattern matching (zero-latency) + optional LLM deep check.

import { Message, Negotiation, ScamAlert } from "@/lib/types";

// --- Pattern-based detection (instant, no API call) -------------------------

interface PatternRule {
  pattern: RegExp;
  flag: string;
  severity: "high" | "medium" | "low";
}

const SCAM_PATTERNS: PatternRule[] = [
  // Payment scams
  { pattern: /\b(venmo|zelle|cashapp|cash\s*app|paypal\s*(friends|f&f)|wire\s*transfer|western\s*union|money\s*order|crypto|bitcoin|gift\s*card)\b/i, flag: "Requests non-reversible payment method", severity: "high" },
  { pattern: /\b(pay\s*(before|upfront|in\s*advance|first)|deposit\s*(before|required|needed)|send\s*(money|payment)\s*(first|now|before))\b/i, flag: "Demands payment before meeting", severity: "high" },
  // Shipping scams
  { pattern: /\b(ship\s*(it|the|this)|i('ll|.ll|.can)\s*ship|shipping\s*(only|available|included)|mail\s*(it|to\s*you)|send\s*(it|the\s*item)\s*(to|via))\b/i, flag: "Offers to ship item (avoid for local deals)", severity: "medium" },
  // Pressure / urgency
  { pattern: /\b(other\s*(buyer|person|people)\s*(is|are|wants|interested|coming)|someone\s*else\s*(is|wants)|another\s*offer|about\s*to\s*sell|selling\s*today|last\s*chance|act\s*now|won't\s*last|hurry)\b/i, flag: "Pressure tactic — claims other buyers", severity: "low" },
  // Info harvesting
  { pattern: /\b(full\s*(address|name)|ssn|social\s*security|bank\s*(account|details|info)|routing\s*number|credit\s*card|card\s*number)\b/i, flag: "Requests sensitive personal information", severity: "high" },
  // Too good to be true
  { pattern: /\b(free\s*(delivery|shipping)|no\s*charge|i('ll|.ll)\s*pay\s*for\s*shipping|throw\s*in\s*extra|bonus\s*items|gift)\b/i, flag: "Suspiciously generous offer", severity: "low" },
  // Link / off-platform
  { pattern: /\b(click\s*(here|this\s*link)|go\s*to\s*(this|my)\s*(site|website|link|page)|bit\.ly|tinyurl|outside\s*(of\s*)?(facebook|marketplace|the\s*app))\b/i, flag: "Attempts to move off-platform", severity: "high" },
  // Refuses to meet / show item
  { pattern: /\b(can('t|not)\s*(meet|show)|no\s*(meetup|meeting|inspection|test\s*ride)|don't\s*(need\s*to\s*see|have\s*to\s*look|come\s*look)|sight\s*unseen)\b/i, flag: "Refuses in-person meeting or inspection", severity: "medium" },
  // Identity red flags
  { pattern: /\b(my\s*(friend|brother|sister|cousin|wife|husband|partner)\s*(is\s*selling|has|owns|listed)|selling\s*for\s*(someone|a\s*friend|my))\b/i, flag: "Seller claims item belongs to someone else", severity: "low" },
];

function runPatternCheck(messages: Message[]): { flags: string[]; severity: "high" | "medium" | "low" } | null {
  const sellerMessages = messages
    .filter((m) => m.role === "seller")
    .map((m) => m.content)
    .join(" ");

  const matched: { flag: string; severity: "high" | "medium" | "low" }[] = [];

  for (const rule of SCAM_PATTERNS) {
    if (rule.pattern.test(sellerMessages)) {
      matched.push({ flag: rule.flag, severity: rule.severity });
    }
  }

  if (matched.length === 0) return null;

  // Highest severity wins
  const severityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const maxSeverity = matched.reduce(
    (best, m) => (severityOrder[m.severity] > severityOrder[best] ? m.severity : best),
    "low" as "high" | "medium" | "low"
  );

  return {
    flags: matched.map((m) => m.flag),
    severity: maxSeverity,
  };
}

// --- LLM-based deep check ---------------------------------------------------

interface LlmScamResult {
  isScam: boolean;
  severity: "high" | "medium" | "low";
  flags: string[];
  summary: string;
}

async function runLlmCheck(neg: Negotiation): Promise<LlmScamResult | null> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "scam_check",
        messages: neg.messages.map((m) => ({
          role: m.role === "buyer" ? "user" : "assistant",
          content: m.content,
        })),
        context: { negotiation: neg },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { reply: string };
    const match = data.reply.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as LlmScamResult;
  } catch {
    return null;
  }
}

// --- Public API --------------------------------------------------------------

// Severity thresholds: auto-stop on high, warn on medium, note on low.
const SHOULD_AUTO_STOP: Record<string, boolean> = { high: true, medium: false, low: false };

export async function checkForScam(
  neg: Negotiation
): Promise<ScamAlert | null> {
  // Layer 1: instant pattern check
  const patternResult = runPatternCheck(neg.messages);

  // Layer 2: LLM check (runs in parallel for medium/high or when patterns found)
  let llmResult: LlmScamResult | null = null;
  if (patternResult && patternResult.severity !== "low") {
    llmResult = await runLlmCheck(neg);
  }

  // Merge results
  if (!patternResult && !llmResult) return null;
  if (llmResult && !llmResult.isScam && (!patternResult || patternResult.severity === "low")) {
    return null; // LLM cleared it and patterns are minor
  }

  const allFlags = [
    ...(patternResult?.flags ?? []),
    ...(llmResult?.flags ?? []),
  ];
  const uniqueFlags = [...new Set(allFlags)];

  const severity =
    llmResult?.severity === "high" || patternResult?.severity === "high"
      ? "high"
      : llmResult?.severity === "medium" || patternResult?.severity === "medium"
        ? "medium"
        : "low";

  const summary =
    llmResult?.summary ??
    (severity === "high"
      ? "MRI detected strong scam indicators. Negotiation stopped to protect you."
      : severity === "medium"
        ? "MRI noticed some suspicious behavior from this seller. Proceed with caution."
        : "Minor red flags noted — likely fine, but stay alert.");

  return { severity, flags: uniqueFlags, summary, detectedAt: Date.now() };
}

export function shouldAutoStop(alert: ScamAlert): boolean {
  return SHOULD_AUTO_STOP[alert.severity] ?? false;
}
