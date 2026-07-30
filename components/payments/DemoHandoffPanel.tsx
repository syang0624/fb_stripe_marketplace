"use client";

// HACKATHON DEMO ONLY (steven.md S7): after transaction creation, hands the
// seller-side link to the presenter so the seller view can be opened in a
// second tab/window. Shows only the tokenized seller URL — never Stripe
// identifiers.

import { useEffect, useState } from "react";

interface DemoHandoffPanelProps {
  sellerUrl: string;
}

export function DemoHandoffPanel({ sellerUrl }: DemoHandoffPanelProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const absoluteUrl = () =>
    typeof window === "undefined" ? sellerUrl : `${window.location.origin}${sellerUrl}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl());
      setCopied(true);
    } catch {
      // clipboard unavailable — the visible URL below can be copied manually
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-dashed border-line bg-mist/60 p-4">
      <p className="text-xs font-medium uppercase tracking-widest text-ink/40">
        Demo — seller-side link
      </p>
      <p className="mt-1.5 break-all font-mono text-xs text-ink/60">{sellerUrl}</p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleCopy}
          className="rounded-md border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-mist"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          onClick={() => window.open(absoluteUrl(), "_blank", "noopener")}
          className="rounded-md border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-mist"
        >
          Open seller view
        </button>
      </div>
    </div>
  );
}
