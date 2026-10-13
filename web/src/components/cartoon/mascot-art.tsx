/**
 * The mascot's drawing: one SVG whose parts swap per mood (design/prototype/app.js). Pure markup, no hooks, so the
 * server can render it and the comic strip can embed it. The animated wrapper is `Mascot` in mascot.tsx.
 */

export const INK = "#1B1430";
export const C = {
  ink: INK,
  grape: "#6A4CF5",
  grapeLight: "#8F79FF",
  plate: "#FFF7EA",
  cheek: "#FF9BD8",
  heads: "#FFC93C",
  chill: "#2FD47F",
  lava: "#FF5A4E",
  lavaDeep: "#E2402F",
  sweat: "#8EDBFF",
  grey: "#B9B3CC",
  greyLight: "#D3CEE0",
  white: "#FFFFFF",
} as const;

export type MascotMood = "hello" | "chill" | "careful" | "danger" | "guard" | "arming" | "saved" | "tired" | "sleepy" | "confused" | "curious";

export const MASCOT_MOODS: readonly MascotMood[] = ["hello", "chill", "careful", "danger", "guard", "arming", "saved", "tired", "sleepy", "confused", "curious"];

export const MASCOT_VIEWBOX = "-8 -14 136 152";

const BODY = "M60 128 C34 116 18 94 18 64 L18 26 C18 19 23 15 30 14 C42 12 50 9 60 4 C70 9 78 12 90 14 C97 15 102 19 102 26 L102 64 C102 94 86 116 60 128 Z";

type Arms = "down" | "up" | "flex" | "wave" | "scratch" | "slump";
const ARMS: Record<Arms, [string, string | null]> = {
  down: ["M22 70 Q10 78 13 92", "M98 70 Q110 78 107 92"],
  up: ["M22 62 Q7 52 11 34", "M98 62 Q113 52 109 34"],
  flex: ["M22 66 Q5 64 9 46", "M98 66 Q115 64 111 46"],
  wave: ["M22 70 Q10 78 13 92", null],
  scratch: ["M22 70 Q10 78 13 92", "M98 64 Q117 52 106 36"],
  slump: ["M22 76 Q15 88 19 100", "M98 76 Q105 88 101 100"],
};

type Mouth = "smile" | "grin" | "open" | "wavy" | "o" | "flat" | "squiggle" | "smallo" | "tired";
type Eyes = "dot" | "wide" | "side" | "happy" | "closed" | "half";
type Brows = "worried" | "determined" | "raised";

const BROWS: Record<Brows, string> = {
  worried: "M41 46 L53 42 M67 42 L79 46",
  determined: "M41 41.5 L53 46 M67 46 L79 41.5",
  raised: "M41 45 L53 45 M67 42 Q73 36 79 42",
};

interface MoodSpec {
  eyes: Eyes;
  mouth: Mouth;
  arms: Arms;
  brows?: Brows;
  cheeks?: boolean;
  sweat?: 1 | 2;
  emblem?: "lit" | "arming";
  sparkles?: boolean;
  grey?: boolean;
  zzz?: boolean;
  question?: boolean;
  clock?: boolean;
}

const MOODS: Record<MascotMood, MoodSpec> = {
  hello: { eyes: "dot", mouth: "smile", arms: "wave", cheeks: true },
  chill: { eyes: "dot", mouth: "smile", arms: "down", cheeks: true },
  careful: { eyes: "dot", brows: "worried", mouth: "wavy", arms: "down", cheeks: true, sweat: 1 },
  danger: { eyes: "wide", brows: "worried", mouth: "o", arms: "up", sweat: 2 },
  guard: { eyes: "dot", brows: "determined", mouth: "grin", arms: "flex", cheeks: true, emblem: "lit" },
  arming: { eyes: "dot", brows: "determined", mouth: "flat", arms: "down", cheeks: true, emblem: "arming", clock: true },
  saved: { eyes: "happy", mouth: "open", arms: "up", cheeks: true, emblem: "lit", sparkles: true },
  tired: { eyes: "half", brows: "worried", mouth: "tired", arms: "down", cheeks: true, sweat: 1, emblem: "lit" },
  sleepy: { eyes: "closed", mouth: "flat", arms: "slump", grey: true, zzz: true },
  confused: { eyes: "dot", brows: "raised", mouth: "squiggle", arms: "scratch", cheeks: true, question: true, emblem: "lit" },
  curious: { eyes: "side", mouth: "smallo", arms: "down", cheeks: true },
};

