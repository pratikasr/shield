/** Small display formatters for cartoon components: dollars first, rounded for headlines. */
const nf = (d: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = new Map<number, Intl.NumberFormat>();
function fmt(v: number, d: number): string {
  let f = cache.get(d);
  if (!f) {
    f = nf(d);
    cache.set(d, f);
  }
  return f.format(v);
}

/** "$2,716" */
export const usd0 = (v: number) => `${v < 0 ? "-" : ""}$${fmt(Math.abs(Math.round(v)), 0)}`;
/** "$26.26" */
export const usd2 = (v: number) => `${v < 0 ? "-" : ""}$${fmt(Math.abs(v), 2)}`;
/** "6.5%" from a percent value (6.5, not 0.065). */
export const pct1 = (v: number) => `${fmt(v, 1)}%`;
/** "110,762,418" */
export const int = (v: number) => fmt(Math.round(v), 0);
