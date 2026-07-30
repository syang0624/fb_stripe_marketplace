"use client";

import { useEffect, useRef, useState } from "react";
import { Negotiation } from "@/lib/types";
import { ChatBubble } from "@/components/ChatBubble";
import { StageTracker } from "@/components/StageTracker";

interface ChatDrawerProps {
  negotiation: Negotiation;
  onClose: () => void;
  onSendMessage?: (content: string) => void;
  onTakeOver?: () => void;
  onReturnControl?: () => void;
  // Read-only view (e.g. from the review page for a finished deal): shows the
  // full history but hides take-over / message controls.
  readOnly?: boolean;
}

export function ChatDrawer({
  negotiation,
  onClose,
  onSendMessage,
  onTakeOver,
  onReturnControl,
  readOnly = false
}: ChatDrawerProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [negotiation.messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage?.(input.trim());
    setInput("");
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fadeIn">
      {/* Backdrop */}
      <div className="flex-1 bg-ink/20" onClick={onClose} />

      {/* Drawer panel */}
      <div className="flex w-full max-w-md flex-col border-l border-line bg-paper shadow-card">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink">{negotiation.sellerName}</h3>
            <p className="truncate text-xs text-ink/40">{negotiation.listing.title}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 text-xs font-medium text-ink/50 transition-colors hover:text-ink"
          >
            Close
          </button>
        </div>

        {/* Stage + price */}
        <div className="space-y-3 border-b border-line px-6 py-4">
          <StageTracker currentStage={negotiation.stage} />
          <div className="flex items-baseline gap-3 text-xs">
            <span className="text-ink/40">
              Listed <span className="tabular-nums text-ink/60">${negotiation.listing.price}</span>
            </span>
            <span className="text-ink/40">
              Current{" "}
              <span className="tabular-nums font-medium text-ink">${negotiation.currentPrice}</span>
            </span>
            {negotiation.currentPrice < negotiation.listing.price && (
              <span className="font-medium text-positive">
                Saved ${negotiation.listing.price - negotiation.currentPrice}
              </span>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {negotiation.messages.map((msg, index) => (
            <ChatBubble
              key={`${msg.timestamp}-${index}`}
              role={msg.role}
              content={msg.content}
              timestamp={msg.timestamp}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Scam alert banner in chat */}
        {negotiation.scamAlert && (
          <div className={`border-t px-6 py-4 ${
            negotiation.scamAlert.severity === "high"
              ? "border-red-200 bg-red-50"
              : negotiation.scamAlert.severity === "medium"
                ? "border-amber-200 bg-amber-50"
                : "border-yellow-200 bg-yellow-50"
          }`}>
            <div className="flex items-start gap-2">
              <span className="text-base leading-none">&#9888;</span>
              <div className="text-xs">
                <p className={`font-semibold ${
                  negotiation.scamAlert.severity === "high" ? "text-red-800" : "text-amber-800"
                }`}>
                  {negotiation.scamAlert.severity === "high" ? "Scam Detected" : "Warning"}
                </p>
                <p className={`mt-0.5 leading-relaxed ${
                  negotiation.scamAlert.severity === "high" ? "text-red-700" : "text-amber-700"
                }`}>
                  {negotiation.scamAlert.summary}
                </p>
                <ul className={`mt-1.5 space-y-0.5 ${
                  negotiation.scamAlert.severity === "high" ? "text-red-600" : "text-amber-600"
                }`}>
                  {negotiation.scamAlert.flags.map((flag, i) => (
                    <li key={i}>&#8226; {flag}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Control bar */}
        {readOnly || negotiation.stage === "scam_detected" ? (
          <div className="border-t border-line px-6 py-4">
            <p className="text-center text-xs text-ink/40">
              {negotiation.stage === "scam_detected"
                ? "MRI stopped this negotiation due to scam indicators."
                : negotiation.stage === "withdrawn"
                  ? "MRI walked away from this negotiation."
                  : "Negotiation complete — viewing chat history."}
            </p>
          </div>
        ) : (
          <div className="space-y-2 border-t border-line px-6 py-4">
            {negotiation.userTookOver ? (
              <>
                <form onSubmit={handleSend} className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message…"
                    className="flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink/35 outline-none transition-colors focus:border-ink/30"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-ink/90"
                  >
                    Send
                  </button>
                </form>
                <button
                  onClick={onReturnControl}
                  className="w-full rounded-md border border-line px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-mist"
                >
                  Return control to MRI
                </button>
              </>
            ) : (
              <button
                onClick={onTakeOver}
                className="w-full rounded-md border border-line px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-mist"
              >
                Take over this negotiation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
