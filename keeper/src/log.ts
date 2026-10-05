import { BaseError } from "viem";

/**
 * Structured JSON logs, one object per line: { ts, level, event, ...fields }.
 * Every block the keeper acts on logs its number, the health factors it read, the decision and any tx hash.
 *
 * RPC URLs can carry an API key, so errors are logged by their short message and details only (never viem's full
 * message, which repeats the request URL and body), and every configured URL is redacted from each line.
 */
export type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const REDACTED = "[redacted]";

/** A short, URL-free description of an error. */
export function describeError(err: unknown): { name: string; message: string; details?: string } {
  if (err instanceof BaseError) {
    const details = err.details && err.details !== err.shortMessage ? err.details : undefined;
    return { name: err.name, message: err.shortMessage, ...(details ? { details } : {}) };
  }
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

/** Every form of each secret URL that could appear in a message: as given, normalised, and its path or query. */
export function redactionsFor(urls: string[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    if (!raw) continue;
    out.add(raw);
    out.add(raw.replace(/\/+$/, ""));
    try {
      const u = new URL(raw);
      out.add(u.href);
      const tail = `${u.pathname}${u.search}`;
      if (tail.length > 1) out.add(tail);
      if (u.search.length > 1) out.add(u.search.slice(1));
      if (u.username) out.add(u.username);
      if (u.password) out.add(u.password);
    } catch {
      // not a URL; the raw string is enough
    }
  }
  // Longest first, so a full URL is replaced before its path.
  return [...out].filter((s) => s.length > 1).sort((a, b) => b.length - a.length);
}

export function redact(line: string, secrets: string[]): string {
  let out = line;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join(REDACTED);
  return out;
}

export function createLogger(
  minLevel: Level = "info",
  sink: (line: string) => void = (l) => process.stdout.write(l + "\n"),
  opts: { redact?: string[] } = {},
): Logger {
  const secrets = redactionsFor(opts.redact ?? []);
  const emit = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
    if (order[level] < order[minLevel]) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(serialize(fields) as object) });
    sink(secrets.length ? redact(line, secrets) : line);
  };
  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
  };
}
