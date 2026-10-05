"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { IndexerError, envioQuery } from "@/lib/envio";
import { envioUrl } from "@/lib/env";

/**
 * Polls the Envio indexer, every 2 s unless `refetchMs` says otherwise (larger queries, such as a chart's few hundred
 * rows, poll less often). React Query puts a query that never succeeded back to "pending, no error" on each poll, which
 * would show "Loading" forever while the indexer is down; this keeps the failure until a success, so each tab can say
 * "History unavailable" instead.
 */
export function useIndexerQuery<T>(key: readonly unknown[], query: string, variables: Record<string, unknown> = {}, enabled = true, refetchMs = 2_000) {
  const q = useQuery({
    queryKey: key,
    queryFn: () => envioQuery<T>(query, variables),
    enabled: enabled && Boolean(envioUrl),
    refetchInterval: refetchMs,
    retry: 1,
  });
  const last = useRef<Error | null>(null);
  if (q.error) last.current = q.error;
  const failing = q.errorUpdatedAt > q.dataUpdatedAt;
  const error = failing ? (q.error ?? last.current ?? new IndexerError("the indexer did not answer")) : null;
  return { data: q.data, error, isLoading: q.isPending && !failing && enabled && Boolean(envioUrl) };
}