function star5(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)} `;
  }
  return `${d}Z`;
}
export const star4 = (x: number, y: number, s: number) =>
  `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;

function Arm({ d, body, className }: { d: string | null; body: string; className?: string }) {
  if (!d) return null;
  return (
    <g className={className}>
      <path d={d} fill="none" stroke={INK} strokeWidth={13} strokeLinecap="round" />
      <path d={d} fill="none" stroke={body} strokeWidth={7} strokeLinecap="round" />
    </g>
  );
}

function EyesPart({ kind }: { kind: Eyes }) {
  const dot = (dx: number, rx: number, ry: number) => (
    <g className="eyes">
      <ellipse cx={48 + dx} cy={55} rx={rx} ry={ry} fill={INK} />
      <ellipse cx={72 + dx} cy={55} rx={rx} ry={ry} fill={INK} />
      <circle cx={49.8 + dx} cy={52.3} r={1.7} fill="#fff" />
      <circle cx={73.8 + dx} cy={52.3} r={1.7} fill="#fff" />
    </g>
  );
  if (kind === "wide") return dot(0, 5.8, 7.4);
  if (kind === "side") return dot(3.5, 4.8, 6.4);
  if (kind === "happy") return <path d="M42 58 Q48 49 54 58 M66 58 Q72 49 78 58" fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round" />;
  if (kind === "closed") return <path d="M43 56 Q48 59 53 56 M67 56 Q72 59 77 56" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
  if (kind === "half")
    return (
      <>
        <path d="M43.2 54 A4.8 5.4 0 0 0 52.8 54 Z M67.2 54 A4.8 5.4 0 0 0 76.8 54 Z" fill={INK} />
        <path d="M42 54 L54 54 M66 54 L78 54" stroke={INK} strokeWidth={2.8} strokeLinecap="round" />
      </>
    );
  return dot(0, 4.8, 6.4);
}

function MouthPart({ kind }: { kind: Mouth }) {
  switch (kind) {
    case "grin":
      return (
        <>
          <path d="M50 64 L70 64 Q60 78 50 64 Z" fill={INK} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
          <ellipse cx={60} cy={70.5} rx={4} ry={2} fill={C.cheek} />
        </>
      );
    case "open":
      return (
        <>
          <path d="M48 63 L72 63 Q60 82 48 63 Z" fill={INK} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
          <ellipse cx={60} cy={72} rx={5} ry={2.6} fill={C.cheek} />
        </>
      );
    case "wavy":
      return <path d="M51 68 Q55.5 64.5 60 68 T69 68" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    case "o":
      return <ellipse cx={60} cy={68} rx={4.2} ry={5.2} fill={INK} />;
    case "flat":
      return <path d="M54 68 L66 68" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    case "squiggle":
      return <path d="M51 68 Q54 64.5 57 68 T63 68 T69 68" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    case "smallo":
      return <ellipse cx={60} cy={68} rx={3} ry={3.4} fill={INK} />;
    case "tired":
      return <path d="M53 69.5 Q60 65 67 69.5" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    default:
      return <path d="M52 66 Q60 73.5 68 66" fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />;
  }
}

