/** Joins class names. The cartoon kit's own classes never conflict, so it skips tailwind merging (and its bundle). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
