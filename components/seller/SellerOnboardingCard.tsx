"use client";

// Stripe Connect onboarding status for the seller. The onboarding itself is
// Stripe-hosted — this card only opens the URL returned by the server and
// reflects the server-reported completion status.

interface SellerOnboardingCardProps {
  onboardingComplete: boolean;
  busy: boolean;
  onStartOnboarding: () => void;
}

export function SellerOnboardingCard({
  onboardingComplete,
  busy,
  onStartOnboarding
}: SellerOnboardingCardProps) {
  if (onboardingComplete) {
    return (
      <div className="rounded-lg border border-line bg-paper p-5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-positive">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          Stripe payouts ready
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
          Your Stripe account is set up. Once both sides confirm the meetup, the
          payment is sent to your Stripe balance.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-paper p-5">
      <p className="text-sm font-medium text-ink">Set up payouts</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink/50">
        Connect a Stripe account to receive this payment. You&apos;ll be taken to
        Stripe&apos;s secure onboarding — when you&apos;re done, come back here and
        the status updates automatically.
      </p>
      <button
        onClick={onStartOnboarding}
        disabled={busy}
        className="mt-3 rounded-md bg-ink px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Opening Stripe…" : "Connect Stripe"}
      </button>
    </div>
  );
}
