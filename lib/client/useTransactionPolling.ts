"use client";

// Shared polling hook for buyer and seller views. The server's transaction
// state is authoritative — the UI never assumes an outcome (especially payment
// success) without seeing it here first.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PublicTransaction,
  isTerminalState
} from "@/lib/client/transactionTypes";
import { isNetworkError } from "@/lib/client/apiError";

const DEFAULT_INTERVAL_MS = 2500;

export interface TransactionPolling {
  transaction: PublicTransaction | null;
  // API rejected the request (bad token, invalid transition, missing deal).
  apiError: string | null;
  // Connectivity problem — must be presented neutrally: it implies nothing
  // about whether a payment or refund went through.
  networkIssue: boolean;
  refresh: () => void;
}

export function useTransactionPolling(
  fetcher: (() => Promise<PublicTransaction>) | null,
  { intervalMs = DEFAULT_INTERVAL_MS, enabled = true }: {
    intervalMs?: number;
    enabled?: boolean;
  } = {}
): TransactionPolling {
  const [transaction, setTransaction] = useState<PublicTransaction | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [networkIssue, setNetworkIssue] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const stoppedRef = useRef(false);

  const refresh = useCallback(() => {
    stoppedRef.current = false;
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!fetcher || !enabled) return;
    stoppedRef.current = false;
    let disposed = false;

    const poll = async () => {
      if (disposed || stoppedRef.current) return;
      try {
        const tx = await fetcher();
        if (disposed) return;
        setTransaction(tx);
        setApiError(null);
        setNetworkIssue(false);
        // Nothing further can change once terminal; stop polling.
        if (isTerminalState(tx.state)) stoppedRef.current = true;
      } catch (error) {
        if (disposed) return;
        if (isNetworkError(error)) {
          setNetworkIssue(true);
        } else {
          setApiError(error instanceof Error ? error.message : "Request failed");
        }
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [fetcher, enabled, intervalMs, refreshNonce]);

  return { transaction, apiError, networkIssue, refresh };
}
