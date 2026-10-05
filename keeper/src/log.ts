/**
 * Structured JSON logs, one object per line: { ts, level, event, ...fields }.
 * Every block the keeper acts on logs its number, the health factors it read, the decision and any tx hash.
 */
export type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

export function createLogger(
  minLevel: Level = "info",
  sink: (line: string) => void = (l) => process.stdout.write(l + "\n"),
): Logger {
  const emit = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
    if (order[level] < order[minLevel]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(serialize(fields) as object) }));
  };
  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
  };
}
