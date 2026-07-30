// Error type shared by the transaction adapter implementations. Lives in its
// own module so the adapter and the mock don't circularly import each other.

export class TransactionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "TransactionApiError";
  }
}

// Returns true for connectivity failures (as opposed to API rejections). The
// UI must present these neutrally — a network error says nothing about whether
// a payment succeeded or failed.
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof TransactionApiError);
}
