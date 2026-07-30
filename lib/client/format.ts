// Currency formatting for payment surfaces. After a transaction exists, every
// displayed amount must come from `transaction.amountCents` (server-derived),
// never from local negotiation state.

export function formatUsd(amountCents: number): string {
  const dollars = amountCents / 100;
  const hasCents = amountCents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2
  }).format(dollars);
}
