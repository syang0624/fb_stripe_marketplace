"use client";

// Payment-form swap point. Production components render <PaymentForm> and know
// nothing about what implements it.
//
// CURRENT BINDING: MockPaymentForm (Stripe packages are not installed yet —
// package.json is Nori-owned until the shared dependency setup lands).
// AT SYNC 2: implement a Stripe Elements form (<Elements> + <PaymentElement>
// from @stripe/react-stripe-js, initialized with the server-provided
// clientSecret and the public publishable key), bind it here, and delete the
// mock form below.

import { useState } from "react";
import { mockConfirmCardPayment } from "@/lib/client/mockTransactionsApi";

export interface PaymentFormProps {
  clientSecret: string;
  // Display label for the amount, derived from transaction.amountCents.
  amountLabel: string;
  // Client-side confirmation succeeded. NOT authoritative — the caller must
  // keep polling the transaction until the webhook marks it funded.
  onClientConfirmed: () => void;
  // Card declined / validation failure with a user-facing message.
  onFailure: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Mock form (demo only — delete when Stripe Elements lands).
// ---------------------------------------------------------------------------

function MockPaymentForm({
  clientSecret,
  amountLabel,
  onClientConfirmed,
  onFailure
}: PaymentFormProps) {
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12 / 34");
  const [cvc, setCvc] = useState("123");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputClass =
    "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-fb";
  const labelClass = "mb-1.5 block text-xs font-medium text-ink/50";

  const handleSubmit = async () => {
    if (submitting) return;
    const digits = cardNumber.replace(/\D/g, "");
    if (digits.length !== 16) {
      setValidationError("Enter a valid 16-digit card number.");
      return;
    }
    if (!expiry.trim() || !cvc.trim()) {
      setValidationError("Enter the expiry date and CVC.");
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    try {
      await mockConfirmCardPayment(clientSecret, { cardNumber });
      onClientConfirmed();
    } catch (error) {
      setSubmitting(false);
      onFailure(
        error instanceof Error ? error.message : "Payment could not be confirmed."
      );
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="space-y-4"
    >
      <p className="rounded-md bg-mist px-3 py-2 text-xs text-ink/50">
        Demo payment form — stands in for Stripe test checkout. Use 4242 4242
        4242 4242 to succeed or 4000 0000 0000 0002 to see a decline.
      </p>
      <div>
        <label className={labelClass}>Card number</label>
        <input
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          inputMode="numeric"
          autoComplete="cc-number"
          className={inputClass}
          disabled={submitting}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Expiry</label>
          <input
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            autoComplete="cc-exp"
            className={inputClass}
            disabled={submitting}
          />
        </div>
        <div>
          <label className={labelClass}>CVC</label>
          <input
            value={cvc}
            onChange={(e) => setCvc(e.target.value)}
            inputMode="numeric"
            autoComplete="cc-csc"
            className={inputClass}
            disabled={submitting}
          />
        </div>
      </div>
      {validationError && (
        <p className="text-xs font-medium text-critical">{validationError}</p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-fb px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-fbdark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Confirming…" : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}

// SWAP POINT (Sync 2): bind to the Stripe Elements implementation.
export const PaymentForm = MockPaymentForm;
