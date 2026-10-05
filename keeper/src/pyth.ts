import type { Hex } from "viem";
import type { Logger } from "./log.js";

/**
 * Fetches a Pyth price update from Hermes for the given feeds. Hermes has required an API key since
 * 26 Aug 2026 (ADR-017); without one the keeper sends an empty update and the contracts read Pyth's
 * on-chain push feeds instead.
 */
export async function fetchPythUpdate(
  feedIds: Hex[],
  opts: { hermesUrl: string; apiKey?: string; logger: Logger; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Hex[]> {
  if (!opts.apiKey || feedIds.length === 0) return [];
  const url = new URL("/v2/updates/price/latest", opts.hermesUrl.endsWith("/") ? opts.hermesUrl : opts.hermesUrl + "/");
  for (const id of feedIds) url.searchParams.append("ids[]", id);
  url.searchParams.set("encoding", "hex");
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 800),
    });
    if (!res.ok) {
      opts.logger.warn("pyth.hermes_http_error", { status: res.status });
      return [];
    }
    const body = (await res.json()) as { binary?: { data?: string[] } };
    return (body.binary?.data ?? []).map((h) => (h.startsWith("0x") ? h : `0x${h}`) as Hex);
  } catch (err) {
    opts.logger.warn("pyth.hermes_failed", { error: err });
    return [];
  }
}
