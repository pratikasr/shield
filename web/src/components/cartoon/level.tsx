import type { CSSProperties, ReactNode } from "react";
import { cx as cn } from "./cx";
import { pct1, usd0 } from "./fmt";
import { Mascot, type MascotMotion } from "./mascot";
import type { MascotMood } from "./mascot-art";

export type LineMode = "preview" | "on" | "arming" | "off" | "blocked" | "hidden";

export interface LevelProps {
  /** The collateral's price now: the platform the mascot stands on. */
  now: number;
  /** The price at which Aave liquidates: the lava. */
  aave: number;
  /** The price at which Shield steps in, or null for no line. */
  line?: number | null;
  /** How Shield's line looks: dashed preview, solid on, arming, grey off, yellow blocked, or hidden. */
  lineMode?: LineMode;
  /** Replaces the text on Shield's line tag. */
  lineLabel?: ReactNode;
  mood?: MascotMood;
  /** What the mascot plays when the mood changes (squash by default). */
  mascotMotion?: MascotMotion;
  /** Change to replay mascotMotion without a mood change. */
  mascotPlayKey?: string | number;
  /** hero: 520 px tall (400 on phones); compact: 440 (360). */
  size?: "hero" | "compact";
  /** Price range shown from top to bottom; by default from `now` down past the lava. Fix it to animate a story. */
  scale?: { top: number; bottom: number };
  /** Aave's old line, dashed, after a rescue pushed the lava down. */
  ghost?: number | null;
  /** Small stickers in the top right corner, for example an "Example" tag. */
  ribbon?: ReactNode;
  /** Replaces the platform's text ("ETH $2,716 now"). */
  slab?: ReactNode;
  /** The collateral's name on the platform. */
  asset?: string;
  /** The "% to the lava" ruler. */
  showRuler?: boolean;
  /** The "Aave liquidates at" tag on the lava. */
  showLavaTag?: boolean;
  /** Desaturates the mascot and the line, for an example behind a connect prompt. */
  dim?: boolean;
  /** Turns position transitions off while a caller animates `now` every frame. */
  live?: boolean;
  /** Increment to flash Shield's line (when it steps in). */
  flashKey?: number;
  /** Rendered inside the player, positioned against it (for floating "Pays back $26" tags). */
  playerOverlay?: ReactNode;
  className?: string;
  id?: string;
  /** Accessible name for the picture. */
  label?: string;
}

function lineTagText(mode: LineMode, line: number, now: number): ReactNode {
  const drop = (1 - line / now) * 100;
  const where = drop <= 0.05 ? "ETH is right on it" : `${pct1(drop)} below now`;
  if (mode === "preview")
    return (
      <>
        <b>Shield would step in at {usd0(line)}</b>
        {where}
      </>
    );
  if (mode === "arming")
    return (
      <>
        <b>Shield steps in at {usd0(line)}</b>Arms in 15 minutes
      </>
    );
  if (mode === "off")
    return (
      <>
        <b>Shield is off</b>Your line was {usd0(line)}
      </>
    );
  if (mode === "blocked")
    return (
      <>
        <b>Shield can&rsquo;t step in</b>Your line: {usd0(line)}
      </>
    );
  return (
    <>
      <b>Shield steps in at {usd0(line)}</b>
      {where}
    </>
  );
}

function Cloud({ w, x, y }: { w: number; x: string; y: string }) {
  return (
    <svg className="lv-cloud" style={{ left: x, top: y, width: w }} viewBox="0 0 120 52" aria-hidden>
      <path d="M14 46 C2 46 2 30 14 30 C12 16 30 10 38 20 C42 6 66 4 72 18 C80 8 100 12 98 28 C112 26 116 46 102 46 Z" fill="#fff" />
    </svg>
  );
}

const WAVE_PATH = "M0 9 Q25 0 50 9 T100 9 T150 9 T200 9 T250 9 T300 9 T350 9 T400 9 V18 H0 Z";

