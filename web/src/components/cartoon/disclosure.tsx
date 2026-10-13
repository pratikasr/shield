import type { ReactNode } from "react";
import { cx as cn } from "./cx";

/** "Stats for nerds": a closed-by-default drawer for the numbers most borrowers never need. No JavaScript. */
export function Disclosure({
  summary = "Stats for nerds",
  note,
  open,
  className,
  children,
}: {
  summary?: ReactNode;
  /** A small line at the top of the drawer, for example where the numbers come from. */
  note?: ReactNode;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("c-nerds", className)} open={open}>
      <summary>{summary}</summary>
      <div className="c-nerd-body">
        {note && <p className="c-small c-muted mb-1.5">{note}</p>}
        {children}
      </div>
    </details>
  );
}

/** Label and value rows for a Disclosure, two columns on wide screens. */
export function NerdGrid({ rows, className }: { rows: readonly (readonly [ReactNode, ReactNode])[]; className?: string }) {
  return (
    <dl className={cn("c-nerd-grid", className)}>
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
