import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function tokenSecret(): string {
  const configured = process.env.PAYMENT_TOKEN_SECRET;
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("PAYMENT_TOKEN_SECRET is required in production");
  }

  return "solid-local-demo-token-secret-change-before-deploy";
}

export function dealToken(transactionId: string, actor: "buyer" | "seller"): string {
  return createHmac("sha256", tokenSecret())
    .update(`${actor}:${transactionId}`)
    .digest("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