/**
 * The loan as a platformer level: the mascot stands on the price platform, Aave's liquidation price is the lava below,
 * Shield's line sits in between, and a dashed ruler says how far it is to the lava. Every position comes from props
 * and glides there with CSS when they change. Renders on the server; only the mascot is a client component.
 */
export function Level({
  now,
  aave,
  line = null,
  lineMode = "hidden",
  lineLabel,
  mood = "chill",
  mascotMotion,
  mascotPlayKey,
  size = "hero",
  scale,
  ghost,
  ribbon,
  slab,
  asset = "ETH",
  showRuler = true,
  showLavaTag = true,
  dim,
  live,
  flashKey,
  playerOverlay,
  className,
  id,
  label,
}: LevelProps) {
  const range = scale ?? { top: now, bottom: aave - Math.max(now - aave, now * 0.02) * 0.4 };
  const span = range.top - range.bottom || 1;
  const f = (p: number) => Math.min(1, Math.max(0, (range.top - p) / span)).toFixed(4);
  const room = (1 - aave / now) * 100;
  const v = (name: string, value: string) => ({ [name]: value }) as CSSProperties;
  return (
    <div
      id={id}
      className={cn("level", className)}
      data-size={size}
      data-dim={dim || undefined}
      data-live={live || undefined}
      role="group"
      aria-label={label ?? `${asset} at ${usd0(now)}. Aave liquidates at ${usd0(aave)}, ${pct1(room)} below.${line && lineMode !== "hidden" ? ` Shield's line at ${usd0(line)}.` : ""}`}
    >
      <Cloud w={118} x="42%" y="7%" />
      <Cloud w={150} x="78%" y="36%" />
      <Cloud w={96} x="-4%" y="44%" />
      {ribbon && <div className="lv-ribbon">{ribbon}</div>}
      {ghost != null && (
        <div className="lv-ghost lv-y" style={v("--f", f(ghost))}>
          <span>Aave&rsquo;s line was {usd0(ghost)}</span>
        </div>
      )}
      {showRuler && (
        <div className="lv-ruler" style={{ ...v("--fn", f(now)), ...v("--fa", f(aave)) }} aria-hidden>
          <span className="lv-room">
            <b>{pct1(room)}</b>to the lava
          </span>
        </div>
      )}
      <div
        className="lv-net lv-y"
        data-mode={line != null ? lineMode : "hidden"}
        data-flash={flashKey ? (flashKey % 2 ? "a" : "b") : undefined}
        style={v("--f", line != null ? f(line) : "0")}
      >
        {line != null && lineMode !== "hidden" && <div className="lv-tag">{lineLabel ?? lineTagText(lineMode, line, now)}</div>}
      </div>
      <div className="lv-lava lv-y" style={v("--f", f(aave))}>
        <svg className="lv-wave" viewBox="0 0 400 18" preserveAspectRatio="none" aria-hidden>
          <path d={WAVE_PATH} fill="#FF5A4E" stroke="#1B1430" strokeWidth={2.5} />
        </svg>
        <i className="lv-bubble" aria-hidden />
        <i className="lv-bubble" aria-hidden />
        <i className="lv-bubble" aria-hidden />
        <i className="lv-bubble" aria-hidden />
        {showLavaTag && (
          <div className="lv-tag">
            <b>Aave liquidates at {usd0(aave)}</b>
            {pct1(room)} below now
          </div>
        )}
      </div>
      <div className="lv-player lv-y" style={v("--f", f(now))}>
        <Mascot mood={mood} motion={mascotMotion} playKey={mascotPlayKey} />
        <div className="lv-slab">
          {slab ?? (
            <>
              {asset} {usd0(now)}
              <small>now</small>
            </>
          )}
        </div>
        {playerOverlay}
      </div>
    </div>
  );
}

/** A tag that floats off the player and fades ("Pays back $26 of the loan"). Pass it as Level's playerOverlay. */
export function LevelFloat({ kind, children }: { kind: "up" | "away"; children: ReactNode }) {
  return (
    <div className="lv-float" data-kind={kind} aria-hidden>
      {children}
    </div>
  );
}
