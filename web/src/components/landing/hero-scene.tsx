"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Level, LevelFloat } from "@/components/cartoon/level";
import type { MascotMood } from "@/components/cartoon/mascot-art";
import { prefersReducedMotion, useReducedMotion } from "@/components/cartoon/motion";
import { SampleTag } from "@/components/cartoon/sticker";
import { cx as cn } from "@/components/cartoon/cx";

/**
 * The landing page's one orchestrated moment, on an example loan (0.05 ETH, 106.61 USDC borrowed, ETH at $2,716,
 * health factor 1.0699). Shield's Balanced line is health factor 1.04; a rescue repays enough to lift it to 1.10
 * (exitHfBuffer), so at $2,640 it repays about $25.42 and takes ETH worth 1.01 times that; Aave's liquidators take
 * 1.055 times. The lava, the line and the mascot arrive in CSS before any script runs; the story then plays once in
 * about 5 s and settles back on the three-line picture. Under reduced motion only that picture and its caption show.
 */
const NOW = 2716;
const HF = 1.0699;
const priceAt = (h: number) => (NOW * h) / HF;
const START = { now: NOW, line: priceAt(1.04), aave: priceAt(1) };
const END_AAVE = priceAt(1.04) / 1.1;
const SCALE = { top: 2716, bottom: 2360 };
const REPAID = "$25.42";
const TAKEN = "$25.67";

export const SCENE_SUMMARY =
  "Example: if ETH falls to $2,640, Shield pays back about $25 of the loan and takes ETH worth that plus 1%. Aave’s line drops to $2,400, and an Aave liquidation would have taken $1.14 more.";

interface Frame {
  now: number;
  aave: number;
  lineShown: boolean;
  mood: MascotMood;
  live: boolean;
  flash: number;
  jump: number;
  floats: { id: number; kind: "up" | "away"; text: string }[];
  caption: string;
  playing: boolean;
}

const REST: Frame = {
  now: START.now,
  aave: START.aave,
  lineShown: true,
  mood: "chill",
  live: false,
  flash: 0,
  jump: 0,
  floats: [],
  caption: SCENE_SUMMARY,
  playing: false,
};

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export function HeroScene() {
  const [f, setF] = useState<Frame>(REST);
  const [intro, setIntro] = useState(true);
  const reduced = useReducedMotion();
  const run = useRef(0);

  const play = useCallback(async () => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const sleep = (ms: number) => new Promise<boolean>((r) => setTimeout(() => r(alive()), ms));
    const patch = (p: Partial<Frame>) => alive() && setF((x) => ({ ...x, ...p }));
    const tween = (ms: number, step: (k: number) => void) =>
      new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const tick = (t: number) => {
          if (!alive()) return resolve(false);
          const k = Math.min(1, (t - t0) / ms);
          step(k);
          if (k < 1) requestAnimationFrame(tick);
          else resolve(true);
        };
        requestAnimationFrame(tick);
      });

    setF({ ...REST, playing: true, caption: "ETH is at $2,716. Shield’s line waits at $2,640, above Aave’s lava." });
    if (!(await sleep(900))) return;
    patch({ caption: "ETH starts to fall.", live: true });
    let worried = false;
    if (
      !(await tween(1400, (k) => {
        const now = START.now - (START.now - START.line) * ease(k);
        if (!worried && k > 0.4) {
          worried = true;
          patch({ now, mood: "careful" });
        } else patch({ now });
      }))
    )
      return;
    patch({ live: false, mood: "guard", flash: Date.now(), caption: "ETH hits your line at $2,640. Shield steps in.", floats: [{ id: 1, kind: "up", text: `Pays back ${REPAID} of the loan` }] });
    if (!(await sleep(550))) return;
    setF((x) => (alive() ? { ...x, floats: [...x.floats, { id: 2, kind: "away", text: `Takes ETH worth ${TAKEN}` }] } : x));
    if (!(await sleep(800))) return;
    patch({ aave: END_AAVE, lineShown: false, floats: [] });
    if (!(await sleep(250))) return;
    patch({
      mood: "saved",
      jump: Date.now(),
      caption: `Shield paid back ${REPAID} and took ETH worth ${TAKEN}. Aave’s line dropped to $2,400. A liquidation would have taken $1.14 more.`,
    });
    if (!(await sleep(2600))) return;
    // Settle back on the three-line picture: you, Shield's line, the lava.
    patch({ ...REST });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1500);
    if (!prefersReducedMotion()) void play();
    return () => {
      clearTimeout(t);
      run.current += 1;
    };
  }, [play]);

  return (
    <div className="relative">
      <Level
        className={cn(intro && "c-intro")}
        now={f.now}
        aave={f.aave}
        line={START.line}
        lineMode={f.lineShown ? "on" : "hidden"}
        mood={f.mood}
        mascotMotion={f.mood === "saved" ? "jump" : "squash"}
        mascotPlayKey={f.jump}
        scale={SCALE}
        live={f.live}
        flashKey={f.flash ? 1 + (f.flash % 2) : undefined}
        ribbon={<SampleTag>Example loan</SampleTag>}
        playerOverlay={f.floats.map((x) => (
          <LevelFloat key={x.id} kind={x.kind}>
            {x.text}
          </LevelFloat>
        ))}
        label="Example loan as a level: ETH at $2,716 on a platform, Shield's line at $2,640, Aave's lava at $2,539."
      />
      <div className="mt-4.5 flex min-h-19 flex-col items-stretch justify-between gap-3 rounded-[14px] border-[2.5px] border-ink bg-heads px-4 py-3 shadow-sticker-sm sm:flex-row sm:items-center">
        <p className="m-0 font-semibold leading-snug" aria-live="polite">
          {f.caption}
        </p>
        {!reduced && (
          <button
            type="button"
            className={cn("c-btn c-btn-white c-btn-small shrink-0", f.playing && "invisible")}
            aria-hidden={f.playing || undefined}
            tabIndex={f.playing ? -1 : undefined}
            onClick={() => void play()}
          >
            Play it again
          </button>
        )}
      </div>
    </div>
  );
}
