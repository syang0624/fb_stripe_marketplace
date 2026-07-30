"use client";

// Small status panel used across the payment flow (creating the transaction,
// waiting for the funding webhook, refund progress, neutral errors).

interface PaymentStatusProps {
  title: string;
  detail?: string;
  tone?: "neutral" | "positive" | "critical";
  // Shows the animated waiting indicator while a server-side transition is in
  // flight (webhook, transfer, refund).
  waiting?: boolean;
  children?: React.ReactNode;
}

export function PaymentStatus({
  title,
  detail,
  tone = "neutral",
  waiting = false,
  children
}: PaymentStatusProps) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "critical" ? "text-critical" : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-paper p-8 text-center animate-fadeIn">
      {waiting && (
        <div className="mb-4 flex items-center justify-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-ink/60 animate-pulseDot"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      )}
      <h3 className={`text-base font-medium tracking-tight ${toneClass}`}>{title}</h3>
      {detail && <p className="mx-auto mt-2 max-w-sm text-sm text-ink/50">{detail}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