/** Everything inside the mascot's SVG (viewBox MASCOT_VIEWBOX), wrapped in the `bob` group the CSS animates. */
export function MascotParts({ mood }: { mood: MascotMood }) {
  const m = MOODS[mood] ?? MOODS.chill;
  const body = m.grey ? C.grey : C.grape;
  const hi = m.grey ? C.greyLight : C.grapeLight;
  const [la, ra] = ARMS[m.arms] ?? ARMS.down;
  return (
    <g className="bob">
      <Arm d={la} body={body} />
      {m.arms === "wave" ? <Arm d="M98 66 Q114 58 112 38" body={body} className="wave-arm" /> : <Arm d={ra} body={body} />}
      <ellipse cx={47} cy={128} rx={10} ry={6} fill={body} stroke={INK} strokeWidth={3} />
      <ellipse cx={73} cy={128} rx={10} ry={6} fill={body} stroke={INK} strokeWidth={3} />
      <path d={BODY} fill={body} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
      <path d="M27 32 L27 62 C27 80 33 94 42 104" fill="none" stroke={hi} strokeWidth={5} strokeLinecap="round" />
      <rect x={31} y={33} width={58} height={46} rx={21} fill={C.plate} stroke={INK} strokeWidth={3} />
      {m.cheeks && (
        <>
          <ellipse cx={39} cy={65.5} rx={5.2} ry={3.2} fill={C.cheek} opacity={0.9} />
          <ellipse cx={81} cy={65.5} rx={5.2} ry={3.2} fill={C.cheek} opacity={0.9} />
        </>
      )}
      <EyesPart kind={m.eyes} />
      {m.brows && <path d={BROWS[m.brows]} fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />}
      <MouthPart kind={m.mouth} />
      {m.emblem === "lit" ? (
        <path d={star5(60, 101, 10)} fill={C.heads} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      ) : m.emblem === "arming" ? (
        <path className="emblem-arming" d={star5(60, 101, 10)} fill={C.heads} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      ) : (
        <path d={star5(60, 101, 9)} fill="none" stroke={hi} strokeWidth={2.5} strokeLinejoin="round" />
      )}
      {m.sweat && (
        <path className="sweat" d="M96 28 C96 28 90 36 90 40.5 A6 6 0 0 0 102 40.5 C102 36 96 28 96 28 Z" fill={C.sweat} stroke={INK} strokeWidth={2.5} />
      )}
      {m.sweat === 2 && (
        <path className="sweat" d="M22 22 C22 22 17 29 17 32.5 A5 5 0 0 0 27 32.5 C27 29 22 22 22 22 Z" fill={C.sweat} stroke={INK} strokeWidth={2.5} />
      )}
      {m.sparkles &&
        (
          [
            [6, 18, 8],
            [113, 14, 7],
            [116, 50, 5.5],
            [4, 54, 5],
          ] as const
        ).map(([x, y, r]) => <path key={`${x}-${y}`} className="sparkle" d={star4(x, y, r)} fill={C.heads} stroke={INK} strokeWidth={2} strokeLinejoin="round" />)}
      {m.zzz && (
        <g className="zzz" fill="none" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round">
          <path d="M100 18 h8 l-8 8 h8" />
          <path d="M110 4 h6 l-6 6 h6" />
          <path d="M118 -8 h5 l-5 5 h5" />
        </g>
      )}
      {m.question && (
        <>
          <circle cx={110} cy={16} r={11} fill="#fff" stroke={INK} strokeWidth={2.5} />
          <path d="M106 13 Q106 8 110 8 Q114 8 114 12 Q114 15 110 16.5 L110 19" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
          <circle cx={110} cy={23.5} r={1.7} fill={INK} />
        </>
      )}
      {m.clock && (
        <>
          <circle cx={108} cy={16} r={11} fill="#fff" stroke={INK} strokeWidth={2.5} />
          <path d="M108 9.5 V16 L112.5 18.5" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

/** The mascot's face alone, for the logo and the favicon. */
export function MascotFace({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="-4 -2 128 140" className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      <path d={BODY} fill={C.grape} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <rect x={31} y={33} width={58} height={46} rx={21} fill={C.plate} stroke={INK} strokeWidth={6} />
      <ellipse cx={48} cy={56} rx={6} ry={8} fill={INK} />
      <ellipse cx={72} cy={56} rx={6} ry={8} fill={INK} />
    </svg>
  );
}
