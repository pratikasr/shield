import { cx as cn } from "./cx";
import { C, INK, MascotParts } from "./mascot-art";

/** Aave Monad's one liquidation from launch to 5 Oct 2026 (docs/TECH-DECISIONS.md, Verified facts). */
export const REAL_LIQUIDATION = {
  date: "22 Aug 2026",
  block: "98,106,057",
  repaid: "$1,670.69",
  extra: "$87.98",
  shield: "$16.71",
  less: "$71.27",
  tx: "0xa5ce55310328c30e978a1c778a9cd11f95bf08c8eb4f21affb853d44fcfe7794",
  url: "https://monadvision.com/tx/0xa5ce55310328c30e978a1c778a9cd11f95bf08c8eb4f21affb853d44fcfe7794",
} as const;

function CoinStack({ x, y, n, face = C.heads, side = "#D69E14" }: { x: number; y: number; n: number; face?: string; side?: string }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const cy = y - i * 7;
        return (
          <g key={i}>
            <path d={`M${x - 17} ${cy} v6 a17 6.5 0 0 0 34 0 v-6`} fill={side} stroke={INK} strokeWidth={2.2} />
            <ellipse cx={x} cy={cy} rx={17} ry={6.5} fill={face} stroke={INK} strokeWidth={2.2} />
          </g>
        );
      })}
    </>
  );
}

function Lava({ y }: { y: number }) {
  return (
    <>
      <path d={`M0 ${y} Q15 ${y - 8} 30 ${y} T60 ${y} T90 ${y} T120 ${y} T150 ${y} T180 ${y} T210 ${y} T240 ${y} V172 H0 Z`} fill={C.lava} stroke={INK} strokeWidth={2.5} />
      <circle cx={62} cy={y + 16} r={4} fill="#FF9A3C" stroke={INK} strokeWidth={1.8} />
      <circle cx={182} cy={y + 12} r={3} fill="#FF9A3C" stroke={INK} strokeWidth={1.8} />
    </>
  );
}

function Slab({ x, y, w, rot = 0 }: { x: number; y: number; w: number; rot?: number }) {
  return <rect x={x} y={y} width={w} height={16} rx={5} fill="#fff" stroke={INK} strokeWidth={2.5} transform={`rotate(${rot} ${x + w / 2} ${y + 8})`} />;
}

const ETH_FACE = "#B9A8FF";

