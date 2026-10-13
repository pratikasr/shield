import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the person asked the system for less motion. Safe to call only in the browser. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Reduced-motion preference as React state; false on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** Restarts a CSS animation class on an element (remove, reflow, add). Does nothing under reduced motion. */
export function replayClass(el: Element | null, cls: string, others: readonly string[] = []) {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove(cls, ...others);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}
