"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { FormEvent, useState } from "react";

export interface PaymentFormProps {
  clientSecret: string;
  amountLabel: string;
  onClientConfirmed: () => void;
  onFailure: (message: string) => void;
}

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

function StripePaymentForm({
  amountLabel,
  onClientConfirmed,
  onFailure,
}: Omit<PaymentFormProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (result.error) {
      onFailure(result.error.message || "Payment could not be confirmed.");
      setSubmitting(false);
      return;
    }

    onClientConfirmed();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-md bg-fb px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-fbdark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Confirming with Stripe…" : `Pay ${amountLabel}`}
      </button>
      <p className="text-center text-xs text-ink/40">
        Payment details are securely collected by Stripe.
      </p>
    </form>
  );
}

export function PaymentForm({
  clientSecret,
  amountLabel,
  onClientConfirmed,
  onFailure,
}: PaymentFormProps) {
  if (!stripePromise) {
    return (
      <p className="rounded-md border border-critical/30 bg-critical/5 px-4 py-3 text-sm font-medium text-critical">
        Stripe checkout is unavailable because the publishable key is not configured.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#1877f2",
            colorText: "#1c1e21",
            colorDanger: "#b91c1c",
            borderRadius: "6px",
          },
        },
      }}
    >
      <StripePaymentForm
        amountLabel={amountLabel}
        onClientConfirmed={onClientConfirmed}
        onFailure={onFailure}
      />
    </Elements>
  );
}
