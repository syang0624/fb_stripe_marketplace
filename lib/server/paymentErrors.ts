export type PaymentErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_OFFER"
  | "OFFER_EXPIRED"
  | "OFFER_ALREADY_USED"
  | "TRANSACTION_NOT_FOUND"
  | "UNAUTHORIZED_DEAL_ACCESS"
  | "PAYMENT_NOT_CONFIGURED"
  | "PAYMENT_FAILED"
  | "TRANSACTION_NOT_FUNDED"
  | "SELLER_ONBOARDING_REQUIRED"
  | "TRANSACTION_ALREADY_REFUNDED"
  | "TRANSACTION_ALREADY_RELEASED"
  | "INVALID_STATE_TRANSITION"
  | "STRIPE_OPERATION_PENDING";

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export function paymentErrorResponse(error: unknown): Response {
  if (error instanceof PaymentError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }

  console.error("[payments] Unexpected error", error);
  return Response.json(
    {
      error: {
        code: "PAYMENT_FAILED",
        message: "The payment operation could not be completed.",
      },
    },
    { status: 500 }
  );
}
