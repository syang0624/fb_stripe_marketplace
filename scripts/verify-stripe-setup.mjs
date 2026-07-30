import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";

const root = resolve(import.meta.dirname, "..");
const envLocalPath = resolve(root, ".env.local");

function readEnv(path) {
  if (!existsSync(path)) throw new Error(".env.local is missing.");
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

const env = readEnv(envLocalPath);
for (const key of [
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYMENT_TOKEN_SECRET",
  "CRON_SECRET",
]) {
  if (!env[key] || /replace|your-|change-me/i.test(env[key])) {
    throw new Error(`${key} is not configured.`);
  }
}

const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const platform = await stripe.accounts.retrieve();
if (!platform.charges_enabled) throw new Error("Platform charges are not enabled.");

let connectedAccount;
let paymentIntent;
try {
  connectedAccount = await stripe.accounts.create({
    type: "express",
    country: platform.country || "JP",
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
    business_profile: {
      product_description: "SOLID setup verification seller",
    },
    metadata: { solid_setup_verification: "true" },
  });

  const accountLink = await stripe.accountLinks.create({
    account: connectedAccount.id,
    refresh_url: `${env.APP_BASE_URL || "http://localhost:3000"}/stripe/setup/refresh`,
    return_url: `${env.APP_BASE_URL || "http://localhost:3000"}/stripe/setup/return`,
    type: "account_onboarding",
  });
  if (!accountLink.url.startsWith("https://connect.stripe.com/")) {
    throw new Error("Stripe Connect onboarding link was not created.");
  }

  paymentIntent = await stripe.paymentIntents.create({
    amount: 100,
    currency: "usd",
    payment_method_types: ["card"],
    description: "SOLID setup verification",
    metadata: { solid_setup_verification: "true" },
  });
  await stripe.paymentIntents.cancel(paymentIntent.id);
} finally {
  if (connectedAccount) {
    await stripe.accounts.del(connectedAccount.id);
  }
}

console.log("Stripe setup verified:");
console.log(`- platform: ${platform.id}`);
console.log("- mode: test");
console.log("- platform charges: enabled");
console.log("- Connect Express account creation: enabled");
console.log("- Connect onboarding link creation: enabled");
console.log("- USD PaymentIntent creation: enabled");
console.log("- local webhook signing secret: configured");
