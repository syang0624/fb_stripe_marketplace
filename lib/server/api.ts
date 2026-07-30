import "server-only";

import { PaymentError } from "@/lib/server/paymentErrors";

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new PaymentError("INVALID_REQUEST", "A valid JSON body is required.");
  }
}

export function requireToken(token: unknown): string {
  if (typeof token !== "string" || token.length < 20) {
    throw new PaymentError(
      "UNAUTHORIZED_DEAL_ACCESS",
      "A valid deal access token is required.",
      401
    );
  }
  return token;
}

export function noStoreJson(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}