function Art1() {
  return (
    <svg viewBox="0 0 240 170" aria-hidden>
      <Lava y={138} />
      <Slab x={70} y={74} w={100} />
      <CoinStack x={105} y={64} n={5} face={ETH_FACE} side={C.grape} />
      <CoinStack x={140} y={64} n={3} face={ETH_FACE} side={C.grape} />
      <path d="M188 52 Q182 64 168 72" fill="none" stroke={INK} strokeWidth={2} strokeDasharray="3 3" />
      <circle cx={192} cy={36} r={17} fill={C.heads} stroke={INK} strokeWidth={2.5} />
      <text x={192} y={42} textAnchor="middle" fontFamily="Rubik, sans-serif" fontWeight={800} fontSize={17} fill={INK}>
        $
      </text>
    </svg>
  );
}
function Art2() {
  return (
    <svg viewBox="0 0 240 170" aria-hidden>
      <Lava y={112} />
      <Slab x={66} y={104} w={108} rot={-8} />
      <CoinStack x={100} y={98} n={5} face={ETH_FACE} side={C.grape} />
      <CoinStack x={138} y={92} n={3} face={ETH_FACE} side={C.grape} />
      <path d="M40 40 l8 -18 M56 46 l14 -10 M190 40 l-8 -18 M176 46 l-14 -10" stroke={INK} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}
function Art3() {
  return (
    <svg viewBox="0 0 240 170" aria-hidden>
      <Lava y={130} />
      <Slab x={40} y={122} w={90} rot={-6} />
      <CoinStack x={84} y={116} n={2} face={ETH_FACE} side={C.grape} />
      <path d="M168 0 V20" stroke={INK} strokeWidth={3} />
      <rect x={152} y={18} width={32} height={14} rx={4} fill={C.lava} stroke={INK} strokeWidth={2.5} />
      <CoinStack x={168} y={108} n={9} />
      <path d="M156 32 Q138 60 146 96 M180 32 Q198 60 190 96" fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
      <path d="M156 32 Q138 60 146 96 M180 32 Q198 60 190 96" fill="none" stroke={C.lava} strokeWidth={3.5} strokeLinecap="round" />
    </svg>
  );
}
function Art4() {
  return (
    <svg viewBox="0 0 240 170" aria-hidden>
      <Lava y={146} />
      <path d="M0 104 H240" stroke={C.grape} strokeWidth={5} strokeDasharray="10 7" />
      <Slab x={56} y={80} w={128} />
      <CoinStack x={92} y={70} n={5} face={ETH_FACE} side={C.grape} />
      <CoinStack x={124} y={70} n={3} face={ETH_FACE} side={C.grape} />
      <svg x={146} y={2} width={70} height={78} viewBox="-8 -14 136 152">
        <MascotParts mood="guard" />
      </svg>
      <CoinStack x={200} y={70} n={1} />
    </svg>
  );
}

/**
 * Aave Monad's only liquidation (to 5 Oct 2026) as a four-panel comic: three panels that happened on chain, and a
 * fourth that prices the same repayment at Shield's 1%. Verified numbers, linked to the transaction on MonadVision.
 */
export function ComicStrip({ className }: { className?: string }) {
  const r = REAL_LIQUIDATION;
  return (
    <div className={className}>
      <div className="c-comic">
        <article className="c-comic-panel">
          <p className="c-comic-cap">On Aave Monad, {r.date}</p>
          <div className="c-comic-art">
            <Art1 />
          </div>
          <div className="c-comic-text">
            <span className="c-comic-big">One loan</span>
            <p>Someone borrows USDC against their ETH. Nothing unusual.</p>
          </div>
        </article>
        <article className="c-comic-panel">
          <p className="c-comic-cap">Block {r.block}</p>
          <div className="c-comic-art">
            <Art2 />
          </div>
          <div className="c-comic-text">
            <span className="c-comic-big">Into the lava</span>
            <p>The loan sinks below Aave&rsquo;s line. Liquidators can now step in.</p>
          </div>
        </article>
        <article className="c-comic-panel">
          <p className="c-comic-cap">A liquidator grabs it</p>
          <div className="c-comic-art">
            <Art3 />
          </div>
          <div className="c-comic-text">
            <span className="c-comic-big">{r.extra} extra</span>
            <p>
              It repays {r.repaid} of the loan and takes ETH worth {r.extra} more than that.
            </p>
          </div>
        </article>
        <article className="c-comic-panel" data-whatif="true">
          <p className="c-comic-cap">With Shield on instead</p>
          <div className="c-comic-art">
            <Art4 />
          </div>
          <div className="c-comic-text">
            <span className="c-comic-big">{r.shield} extra</span>
            <p>
              Same {r.repaid} repaid, earlier, at the borrower&rsquo;s own line. That is {r.less} less than the Aave liquidation.
            </p>
          </div>
        </article>
      </div>
      <div className={cn("c-comic-foot")}>
        <span className="c-pill">
          <span className="c-dot" data-tone="on" aria-hidden />
          Panels 1 to 3 happened on chain
        </span>
        <a className="c-link inline-flex min-h-11 items-center" href={r.url} target="_blank" rel="noreferrer">
          See the transaction on MonadVision
        </a>
        <span className="c-small c-muted">Panel 4 prices the same repayment at Shield&rsquo;s 1%. Shield did not exist yet.</span>
      </div>
    </div>
  );
}
