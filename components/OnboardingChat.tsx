"use client";

import { useEffect, useRef, useState } from "react";
import { BuyerProfile, Message } from "@/lib/types";
import { ChatBubble } from "@/components/ChatBubble";

interface OnboardingChatProps {
  onComplete: (profile: BuyerProfile) => void;
}

function parseProfileFromText(text: string): BuyerProfile | null {
  const block = text.match(/\{[\s\S]*\}/)?.[0];
  if (!block) return null;
  try {
    const parsed = JSON.parse(block) as BuyerProfile;
    if (
      parsed.bikeType &&
      typeof parsed.budgetMin === "number" &&
      typeof parsed.budgetMax === "number" &&
      parsed.location
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function OnboardingChat({ onComplete }: OnboardingChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "seller",
      content:
        "Hey! I'm MRI, your buying agent. I'll find the best deals on the marketplace and negotiate for you. What are you looking for?",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    const buyerMessage: Message = { role: "buyer", content: userText, timestamp: Date.now() };
    const nextMessages = [...messages, buyerMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      // Fire API call and a minimum typing delay in parallel
      const typingDelay = new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));
      const apiCall = fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "onboarding",
          messages: nextMessages.map((m) => ({
            role: m.role === "buyer" ? "user" : "assistant",
            content: m.content,
          })),
        }),
      });

      // Wait for both — typing dots show for at least 1.2–2s
      const [response] = await Promise.all([apiCall, typingDelay]);
      const data = (await response.json()) as { reply: string };
      const profile = parseProfileFromText(data.reply);

      if (profile) {
        const confirmMsg: Message = {
          role: "seller",
          content: `Perfect — I'll search near ${profile.location} for "${profile.bikeType}" up to $${profile.budgetMax}. Let me go find you some deals!`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, confirmMsg]);
        setLoading(false);
        setTimeout(() => onComplete(profile), 1500);
        return;
      }

      const assistantMessage: Message = {
        role: "seller",
        content: data.reply,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      const errorMsg: Message = {
        role: "seller",
        content: "Sorry, had a hiccup. Could you try that again?",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex h-[78vh] w-full max-w-2xl flex-col">
      {/* Header */}
      <div className="px-1 pb-6">
        <p className="text-xs font-medium uppercase tracking-widest text-ink/40">Step 1</p>
        <h2 className="mt-2 text-2xl font-light tracking-tight text-ink">
          Tell us what you want
        </h2>
        <p className="mt-1 text-sm text-ink/50">
          Chat with MRI — it just needs a few details to start searching.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-line bg-paper p-5">
        {messages.map((message, index) => (
          <ChatBubble
            key={`${message.timestamp}-${index}`}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
            sellerLabel="MRI"
          />
        ))}
        {loading && (
          <div className="mr-auto inline-flex items-center gap-1.5 rounded-md bg-mist px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot" />
            <span className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot [animation-delay:0.4s]" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-md border border-line bg-paper px-4 py-3 text-sm text-ink placeholder:text-ink/35 outline-none transition-colors focus:border-ink/30"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-ink px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
