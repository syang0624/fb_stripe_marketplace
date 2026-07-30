import "server-only";

import Stripe from "stripe";
import { PaymentError } from "@/lib/server/paymentErrors";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new PaymentError(
      "PAYMENT_NOT_CONFIGURED",
      "Stripe test mode is not configured.",
      503
    );
  }
  if (!client) client = new Stripe(secretKey);
  return client;
}

export function stripeErrorCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.code || error.type || "STRIPE_ERROR";
  }
  return "STRIPE_ERROR";
}

export function stripeErrorMessage(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return `${error.type}: ${error.code || "unknown"}`;
  }
  return error instanceof Error ? error.name : "Unknown Stripe error";
}

export function appBaseUrl(request?: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("APP_BASE_URL is required in production");
}
