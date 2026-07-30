"use client";

import { useEffect, useState } from "react";

interface SearchProgressProps {
  // True once the live search has actually resolved. The UI will not show
  // "complete" (and will not advance) until this is true — even if the step
  // animation finishes first.
  ready?: boolean;
  onComplete?: () => void;
}

const STEPS = [
  { label: "Expanding search queries", detail: "Generating query variants from your preferences" },
  { label: "Searching Marketplace", detail: "Scanning live listings across queries" },
  { label: "Removing duplicates", detail: "Deduplicating results" },
  { label: "Fetching item details", detail: "Enriching the strongest candidates" },
  { label: "Ranking deals", detail: "Scoring by value, fit, risk, and pickup" }
];

export function SearchProgress({ ready = false, onComplete }: SearchProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const lastIndex = STEPS.length - 1;

  // Advance through steps on a timer, but hold on the final step until the API
  // is actually ready.
  useEffect(() => {
    if (currentStep < lastIndex) {
      const timer = setTimeout(() => setCurrentStep((s) => s + 1), 750 + Math.random() * 500);
      return () => clearTimeout(timer);
    }
  }, [currentStep, lastIndex]);

  // Complete only when the search resolved AND the animation reached the end.
  const done = ready && currentStep >= lastIndex;
  useEffect(() => {
    if (done && onComplete) {
      const timer = setTimeout(onComplete, 500);
      return () => clearTimeout(timer);
    }
  }, [done, onComplete]);

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-ink/40">
        Live search · ScrapeCreators
      </p>
      <h2 className="mt-3 text-2xl font-light tracking-tight text-ink">
        {done ? "Found your top deals" : "Searching the marketplace"}
      </h2>

      <div className="mt-10 space-y-5">
        {STEPS.map((step, index) => {
          const isComplete = done || index < currentStep;
          const isActive = !done && index === currentStep;

          return (
            <div key={step.label} className="flex items-start gap-4">
              {/* Status indicator */}
              <div className="mt-0.5 flex-shrink-0">
                {isComplete ? (
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink" fill="none">
                    <path
                      d="M5 10.5l3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : isActive ? (
                  <span className="block h-4 w-4 rounded-full border-[1.5px] border-ink/30 border-t-ink animate-spin" />
                ) : (
                  <span className="block h-4 w-4 rounded-full border border-line" />
                )}
              </div>

              {/* Text */}
              <div className="flex-1">
                <p
                  className={`text-sm transition-colors ${
                    isComplete ? "text-ink/45" : isActive ? "text-ink" : "text-ink/30"
                  }`}
                >
                  {step.label}
                </p>
                {isActive && (
                  <p className="mt-0.5 text-xs text-ink/40">
                    {index === lastIndex && !ready ? "Waiting for live results…" : step.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
