const INK = "#1b1430";

function Coins({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const cy = y - i * 7;
        return (
          <g key={i}>
            <path d={`M${x - 17} ${cy} v6 a17 6.5 0 0 0 34 0 v-6`} fill="#D69E14" stroke={INK} strokeWidth={2.2} />
            <ellipse cx={x} cy={cy} rx={17} ry={6.5} fill="#ffc93c" stroke={INK} strokeWidth={2.2} />
          </g>
        );
      })}
    </>
  );
}

/** The vault as a cartoon safe with coins and an ETH gem on top: decoration only. */
export function VaultArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 230" className={className} aria-hidden>
      <ellipse cx="130" cy="214" rx="104" ry="10" fill="#9fcff5" opacity=".6" />
      <Coins x={70} y={58} n={4} />
      <Coins x={186} y={48} n={5} />
      <path d="M128 4 L144 30 L128 40 L112 30 Z" fill="#B9A8FF" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M112 30 L128 22 L144 30 M128 4 V22" fill="none" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <rect x="28" y="70" width="204" height="138" rx="22" fill="#6a4cf5" stroke={INK} strokeWidth={4} />
      <rect x="40" y="82" width="180" height="114" rx="14" fill="#8f79ff" stroke={INK} strokeWidth={3} />
      <g className="motion-safe:animate-[spin_1.4s_cubic-bezier(0.34,1.56,0.64,1)_0.3s_1_both] [transform-box:fill-box] [transform-origin:center]">
        <circle cx="130" cy="139" r="40" fill="#FFF7EA" stroke={INK} strokeWidth={4} />
        <path
          d="M130 103 V117 M130 161 V175 M94 139 H108 M152 139 H166 M105 114 L114 123 M146 155 L155 164 M155 114 L146 123 M114 155 L105 164"
          stroke={INK}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </g>
      <circle cx="130" cy="139" r="10" fill="#ffc93c" stroke={INK} strokeWidth={3} />
      <rect x="196" y="122" width="12" height="34" rx="5" fill="#ffc93c" stroke={INK} strokeWidth={3} />
    </svg>
  );
}
