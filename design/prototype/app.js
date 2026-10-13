/* Shield prototype. Static, no build step, no libraries.
   Every number here is a sample, derived from one example loan:
   0.05 ETH collateral, 106.61 USDC debt, ETH at $2,716, health factor 1.0699. */
(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (v, d = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const usd = (v, d = 2) => '$' + fmt(v, d);
  const usd0 = (v) => '$' + fmt(Math.round(v), 0);
  const pct1 = (v) => fmt(v, 1) + '%';
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  const C = {
    ink: '#1B1430', grape: '#6A4CF5', grapeLight: '#8F79FF', plate: '#FFF7EA', cheek: '#FF9BD8',
    heads: '#FFC93C', chill: '#2FD47F', lava: '#FF5A4E', lavaDeep: '#E2402F', sweat: '#8EDBFF',
    grey: '#B9B3CC', greyLight: '#D3CEE0', sky2: '#E2F2FF', skyDeep: '#9FCFF5', white: '#FFFFFF',
  };

  /* ---------------- Sample loan ---------------- */
  const LOAN = { eth: 2716, hf: 1.0699, debt: 106.61, coll: 0.05 };
  const priceAt = (h) => (LOAN.eth * h) / LOAN.hf;
  const dropAt = (h) => (1 - h / LOAN.hf) * 100;
  const AAVE = priceAt(1); // about $2,539, 6.5% below now
  const PRESETS = [
    { id: 'early', name: 'Early', h: 1.06, year: 10.66, note: 'Steps in soonest. Costs the most.' },
    { id: 'balanced', name: 'Balanced', h: 1.04, year: 3.55, note: 'Room to spare at a fair price.' },
    { id: 'last', name: 'Last call', h: 1.02, year: 2.14, note: 'Cheapest. Cuts it closest to Aave.' },
  ];
  const EXIT = { repaid: 26.0, taken: 26.26, aave: 27.43, kept: 1.17, block: 110762418, tx: '0x7c1e9a...4b2a' };
  const REAL = {
    date: '22 Aug 2026', block: '98,106,057', repaid: 1670.69, extra: 87.98, shield: 16.71,
    tx: '0xa5ce55310328c30e978a1c778a9cd11f95bf08c8eb4f21affb853d44fcfe7794',
  };
  const REAL_URL = 'https://monadvision.com/tx/' + REAL.tx;
  const LOANS_WATCHED = 3;

  const state = {
    preset: 'balanced', fuel: 1, source: 'monad', reason: 'approval', vaultTab: 'add', vaultAmt: 1,
    turnStep: 0, busy: false, showAddr: false,
  };
  const preset = () => PRESETS.find((p) => p.id === state.preset);

  function dur(months) {
    if (months >= 11.5) { const y = Math.round(months / 12); return y === 1 ? '1 year' : y + ' years'; }
    const m = Math.max(1, Math.round(months));
    return m === 1 ? '1 month' : m + ' months';
  }
  /* Fuel presets: 1 month, 3 months, 1 year when each costs more than the $1 minimum.
     On a small loan the minimum already buys months, so the shorter cards give way to longer ones. */
  function fuelOptions(p) {
    const month = p.year / 12;
    const MIN = 1;
    const firstAmt = Math.max(MIN, month);
    const first = { m: 1, amt: firstAmt, lasts: firstAmt / month, isMin: month < MIN };
    const need = Math.max(first.lasts * 1.5, 1.5);
    const picks = [3, 12, 6, 24].filter((m) => m >= need).slice(0, 2).sort((a, b) => a - b);
    const out = [{
      label: first.isMin && first.lasts >= 1.5 ? 'Minimum' : '1 month',
      amt: first.amt, lasts: first.lasts,
      sub: first.isMin && first.lasts >= 1.5 ? `$1 is the least you can add. Lasts about ${dur(first.lasts)}.` : `Lasts about ${dur(first.lasts)}.`,
    }];
    picks.forEach((m) => out.push({ label: m === 12 ? '1 year' : m === 24 ? '2 years' : m + ' months', amt: month * m, lasts: m, sub: `Lasts about ${dur(m)} at today's rate.` }));
    return out;
  }
  const fuel = () => fuelOptions(preset())[clamp(state.fuel, 0, 2)];
  const safety = (drop) => (drop >= 15 ? ['Safe', 's-safe'] : drop >= 5 ? ['Careful', 's-careful'] : ['Danger', 's-danger']);

  /* ---------------- Icons ---------------- */
  const sw = `stroke="${C.ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  const ICON = {
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" ${sw} stroke-width="3.5"/></svg>`,
    line: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29c-6-2.6-10-7.5-10-14V7.5c4-.4 7-1.8 10-4.5 3 2.7 6 4.1 10 4.5V15c0 6.5-4 11.4-10 14z" fill="${C.grape}" ${sw}/><path d="M2 17h28" fill="none" ${sw} stroke-dasharray="3 3.5"/></svg>`,
    fuel: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="8" width="16" height="20" rx="3" fill="${C.heads}" ${sw}/><path d="M10 8V5h8v3M22 13l4 3v8a2 2 0 0 1-4 0v-5" fill="none" ${sw}/><path d="M10 14h8" ${sw}/></svg>`,
    lock: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="14" width="18" height="14" rx="3" fill="${C.heads}" ${sw}/><path d="M11 14v-4a5 5 0 0 1 10 0v4" fill="none" ${sw}/><circle cx="16" cy="21" r="2" fill="${C.ink}"/></svg>`,
    warn: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4l13 23H3z" fill="${C.heads}" ${sw}/><path d="M16 12v7" ${sw} stroke-width="3"/><circle cx="16" cy="23" r="1.8" fill="${C.ink}"/></svg>`,
    code: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 9l-7 7 7 7M21 9l7 7-7 7M18 6l-4 20" fill="none" ${sw} stroke-width="3"/></svg>`,
    flask: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12 4h8M13 4v8L6 25a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3l-7-13V4" fill="${C.white}" ${sw}/><path d="M9 21h14l2 4H7z" fill="${C.chill}" ${sw}/></svg>`,
    hand: `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="${C.white}" ${sw}/><path d="M16 9v8l5 3" fill="none" ${sw} stroke-width="3"/></svg>`,
    battery: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="10" width="23" height="13" rx="3" fill="${C.white}" ${sw}/><rect x="6" y="13" width="5" height="7" rx="1" fill="${C.heads}" stroke="${C.ink}" stroke-width="1.5"/><path d="M29 14v5" ${sw} stroke-width="3"/></svg>`,
    wallet: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="8" width="24" height="18" rx="4" fill="${C.white}" ${sw}/><path d="M20 15h8v6h-8a3 3 0 0 1 0-6z" fill="${C.heads}" ${sw}/></svg>`,
    coin: `<svg viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="19" rx="11" ry="5" fill="#D69E14" ${sw}/><ellipse cx="16" cy="15" rx="11" ry="5" fill="${C.heads}" ${sw}/></svg>`,
    shieldMini: `<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 26c-5.5-2.4-9-6.8-9-12.5V6c3.5-.4 6.5-1.6 9-4 2.5 2.4 5.5 3.6 9 4v7.5C21 19.2 17.5 23.6 12 26z" fill="${C.grape}" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 13.5l3 3 5.5-6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  /* ---------------- Mascot ---------------- */
  const BODY = 'M60 128 C34 116 18 94 18 64 L18 26 C18 19 23 15 30 14 C42 12 50 9 60 4 C70 9 78 12 90 14 C97 15 102 19 102 26 L102 64 C102 94 86 116 60 128 Z';
  const ARMS = {
    down: ['M22 70 Q10 78 13 92', 'M98 70 Q110 78 107 92'],
    up: ['M22 62 Q7 52 11 34', 'M98 62 Q113 52 109 34'],
    flex: ['M22 66 Q5 64 9 46', 'M98 66 Q115 64 111 46'],
    wave: ['M22 70 Q10 78 13 92', null],
    scratch: ['M22 70 Q10 78 13 92', 'M98 64 Q117 52 106 36'],
    slump: ['M22 76 Q15 88 19 100', 'M98 76 Q105 88 101 100'],
  };
  const MOUTH = {
    smile: `<path d="M52 66 Q60 73.5 68 66" fill="none" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round"/>`,
    grin: `<path d="M50 64 L70 64 Q60 78 50 64 Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="60" cy="70.5" rx="4" ry="2" fill="${C.cheek}"/>`,
    open: `<path d="M48 63 L72 63 Q60 82 48 63 Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/><ellipse cx="60" cy="72" rx="5" ry="2.6" fill="${C.cheek}"/>`,
    wavy: `<path d="M51 68 Q55.5 64.5 60 68 T69 68" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`,
    o: `<ellipse cx="60" cy="68" rx="4.2" ry="5.2" fill="${C.ink}"/>`,
    flat: `<path d="M54 68 L66 68" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`,
    squiggle: `<path d="M51 68 Q54 64.5 57 68 T63 68 T69 68" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`,
    smallo: `<ellipse cx="60" cy="68" rx="3" ry="3.4" fill="${C.ink}"/>`,
    tired: `<path d="M53 69.5 Q60 65 67 69.5" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`,
  };
  const BROWS = {
    worried: 'M41 46 L53 42 M67 42 L79 46',
    determined: 'M41 41.5 L53 46 M67 46 L79 41.5',
    raised: 'M41 45 L53 45 M67 42 Q73 36 79 42',
  };
  function eyes(kind) {
    const dot = (dx, rx, ry) => `<g class="eyes"><ellipse cx="${48 + dx}" cy="55" rx="${rx}" ry="${ry}" fill="${C.ink}"/><ellipse cx="${72 + dx}" cy="55" rx="${rx}" ry="${ry}" fill="${C.ink}"/><circle cx="${49.8 + dx}" cy="52.3" r="1.7" fill="#fff"/><circle cx="${73.8 + dx}" cy="52.3" r="1.7" fill="#fff"/></g>`;
    if (kind === 'wide') return dot(0, 5.8, 7.4);
    if (kind === 'side') return dot(3.5, 4.8, 6.4);
    if (kind === 'happy') return `<path d="M42 58 Q48 49 54 58 M66 58 Q72 49 78 58" fill="none" stroke="${C.ink}" stroke-width="3.6" stroke-linecap="round"/>`;
    if (kind === 'closed') return `<path d="M43 56 Q48 59 53 56 M67 56 Q72 59 77 56" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`;
    if (kind === 'half') return `<path d="M43.2 54 A4.8 5.4 0 0 0 52.8 54 Z M67.2 54 A4.8 5.4 0 0 0 76.8 54 Z" fill="${C.ink}"/><path d="M42 54 L54 54 M66 54 L78 54" stroke="${C.ink}" stroke-width="2.8" stroke-linecap="round"/>`;
    return dot(0, 4.8, 6.4);
  }
  const star4 = (x, y, s) => `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;
  function star5(cx, cy, r) {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1) + ' ';
    }
    return d + 'Z';
  }
  const MOODS = {
    hello: { eyes: 'dot', mouth: 'smile', arms: 'wave', cheeks: true },
    chill: { eyes: 'dot', mouth: 'smile', arms: 'down', cheeks: true },
    careful: { eyes: 'dot', brows: 'worried', mouth: 'wavy', arms: 'down', cheeks: true, sweat: 1 },
    danger: { eyes: 'wide', brows: 'worried', mouth: 'o', arms: 'up', sweat: 2 },
    guard: { eyes: 'dot', brows: 'determined', mouth: 'grin', arms: 'flex', cheeks: true, emblem: 'lit' },
    arming: { eyes: 'dot', brows: 'determined', mouth: 'flat', arms: 'down', cheeks: true, emblem: 'arming', clock: true },
    saved: { eyes: 'happy', mouth: 'open', arms: 'up', cheeks: true, emblem: 'lit', sparkles: true },
    tired: { eyes: 'half', brows: 'worried', mouth: 'tired', arms: 'down', cheeks: true, sweat: 1, emblem: 'lit' },
    sleepy: { eyes: 'closed', mouth: 'flat', arms: 'slump', grey: true, zzz: true },
    confused: { eyes: 'dot', brows: 'raised', mouth: 'squiggle', arms: 'scratch', cheeks: true, question: true, emblem: 'lit' },
    curious: { eyes: 'side', mouth: 'smallo', arms: 'down', cheeks: true },
  };
  function mascotInner(mood) {
    const m = MOODS[mood] || MOODS.chill;
    const body = m.grey ? C.grey : C.grape;
    const hi = m.grey ? C.greyLight : C.grapeLight;
    const arm = (d, cls = '') => (d ? `<g class="${cls}"><path d="${d}" fill="none" stroke="${C.ink}" stroke-width="13" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${body}" stroke-width="7" stroke-linecap="round"/></g>` : '');
    const [la, ra] = ARMS[m.arms] || ARMS.down;
    let s = '<g class="bob">';
    s += arm(la);
    s += m.arms === 'wave' ? arm('M98 66 Q114 58 112 38', 'wave-arm') : arm(ra);
    s += `<ellipse cx="47" cy="128" rx="10" ry="6" fill="${body}" stroke="${C.ink}" stroke-width="3"/><ellipse cx="73" cy="128" rx="10" ry="6" fill="${body}" stroke="${C.ink}" stroke-width="3"/>`;
    s += `<path d="${BODY}" fill="${body}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>`;
    s += `<path d="M27 32 L27 62 C27 80 33 94 42 104" fill="none" stroke="${hi}" stroke-width="5" stroke-linecap="round"/>`;
    s += `<rect x="31" y="33" width="58" height="46" rx="21" fill="${C.plate}" stroke="${C.ink}" stroke-width="3"/>`;
    if (m.cheeks) s += `<ellipse cx="39" cy="65.5" rx="5.2" ry="3.2" fill="${C.cheek}" opacity=".9"/><ellipse cx="81" cy="65.5" rx="5.2" ry="3.2" fill="${C.cheek}" opacity=".9"/>`;
    s += eyes(m.eyes);
    if (m.brows) s += `<path d="${BROWS[m.brows]}" fill="none" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`;
    s += MOUTH[m.mouth] || MOUTH.smile;
    if (m.emblem === 'lit') s += `<path d="${star5(60, 101, 10)}" fill="${C.heads}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`;
    else if (m.emblem === 'arming') s += `<path class="emblem-arming" d="${star5(60, 101, 10)}" fill="${C.heads}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`;
    else s += `<path d="${star5(60, 101, 9)}" fill="none" stroke="${hi}" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (m.sweat) s += `<path class="sweat" d="M96 28 C96 28 90 36 90 40.5 A6 6 0 0 0 102 40.5 C102 36 96 28 96 28 Z" fill="${C.sweat}" stroke="${C.ink}" stroke-width="2.5"/>`;
    if (m.sweat === 2) s += `<path class="sweat" d="M22 22 C22 22 17 29 17 32.5 A5 5 0 0 0 27 32.5 C27 29 22 22 22 22 Z" fill="${C.sweat}" stroke="${C.ink}" stroke-width="2.5"/>`;
    if (m.sparkles) s += [[6, 18, 8], [113, 14, 7], [116, 50, 5.5], [4, 54, 5]].map(([x, y, r]) => `<path class="sparkle" d="${star4(x, y, r)}" fill="${C.heads}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/>`).join('');
    if (m.zzz) s += `<g class="zzz" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M100 18 h8 l-8 8 h8"/><path d="M110 4 h6 l-6 6 h6"/><path d="M118 -8 h5 l-5 5 h5"/></g>`;
    if (m.question) s += `<circle cx="110" cy="16" r="11" fill="#fff" stroke="${C.ink}" stroke-width="2.5"/><path d="M106 13 Q106 8 110 8 Q114 8 114 12 Q114 15 110 16.5 L110 19" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="110" cy="23.5" r="1.7" fill="${C.ink}"/>`;
    if (m.clock) s += `<circle cx="108" cy="16" r="11" fill="#fff" stroke="${C.ink}" stroke-width="2.5"/><path d="M108 9.5 V16 L112.5 18.5" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>`;
    s += '</g>';
    return s;
  }
  function mascot(mood, cls = '') {
    const delay = (1 + Math.random() * 3).toFixed(2);
    return `<span class="mascot ${cls}" data-mood="${mood}" style="--blink-delay:${delay}s" aria-hidden="true"><svg viewBox="-8 -14 136 152">${mascotInner(mood)}</svg></span>`;
  }
  function setMood(el, mood, anim = 'squash') {
    if (!el) return;
    if (el.dataset.mood === mood) return;
    el.dataset.mood = mood;
    $('svg', el).innerHTML = mascotInner(mood);
    if (reduce) return;
    el.classList.remove('squash', 'jump', 'shake');
    void el.offsetWidth;
    el.classList.add(anim);
  }

  /* ---------------- The level: the floor is lava ---------------- */
  const CLOUD = (w, x, y) => `<svg class="lv-cloud" style="left:${x};top:${y};width:${w}px" viewBox="0 0 120 52" aria-hidden="true"><path d="M14 46 C2 46 2 30 14 30 C12 16 30 10 38 20 C42 6 66 4 72 18 C80 8 100 12 98 28 C112 26 116 46 102 46 Z" fill="#fff"/></svg>`;
  const WAVE = `<svg class="lv-wave" viewBox="0 0 400 18" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9 Q25 0 50 9 T100 9 T150 9 T200 9 T250 9 T300 9 T350 9 T400 9 V18 H0 Z" fill="${C.lava}" stroke="${C.ink}" stroke-width="2.5"/></svg>`;

  function lineTag(mode, line, now) {
    const drop = (1 - line / now) * 100;
    const where = drop <= 0.05 ? 'ETH is right on it' : `${pct1(drop)} below now`;
    if (mode === 'preview') return `<b>Shield would step in at <span class="tnum">${usd0(line)}</span></b>${where}`;
    if (mode === 'arming') return `<b>Shield steps in at <span class="tnum">${usd0(line)}</span></b>Arms in 15 minutes`;
    if (mode === 'off') return `<b>Shield is off</b>Your line was <span class="tnum">${usd0(line)}</span>`;
    if (mode === 'blocked') return `<b>Shield can't step in</b>Your line: <span class="tnum">${usd0(line)}</span>`;
    return `<b>Shield steps in at <span class="tnum">${usd0(line)}</span></b>${where}`;
  }
  const roomText = (now, aave) => `<b>${pct1((1 - aave / now) * 100)}</b>to the lava`;
  const lavaTag = (aave, now) => `<b>Aave liquidates at <span class="tnum">${usd0(aave)}</span></b>${pct1((1 - aave / now) * 100)} below now`;

  function levelHTML(o) {
    const scale = o.scale || { top: o.now, bottom: o.aave - (o.now - o.aave) * 0.4 };
    const f = (p) => clamp((scale.top - p) / (scale.top - scale.bottom), 0, 1).toFixed(4);
    const lineMode = o.lineMode || 'hidden';
    return `<div class="level ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''} data-top="${scale.top}" data-bottom="${scale.bottom}">
      ${CLOUD(118, '42%', '7%')}${CLOUD(150, '78%', '36%')}${CLOUD(96, '-4%', '44%')}
      ${o.ribbon ? `<div class="lv-ribbon">${o.ribbon}</div>` : ''}
      ${o.ghost ? `<div class="lv-ghost lv-y" style="--f:${f(o.ghost)}"><span>Aave's line was <span class="tnum">${usd0(o.ghost)}</span></span></div>` : ''}
      ${o.noRuler ? '' : `<div class="lv-ruler" data-lv="ruler" style="--fn:${f(o.now)};--fa:${f(o.aave)}"><span class="lv-room" data-lv="room">${roomText(o.now, o.aave)}</span></div>`}
      <div class="lv-net lv-y ${lineMode}" data-lv="net" style="--f:${o.line ? f(o.line) : 0}">
        <div class="lv-tag" data-lv="nettag">${o.line ? lineTag(lineMode, o.line, o.now) : ''}</div>
      </div>
      <div class="lv-lava lv-y" data-lv="lava" style="--f:${f(o.aave)}">
        ${WAVE}<i class="lv-bubble" aria-hidden="true"></i><i class="lv-bubble" aria-hidden="true"></i><i class="lv-bubble" aria-hidden="true"></i><i class="lv-bubble" aria-hidden="true"></i>
        ${o.noLavaTag ? '' : `<div class="lv-tag" data-lv="lavatag">${lavaTag(o.aave, o.now)}</div>`}
      </div>
      <div class="lv-player lv-y" data-lv="player" style="--f:${f(o.now)}">
        ${mascot(o.mood || 'chill')}
        <div class="lv-slab" data-lv="slab">${o.slab || `ETH <span class="tnum">&nbsp;${usd0(o.now)}</span><small>now</small>`}</div>
      </div>
    </div>`;
  }
  function updateLevel(el, v) {
    const cur = Object.assign(el._v || {}, v);
    el._v = cur;
    const top = +el.dataset.top, bottom = +el.dataset.bottom;
    const f = (p) => clamp((top - p) / (top - bottom), 0, 1).toFixed(4);
    const player = $('[data-lv=player]', el), net = $('[data-lv=net]', el), lava = $('[data-lv=lava]', el);
    player.style.setProperty('--f', f(cur.now));
    net.style.setProperty('--f', f(cur.line));
    lava.style.setProperty('--f', f(cur.aave));
    const ruler = $('[data-lv=ruler]', el);
    if (ruler) {
      ruler.style.setProperty('--fn', f(cur.now));
      ruler.style.setProperty('--fa', f(cur.aave));
      $('[data-lv=room]', el).innerHTML = roomText(cur.now, cur.aave);
    }
    $('[data-lv=slab]', el).innerHTML = `ETH <span class="tnum">&nbsp;${usd0(cur.now)}</span><small>now</small>`;
    $('[data-lv=nettag]', el).innerHTML = lineTag('on', cur.line, cur.now);
    $('[data-lv=lavatag]', el).innerHTML = lavaTag(cur.aave, cur.now);
  }
  function floatTag(level, text, kind, fromEl) {
    if (reduce) return;
    const lr = level.getBoundingClientRect();
    const r = fromEl.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'lv-float ' + kind;
    t.textContent = text;
    t.style.left = (r.left - lr.left + (kind === 'away' ? r.width * 0.85 : -10)) + 'px';
    t.style.top = (r.top - lr.top + (kind === 'away' ? r.height * 0.35 : -30)) + 'px';
    level.appendChild(t);
    setTimeout(() => t.remove(), 1300);
  }

  /* ---------------- Timers and the block clock ---------------- */
  let timers = [];
  let sceneRun = 0;
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const every = (fn, ms) => { const id = setInterval(fn, ms); timers.push(id); return id; };
  function clearTimers() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; sceneRun++; }

  let block = 110762300;
  let checksToday = 412233;
  function renderDigits(el, str) {
    const old = el.dataset.v || '';
    if (old.length !== str.length || reduce) {
      el.innerHTML = [...str].map((c) => `<span>${c}</span>`).join('');
    } else {
      const spans = el.children;
      for (let i = 0; i < str.length; i++) {
        if (str[i] !== old[i]) {
          const n = document.createElement('span');
          n.textContent = str[i];
          n.className = 'roll';
          el.replaceChild(n, spans[i]);
        }
      }
    }
    el.dataset.v = str;
  }
  function blkHTML(num, isNew) {
    const txs = 3 + ((num * 7) % 11);
    return `<div class="blk${isNew ? ' in' : ''}"><span class="blk-n">#${fmt(num, 0)}</span><span class="blk-txs" aria-hidden="true">${'<i></i>'.repeat(txs)}</span><span class="blk-check">${ICON.shieldMini}${LOANS_WATCHED} checked</span></div>`;
  }
  function tickerHTML() {
    let tiles = '';
    for (let i = 0; i < 14; i++) tiles += blkHTML(block - i, false);
    return `<div class="ticker" data-ticker><div class="ticker-track">${tiles}</div><div class="ticker-fade" aria-hidden="true"></div></div>`;
  }
  function tick() {
    if (document.hidden) return;
    block++;
    checksToday += LOANS_WATCHED;
    const bn = $('#blocknum');
    if (bn) renderDigits(bn, fmt(block, 0));
    const heart = $('.blockchip .heart');
    if (heart && !reduce) { heart.classList.remove('beat'); void heart.offsetWidth; heart.classList.add('beat'); }
    $$('[data-checks]').forEach((el) => renderDigits(el, fmt(checksToday, 0)));
    $$('[data-ticker] .ticker-track').forEach((track) => {
      const holder = document.createElement('div');
      holder.innerHTML = blkHTML(block, !reduce);
      const tile = holder.firstElementChild;
      track.prepend(tile);
      while (track.children.length > 16) track.lastElementChild.remove();
      if (!reduce) {
        const w = tile.offsetWidth + 10;
        track.style.transition = 'none';
        track.style.transform = `translateX(-${w}px)`;
        void track.offsetWidth;
        track.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
        track.style.transform = 'translateX(0)';
      }
    });
  }

  /* ---------------- Celebration helpers ---------------- */
  function confetti(fromEl) {
    if (reduce || !fromEl) return;
    const box = $('#confetti');
    const r = fromEl.getBoundingClientRect();
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    const colors = [C.grape, C.chill, C.heads, C.lava, C.cheek, '#85E6FF', '#FFFFFF'];
    for (let i = 0; i < 72; i++) {
      const p = document.createElement('i');
      p.className = 'cf' + (i % 3 === 0 ? ' round' : '');
      p.style.left = ox + 'px';
      p.style.top = oy + 'px';
      p.style.background = colors[i % colors.length];
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * 300;
      p.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
      p.style.setProperty('--up', (-90 - Math.random() * 230).toFixed(0) + 'px');
      p.style.setProperty('--down', (160 + Math.random() * 340).toFixed(0) + 'px');
      p.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      p.style.setProperty('--dur', (1.1 + Math.random() * 0.7).toFixed(2) + 's');
      box.appendChild(p);
      setTimeout(() => p.remove(), 2100);
    }
  }
  function countUps(root) {
    $$('[data-count]', root).forEach((el) => {
      const to = +el.dataset.count, dec = +(el.dataset.dec || 0), pre = el.dataset.prefix || '';
      const show = (v) => { el.textContent = pre + fmt(v, dec); };
      if (reduce) return show(to);
      const t0 = performance.now(), dur = +(el.dataset.dur || 900);
      show(0);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        show(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------------- Comic strip: the one real liquidation ---------------- */
  function coinStack(x, y, n, face = C.heads, side = '#D69E14') {
    let s = '';
    for (let i = 0; i < n; i++) {
      const cy = y - i * 7;
      s += `<path d="M${x - 17} ${cy} v6 a17 6.5 0 0 0 34 0 v-6" fill="${side}" stroke="${C.ink}" stroke-width="2.2"/><ellipse cx="${x}" cy="${cy}" rx="17" ry="6.5" fill="${face}" stroke="${C.ink}" stroke-width="2.2"/>`;
    }
    return s;
  }
  const lavaArt = (y) => `<path d="M0 ${y} Q15 ${y - 8} 30 ${y} T60 ${y} T90 ${y} T120 ${y} T150 ${y} T180 ${y} T210 ${y} T240 ${y} V172 H0 Z" fill="${C.lava}" stroke="${C.ink}" stroke-width="2.5"/><circle cx="62" cy="${y + 16}" r="4" fill="#FF9A3C" stroke="${C.ink}" stroke-width="1.8"/><circle cx="182" cy="${y + 12}" r="3" fill="#FF9A3C" stroke="${C.ink}" stroke-width="1.8"/>`;
  const slab = (x, y, w, rot = 0) => `<rect x="${x}" y="${y}" width="${w}" height="16" rx="5" fill="#fff" stroke="${C.ink}" stroke-width="2.5" transform="rotate(${rot} ${x + w / 2} ${y + 8})"/>`;
  function comicHTML() {
    const p1 = `<svg viewBox="0 0 240 170" aria-hidden="true">${lavaArt(138)}${slab(70, 74, 100)}${coinStack(105, 64, 5, '#B9A8FF', C.grape)}${coinStack(140, 64, 3, '#B9A8FF', C.grape)}<path d="M188 52 Q182 64 168 72" fill="none" stroke="${C.ink}" stroke-width="2" stroke-dasharray="3 3"/><circle cx="192" cy="36" r="17" fill="${C.heads}" stroke="${C.ink}" stroke-width="2.5"/><text x="192" y="42" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="17" fill="${C.ink}">$</text></svg>`;
    const p2 = `<svg viewBox="0 0 240 170" aria-hidden="true">${lavaArt(112)}${slab(66, 104, 108, -8)}${coinStack(100, 98, 5, '#B9A8FF', C.grape)}${coinStack(138, 92, 3, '#B9A8FF', C.grape)}<path d="M40 40 l8 -18 M56 46 l14 -10 M190 40 l-8 -18 M176 46 l-14 -10" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/></svg>`;
    const p3 = `<svg viewBox="0 0 240 170" aria-hidden="true">${lavaArt(130)}${slab(40, 122, 90, -6)}${coinStack(84, 116, 2, '#B9A8FF', C.grape)}<path d="M168 0 V20" stroke="${C.ink}" stroke-width="3"/><rect x="152" y="18" width="32" height="14" rx="4" fill="${C.lava}" stroke="${C.ink}" stroke-width="2.5"/>${coinStack(168, 108, 9, C.heads, '#D69E14')}<path d="M156 32 Q138 60 146 96 M180 32 Q198 60 190 96" fill="none" stroke="${C.ink}" stroke-width="8" stroke-linecap="round"/><path d="M156 32 Q138 60 146 96 M180 32 Q198 60 190 96" fill="none" stroke="${C.lava}" stroke-width="3.5" stroke-linecap="round"/></svg>`;
    const p4 = `<svg viewBox="0 0 240 170" aria-hidden="true">${lavaArt(146)}<path d="M0 104 H240" stroke="${C.grape}" stroke-width="5" stroke-dasharray="10 7"/>${slab(56, 80, 128)}${coinStack(92, 70, 5, '#B9A8FF', C.grape)}${coinStack(124, 70, 3, '#B9A8FF', C.grape)}<svg x="146" y="2" width="70" height="78" viewBox="-8 -14 136 152">${mascotInner('guard')}</svg>${coinStack(200, 70, 1, C.heads, '#D69E14')}</svg>`;
    return `<div class="comic">
      <article class="panel"><p class="panel-cap">On Aave Monad, ${REAL.date}</p><div class="panel-art">${p1}</div><div class="panel-text"><span class="panel-big">One loan</span><p>Someone borrows USDC against their ETH. Nothing unusual.</p></div></article>
      <article class="panel"><p class="panel-cap">Block ${REAL.block}</p><div class="panel-art">${p2}</div><div class="panel-text"><span class="panel-big">Into the lava</span><p>The loan sinks below Aave's line. Liquidators can now step in.</p></div></article>
      <article class="panel"><p class="panel-cap">A liquidator grabs it</p><div class="panel-art">${p3}</div><div class="panel-text"><span class="panel-big">${usd(REAL.extra)} extra</span><p>It repays ${usd(REAL.repaid)} of the loan and takes ETH worth ${usd(REAL.extra)} more than that.</p></div></article>
      <article class="panel whatif"><p class="panel-cap">With Shield on instead</p><div class="panel-art">${p4}</div><div class="panel-text"><span class="panel-big">${usd(REAL.shield)} extra</span><p>Same ${usd(REAL.repaid)} repaid, earlier, at the borrower's own line. They keep ${usd(REAL.extra - REAL.shield)} more.</p></div></article>
    </div>
    <div class="comic-foot">
      <span class="pill"><span class="dot" style="background:${C.chill}"></span>Panels 1 to 3 happened on chain</span>
      <a href="${REAL_URL}" target="_blank" rel="noopener">See the transaction on MonadVision</a>
      <span class="small muted">Panel 4 prices the same repayment at Shield's 1%. Shield did not exist yet.</span>
    </div>`;
  }

  /* ---------------- Landing ---------------- */
  const SCENE = { top: 2716, bottom: 2360, now: 2716, line: priceAt(1.04), aave: AAVE };
  const SCENE_END = { now: priceAt(1.04), line: (priceAt(1.04) * 1.04) / 1.1, aave: priceAt(1.04) / 1.1 };

  function renderLanding() {
    const main = $('#main');
    main.innerHTML = `
    <section class="hero ${reduce ? '' : 'intro'}">
      <div class="wrap hero-grid">
        <div class="hero-top">
          <div class="btn-row" style="gap:10px"><span class="sticker s-careful">Not audited yet</span><span class="pill">For Aave V3 on Monad</span></div>
          <h1>The floor is lava. Shield steps in first.</h1>
        </div>
        <div class="hero-rest">
          <p class="lead">Pick an ETH price. If ETH falls to it, Shield pays back part of your Aave loan and takes a slice of your ETH worth that amount plus 1%. Aave's liquidators take 5.5%.</p>
          <div class="btn-row"><a class="btn" href="#/protect">Protect my loan</a><button class="btn btn-white" type="button" data-scroll="how">How it works</button></div>
          <p class="fine small muted">For loans with ETH as collateral and USDC borrowed. Shield does not sell your ETH on the market; the slice goes to Shield's vault.</p>
        </div>
        <div class="scene-wrap">
          ${levelHTML({ id: 'scene', cls: 'scene' + (reduce ? '' : ' pre-lava pre-net pre-player'), scale: SCENE, now: SCENE.now, line: SCENE.line, aave: SCENE.aave, lineMode: 'on', mood: 'chill', ribbon: '<span class="sample">Sample numbers</span>' })}
          <div class="scene-caption"><p id="scene-cap" aria-live="polite">ETH is at $2,716. Aave's line is 6.5% below. Shield's line sits in between.</p><button class="btn btn-small btn-white" type="button" id="scene-replay" data-act="replay" hidden>Play it again</button></div>
        </div>
      </div>
    </section>

    <section class="section band" id="how">
      <div class="wrap">
        <div class="section-head"><h2>Three steps, then Shield keeps watch.</h2><p>No dashboards to babysit. You pick a price, add a little fuel, and Shield checks your loan in every Monad block.</p></div>
        <ol class="steps">
          <li class="step"><div class="step-node" aria-hidden="true">1</div><div class="card"><h3>Pick when Shield steps in</h3><p>Choose a price for ETH below today's. Early costs more and acts sooner. Last call is cheapest and cuts it closer.</p><div class="mini"><span class="pill">Early</span><span class="pill" style="background:var(--grape-tint)">Balanced</span><span class="pill">Last call</span></div></div></li>
          <li class="step"><div class="step-node" aria-hidden="true">2</div><div class="card"><h3>Add a little fuel</h3><p>Prepay some USDC, from Monad or from another chain. It burns slowly while Shield is on. Take back what you don't use, any time.</p><div class="mini"><span class="pill">USDC on Monad</span><span class="pill">Base</span><span class="pill">Arbitrum</span><span class="pill">Ethereum</span></div></div></li>
          <li class="step"><div class="step-node" aria-hidden="true">3</div><div class="card"><h3>Shield steps in for you</h3><p>If ETH hits your price, Shield pays back part of your loan and takes ETH worth that plus 1%. You keep the rest, and Aave's line drops away.</p><div class="mini"><span class="pill"><span class="dot" style="background:var(--chill)"></span>Checks every 0.3 s</span></div></div></li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head"><h2>The one liquidation on Aave Monad so far.</h2><p>It cost the borrower ${usd(REAL.extra)} on top of what was repaid. Here it is, four panels long.</p></div>
        ${comicHTML()}
      </div>
    </section>

    <section class="section band">
      <div class="wrap monad-grid">
        <div>
          <h2>Built for Monad's 0.3 second blocks.</h2>
          <p style="font-size:19px;margin-top:14px">Monad makes a new block every 0.3 seconds, so Shield checks your loan about 200 times a minute. When ETH touches your line, the next block can already carry the rescue.</p>
          <div class="works"><span class="pill">Works with Aave V3</span><span class="pill">Prices from Pyth</span><span class="pill">History by Envio</span></div>
        </div>
        <div>${tickerHTML()}<div class="ticker-meta"><span class="sample">Sample stream</span><span class="muted small">Each tile is a block. The purple stamp is Shield checking every protected loan.</span></div></div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head"><h2>Straight talk.</h2><p>Shield is new. Here is exactly where it stands.</p></div>
        <div class="trust">
          <div class="card"><div class="badge">${ICON.code}</div><h3>Open source</h3><p>Every contract and this site are public on <a href="https://github.com/pratikasr/shield">GitHub</a>, MIT licensed.</p></div>
          <div class="card"><div class="badge">${ICON.flask}</div><h3>Tested on real Aave</h3><p>The tests run against copies of Aave on Monad mainnet, not a mock lender.</p></div>
          <div class="card warn"><div class="badge">${ICON.warn}</div><h3>Not audited yet</h3><p>No security firm has reviewed the contracts. Use money you can afford to lose.</p></div>
          <div class="card warn"><div class="badge">${ICON.hand}</div><h3>Best effort</h3><p>If ETH jumps past your line in one move, Aave can still liquidate you. If nobody steps in, you are where you'd be without Shield.</p></div>
        </div>
      </div>
    </section>

    <section class="section band">
      <div class="wrap">
        <div class="section-head"><h2>Questions.</h2></div>
        <div class="faq">
          <details><summary>What does it cost?</summary><div><p>A small amount every block while Shield is on, taken from the fuel you prepay. On a $100 loan that is about $0.30 a month at the Balanced line. It costs more when ETH gets wild or when your line sits close to today's price. When Shield steps in, it also takes 1% of what it repays.</p></div></details>
          <details><summary>Does Shield sell my ETH?</summary><div><p>No. Shield pays back part of your loan with its own USDC, then takes a slice of your ETH worth the repaid amount plus 1%. The slice goes into Shield's vault. Your remaining ETH stays on Aave.</p></div></details>
          <details><summary>Can Shield stop every liquidation?</summary><div><p>No. If ETH jumps straight past your line in one move, or nobody can step in in time, Aave can still liquidate you. If Shield doesn't step in, you are exactly where you'd be without it.</p></div></details>
          <details><summary>Why does it take 15 minutes to switch on?</summary><div><p>New cover starts 15 minutes after you turn it on, so nobody can buy it at the last second, when a crash is already under way. That keeps it cheap for everyone else.</p></div></details>
          <details><summary>What happens when the fuel runs out?</summary><div><p>Shield switches off and the page tells you. Add fuel and it re-arms 15 minutes later. You can take back unused fuel any time.</p></div></details>
          <details><summary>Who presses the button?</summary><div><p>Shield's bot checks every protected loan in every block. If it is ever late, anyone can trigger the rescue once ETH is at your line, including you, from this site. The contracts check every condition.</p></div></details>
        </div>
      </div>
    </section>

    <section class="final">
      <div class="wrap"><div class="card">${mascot('guard')}<div><h2>Set your line before ETH moves.</h2><p style="margin:10px 0 0">Takes four wallet prompts. Cover starts 15 minutes later.</p></div><a class="btn" href="#/protect">Protect my loan</a></div></div>
    </section>`;
    playScene(true);
  }

  async function tween(ms, fn) {
    const run = sceneRun;
    const t0 = performance.now();
    return new Promise((res) => {
      const step = (t) => {
        if (run !== sceneRun) return res(false);
        const k = Math.min(1, (t - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step); else res(true);
      };
      requestAnimationFrame(step);
    });
  }

  async function playScene(first) {
    const run = ++sceneRun;
    const ok = () => run === sceneRun && document.body.contains(sc);
    const sc = $('#scene');
    if (!sc) return;
    const cap = $('#scene-cap'), replay = $('#scene-replay');
    const player = $('[data-lv=player]', sc), net = $('[data-lv=net]', sc);
    const pm = () => $('.mascot', player);
    const say = (t) => { cap.textContent = t; };
    const endText = `Shield paid back $26 of the loan and took ETH worth $26.26. Aave's line dropped to ${usd0(SCENE_END.aave)}. A liquidation would have cost $1.17 more. Job done: set a new line any time.`;
    replay.hidden = true;
    net.classList.remove('hidden');
    if (reduce) {
      updateLevel(sc, SCENE_END);
      net.classList.add('hidden');
      setMood(pm(), 'saved');
      say(endText);
      replay.hidden = false;
      return;
    }
    updateLevel(sc, { now: SCENE.now, line: SCENE.line, aave: SCENE.aave });
    setMood(pm(), 'chill', 'squash');
    say('ETH is at $2,716. Aave\'s line is 6.5% below. Shield\'s line sits in between.');
    if (first) {
      await sleep(250); if (!ok()) return;
      sc.classList.remove('pre-lava');
      await sleep(380); if (!ok()) return;
      sc.classList.remove('pre-net');
      await sleep(300); if (!ok()) return;
      player.classList.add('drop-in');
      sc.classList.remove('pre-player');
      await sleep(1150); if (!ok()) return;
      player.classList.remove('drop-in');
    }
    await sleep(900); if (!ok()) return;
    say('ETH starts to fall.');
    player.classList.add('live');
    const ruler = $('[data-lv=ruler]', sc);
    if (ruler) ruler.style.transition = 'none';
    let moodSet = false;
    const fine = await tween(2000, (k) => {
      const now = SCENE.now - (SCENE.now - SCENE.line) * ease(k);
      updateLevel(sc, { now });
      if (!moodSet && k > 0.4) { moodSet = true; setMood(pm(), 'careful'); }
    });
    player.classList.remove('live');
    if (ruler) ruler.style.transition = '';
    if (!fine || !ok()) return;
    setMood(pm(), 'guard');
    net.classList.remove('flash'); void net.offsetWidth; net.classList.add('flash');
    say(`ETH hits your line at ${usd0(SCENE.line)}. Shield steps in.`);
    floatTag(sc, 'Pays back $26 of the loan', 'up', pm());
    await sleep(650); if (!ok()) return;
    floatTag(sc, 'Takes ETH worth $26.26', 'away', pm());
    await sleep(1200); if (!ok()) return;
    updateLevel(sc, { aave: SCENE_END.aave });
    net.classList.add('hidden');
    await sleep(250); if (!ok()) return;
    setMood(pm(), 'saved', 'jump');
    say(endText);
    replay.hidden = false;
  }

  /* ---------------- Protect ---------------- */
  const STATES = [
    ['disconnected', 'Not connected'], ['noloan', 'No Aave loan'], ['setup', 'Not protected'], ['turning', 'Turning on'],
    ['arming', 'Arming'], ['protected', 'Protected'], ['lowfuel', 'Low fuel'], ['outoffuel', 'Out of fuel'],
    ['blocked', 'Something blocks the exit'], ['steppedin', 'Shield stepped in'],
  ];
  const REASONS = {
    approval: { chip: 'Approval removed', say: 'The permission that lets Shield take its slice of your ETH was removed.', title: 'Allow it again', text: 'One wallet prompt. Shield can use it only during a rescue, and only for what it is owed.', btn: 'Approve in wallet' },
    emode: { chip: 'eMode', say: 'Your Aave loan is in eMode. Shield can\'t step in on eMode loans yet.', title: 'Leave eMode on Aave', text: 'Switch eMode off in the Aave app. Shield picks your loan back up in the next block.', btn: 'Open Aave' },
    oracle: { chip: 'Prices disagree', say: 'Pyth\'s ETH price and Aave\'s are more than 2% apart right now, so Shield waits rather than act on a bad price.', title: 'Nothing to do but wait', text: 'Shield checks again every block and steps in as soon as the two prices agree.', btn: 'Check again', white: true },
    ltv0: { chip: 'Dead collateral', say: 'One of your Aave deposits counts for nothing as collateral, and while it is switched on, Aave won\'t let anyone move your ETH.', title: 'Switch that deposit off as collateral', text: 'In the Aave app, turn off "Use as collateral" for it. Your ETH stays where it is.', btn: 'Open Aave' },
    discount: { chip: 'Price above your max', say: 'A rescue now would take 1.5% extra, above the 1% maximum you set.', title: 'Raise your maximum to 1.5%', text: 'One wallet prompt. Aave\'s liquidators take 5.5%.', btn: 'Raise to 1.5%' },
  };

  function protoStrip(cur) {
    const chips = STATES.map(([id, label]) => `<button class="chip" type="button" data-state="${id}" aria-pressed="${id === cur}">${label}</button>`).join('');
    const sub = cur === 'blocked'
      ? `<div class="proto-sub"><span class="proto-label">Reason:</span>${Object.entries(REASONS).map(([id, r]) => `<button class="chip" type="button" data-reason="${id}" aria-pressed="${id === state.reason}">${r.chip}</button>`).join('')}</div>`
      : '';
    const sel = `<label class="proto-select">Prototype: switch state<select data-proto="state">${STATES.map(([id, label]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`
      + (cur === 'blocked' ? `<label class="proto-select">Reason<select data-proto="reason">${Object.entries(REASONS).map(([id, r]) => `<option value="${id}" ${id === state.reason ? 'selected' : ''}>${r.chip}</option>`).join('')}</select></label>` : '');
    return `<div class="proto" role="group" aria-label="Prototype controls"><span class="proto-label">Prototype: switch state</span>${chips}${sub}${sel}</div>`;
  }
  function loanLine(st) {
    const ico = ICON.wallet.replace('<svg', '<svg width="18" height="18"');
    let text = `Your Aave loan: 0.05 ETH (${usd(LOAN.eth * LOAN.coll)}) in, ${usd(LOAN.debt)} USDC borrowed`;
    if (st === 'noloan') text = 'Wallet 0x3C4a...93BC: no Aave loan found';
    if (st === 'steppedin') {
      const p = preset(), price = priceAt(p.h), eth = LOAN.coll - EXIT.taken / price;
      text = `Your Aave loan now: ${fmt(eth, 4)} ETH (${usd(eth * price)}) in, ${usd(LOAN.debt - EXIT.repaid)} USDC borrowed`;
    }
    return `<div class="page-head"><div class="loanline"><span class="pill">${ico}${text}</span><span class="sample">Sample numbers</span></div></div>`;
  }
  function nerds(extra = []) {
    const p = preset();
    const rows = [
      ['Health factor', '1.069'], ['Aave liquidates at health factor', '1.00'],
      ['Shield steps in at health factor', fmt(p.h, 2)], ['A rescue brings it back to', fmt(p.h + 0.06, 2)],
      ['ETH price on Aave', usd(LOAN.eth)], ['ETH price on Pyth', '$2,716.31 (0.01% apart)'],
      ['Collateral', '0.05 ETH (' + usd(LOAN.eth * LOAN.coll) + ')'], ['Borrowed', fmt(LOAN.debt) + ' USDC'],
      ['Aave liquidation threshold', '84.0%'], ['ETH volatility, from Pyth', '80% a year'],
      ['Cost per block', '$' + (p.year / 105120000).toFixed(10)], ['Rescue price', '1% of what it repays'],
      ['If Aave liquidated all of it', 'about $5.86 to liquidators'], ['Shield contracts', 'Registry 0x3C2B...01e9, Executor 0x4Dd5...c891'],
      ...extra,
    ];
    return `<details class="nerds"><summary>Stats for nerds</summary><div class="nerd-body"><p class="small muted" style="margin:0 0 6px">Sample numbers. On the real page these come from Aave, Pyth and Shield's contracts.</p><dl class="nerd-grid">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></div></details>`;
  }
  function statusRow(sticker, cls, pill) {
    return `<div class="status-row"><span class="sticker ${cls} pop">${sticker}</span>${pill ? `<span class="pill ${pill[0]}"><span class="dot"></span>${pill[1]}</span>` : ''}</div>`;
  }
  function factsCard(opts = {}) {
    const p = preset(), fo = fuel();
    const price = priceAt(p.h);
    const segs = opts.fuelSegs != null ? opts.fuelSegs : clamp(Math.round(fo.lasts / 1.2), 3, 10);
    const bar = Array.from({ length: 10 }, (_, i) => `<i class="${i < segs ? '' : 'empty'}"></i>`).join('');
    const fuelLine = opts.fuelText || `Paid up for about ${dur(fo.lasts)}`;
    return `<div class="card facts">
      <div class="fact"><div class="ico">${ICON.line}</div><div><h3>When Shield steps in</h3><span class="big">ETH at ${usd0(price)}</span><p>That's ${pct1(dropAt(p.h))} below now. Shield pays back about $26 of your loan and takes ETH worth $26.26, the repaid amount plus 1%. Aave's liquidators would take $27.43 for the same repayment.</p></div></div>
      <div class="fact"><div class="ico">${ICON.fuel}</div><div><h3>What it costs</h3><span class="big">${usd(p.year / 12)} a month</span><p>About ${usd(p.year)} a year while your loan stays this size. More when ETH gets wild.</p>
        <div class="fuel"><div class="fuel-bar ${opts.fuelCls || ''}" role="img" aria-label="${fuelLine}">${bar}</div><b class="small">${fuelLine}</b></div></div></div>
    </div>`;
  }
  function choiceCards() {
    const p0 = preset();
    const presets = PRESETS.map((p) => `<button class="choice" type="button" role="radio" aria-checked="${p.id === p0.id}" data-preset="${p.id}">
        <span class="check" aria-hidden="true">${ICON.check}</span>
        <span class="c-name">${p.name}</span>
        <span class="c-big">${usd0(priceAt(p.h))}</span>
        <span class="c-sub">${pct1(dropAt(p.h))} below today</span>
        <span class="c-cost">${usd(p.year / 12)} a month</span>
        <span class="c-note">${p.note}</span>
      </button>`).join('');
    const fo = fuelOptions(p0);
    const fuels = fo.map((f, i) => `<button class="choice" type="button" role="radio" aria-checked="${i === state.fuel}" data-fuel="${i}">
        <span class="check" aria-hidden="true">${ICON.check}</span>
        <span class="c-name">${f.label}</span>
        <span class="c-big">${usd(f.amt)}</span>
        <span class="c-sub">${f.sub}</span>
      </button>`).join('');
    return { presets, fuels };
  }

  function protectView(st) {
    const p = preset(), fo = fuel();
    const price = priceAt(p.h);
    const drop = dropAt(1);
    const [sWord, sCls] = safety(drop);
    const base = { now: LOAN.eth, aave: AAVE, line: price };
    let head = '', level = '', body = '';

    if (st === 'disconnected') {
      head = `<h1>Is your Aave loan safe?</h1><p class="say" style="margin-top:12px">Connect your wallet and Shield shows how far ETH can fall before Aave liquidates you, in dollars, plus the price where Shield would step in first.</p>`;
      level = levelHTML({ ...base, lineMode: 'preview', mood: 'hello', cls: 'dim', ribbon: '<span class="pill">Example loan</span><span class="sample">Sample numbers</span>' });
      body = `<div class="card connect-box">
          <button class="btn btn-big" type="button" data-goto="setup">Connect wallet</button>
          <button class="btn btn-white" type="button" data-act="addr">Check any wallet</button>
          <form class="addr-form" ${state.showAddr ? '' : 'hidden'} data-form="addr"><label class="visually-hidden" for="addr">Wallet address</label><input id="addr" placeholder="Paste a wallet address, 0x..." autocomplete="off"><button class="btn btn-small" type="submit">Check</button></form>
          <p class="hint">Checking a wallet is read only. Nothing is signed and nothing moves.</p>
        </div>
        <div class="card"><h3 style="font-size:22px;margin-bottom:8px">What you'll see</h3><p style="margin:0">Your loan as a level: ETH's price is the ground you stand on, Aave's line is the lava. Pick a line above the lava and Shield steps in there, before Aave does.</p></div>`;
    } else if (st === 'noloan') {
      head = `${statusRow('No loan yet', 's-none')}<h1>No Aave loan in this wallet.</h1><p class="say" style="margin-top:12px">Shield protects Aave V3 loans on Monad with ETH as collateral and USDC borrowed.</p>`;
      level = levelHTML({ now: 2716, aave: 2400, scale: { top: 2716, bottom: 2340 }, mood: 'curious', noLavaTag: true, noRuler: true, slab: 'No loan here' });
      body = `<div class="card"><h3 style="margin-bottom:12px">To use Shield</h3><ol style="margin:0 0 18px;padding-left:22px;display:grid;gap:6px"><li>Deposit ETH on Aave V3 Monad.</li><li>Borrow USDC against it, outside eMode.</li><li>Come back here and pick your line.</li></ol><div class="btn-row"><a class="btn" href="https://app.aave.com/" target="_blank" rel="noopener">Open Aave</a><button class="linkbtn" type="button" data-goto="disconnected">Check another wallet</button></div></div>
        <div class="alert grape"><div class="ai">${ICON.warn}</div><div><h3>Have a loan but it isn't showing?</h3><p>Shield can't cover loans in eMode, or loans with collateral other than ETH, yet. Leave eMode on Aave and it shows up here.</p></div></div>`;
    } else if (st === 'setup') {
      const { presets, fuels } = choiceCards();
      head = `${statusRow(sWord, sCls, ['off', 'Shield is off'])}<h1>ETH can fall ${pct1(drop)} before Aave liquidates you.</h1><p class="say">That's ETH at <b class="tnum">${usd0(AAVE)}</b>. Pick a price above it where Shield steps in first.</p>`;
      level = levelHTML({ ...base, lineMode: 'preview', mood: 'careful', id: 'plevel' });
      body = `<section class="qblock" aria-labelledby="q1"><div class="qhead"><span class="qn" aria-hidden="true">1</span><h3 id="q1">When should Shield step in?</h3></div><div class="choices" role="radiogroup" aria-labelledby="q1">${presets}</div></section>
        <section class="qblock" aria-labelledby="q2"><div class="qhead"><span class="qn" aria-hidden="true">2</span><h3 id="q2">How much fuel?</h3></div><p class="hint">Fuel is USDC you prepay. It burns slowly while Shield is on. Take back what's left any time.</p><div class="choices" role="radiogroup" aria-labelledby="q2">${fuels}</div>
          <div class="seg" role="radiogroup" aria-label="Pay with"><button type="button" role="radio" aria-checked="${state.source === 'monad'}" data-source="monad"><span class="ring"></span>USDC on Monad</button><button type="button" role="radio" aria-checked="${state.source === 'other'}" data-source="other"><span class="ring"></span>From another chain</button></div>
          ${state.source === 'other' ? '<p class="hint">Pay with USDC or USDT from Base, Arbitrum or Ethereum. It lands as fuel on Monad. No MON, no network switch.</p>' : ''}
        </section>
        <div class="card summary-card"><p class="say-big">If ETH falls to <b class="tnum">${usd0(price)}</b>, Shield pays back about $26 of your loan and takes ETH worth that plus 1%. You pay <b class="tnum">${usd(fo.amt)}</b> now, enough for about ${dur(fo.lasts)}.</p>
          <button class="btn btn-big" type="button" data-goto="turning">Turn on Shield</button>
          <p class="hint after">${state.source === 'other' ? 'Three' : 'Four'} wallet prompts. Shield arms 15 minutes after the last one.</p></div>
        ${nerds()}`;
    } else if (st === 'turning') {
      head = `${statusRow('Turning on', 's-arming')}<h1>Turning on Shield.</h1><p class="say">A few wallet prompts. Here is what each one is for.</p>`;
      level = levelHTML({ ...base, lineMode: 'preview', mood: 'arming' });
      body = `<div class="card" id="turn">${turnInner()}</div>`;
    } else if (st === 'arming') {
      head = `${statusRow('Arming', 's-arming', ['on', 'Shield is on'])}<h1>Shield is arming.</h1><p class="say">New cover starts 15 minutes after you turn it on, so nobody can buy it at the last second, when a crash is already under way.</p>`;
      level = levelHTML({ ...base, lineMode: 'arming', mood: 'arming' });
      body = `<div class="card countdown"><div class="ring" role="timer" aria-label="Time until Shield arms"><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="face" cx="80" cy="80" r="77"/><circle class="track-c" cx="80" cy="80" r="64"/><circle class="prog" id="ringprog" cx="80" cy="80" r="64" stroke-dasharray="402.1" stroke-dashoffset="0"/><circle class="outline" cx="80" cy="80" r="56"/><circle class="outline" cx="80" cy="80" r="72"/></svg><span class="time" id="ringtime">15:00</span></div>
          <div><h3 style="margin-bottom:6px">Arms in 15 minutes</h3><p>Until then Shield can't step in, even if ETH hits your line at <b class="tnum">${usd0(price)}</b>. After that it watches every block.</p><button class="linkbtn" type="button" data-goto="protected">Skip the wait (prototype only)</button></div></div>
        ${factsCard()}${nerds()}`;
    } else if (st === 'protected') {
      head = `${statusRow('Protected', 's-protected', ['on', 'Shield is on'])}<h1>Shield is on.</h1><p class="say">ETH can fall <b>${pct1(drop)}</b> before Aave liquidates you. Shield steps in first, at <b>${pct1(dropAt(p.h))}</b> down.</p>`;
      level = levelHTML({ ...base, lineMode: 'on', mood: 'guard' });
      body = `${factsCard()}
        <div class="actions"><button class="btn" type="button" data-goto="protected">Add fuel</button><button class="btn btn-white" type="button" data-goto="setup">Change when</button><button class="btn btn-white" type="button" data-goto="outoffuel">Turn off</button></div>
        <p class="hint">Shield checks your loan every block. Best effort: if ETH jumps past your line in one move, Aave can still liquidate you.</p>
        ${nerds()}`;
    } else if (st === 'lowfuel') {
      head = `${statusRow('Low fuel', 's-lowfuel', ['on', 'Shield is on'])}<h1>Shield is on, but fuel is low.</h1><p class="say">About <b>5 days</b> left. When it runs out, Shield switches off.</p>`;
      level = levelHTML({ ...base, lineMode: 'on', mood: 'tired' });
      body = `<div class="alert yellow"><div class="ai">${ICON.battery}</div><div><h3>Add fuel to keep Shield on</h3><p style="margin-bottom:14px">${usd(fo.amt)} keeps it on for about ${dur(fo.lasts)} more at today's rate.</p><button class="btn" type="button" data-goto="protected">Add ${usd(fo.amt)} of fuel</button></div></div>
        ${factsCard({ fuelSegs: 1, fuelCls: 'low blink', fuelText: 'About 5 days left' })}
        <div class="actions"><button class="btn btn-white" type="button" data-goto="setup">Change when</button><button class="btn btn-white" type="button" data-goto="outoffuel">Turn off</button></div>
        ${nerds()}`;
    } else if (st === 'outoffuel') {
      head = `${statusRow('Out of fuel', 's-out', ['off', 'Shield is off'])}<h1>Out of fuel. Shield is off.</h1><p class="say">ETH can fall <b>${pct1(drop)}</b> before Aave liquidates you, and nothing steps in before that now.</p>`;
      level = levelHTML({ ...base, lineMode: 'off', mood: 'sleepy' });
      body = `<div class="alert red shake-once"><div class="ai">${ICON.fuel}</div><div><h3>Add fuel to switch Shield back on</h3><p style="margin-bottom:14px">It re-arms 15 minutes after you add fuel. Your line stays at ETH ${usd0(price)}.</p><button class="btn" type="button" data-goto="arming">Add ${usd(fo.amt)} of fuel</button></div></div>
        ${factsCard({ fuelSegs: 0, fuelCls: 'out', fuelText: 'Empty since yesterday' })}
        ${nerds()}`;
    } else if (st === 'blocked') {
      const r = REASONS[state.reason];
      head = `${statusRow('Blocked', 's-blocked')}<h1>Shield can't step in right now.</h1><p class="say">${r.say}</p>`;
      level = levelHTML({ ...base, lineMode: 'blocked', mood: 'confused' });
      body = `<div class="alert yellow"><div class="ai">${ICON.warn}</div><div><h3>${r.title}</h3><p style="margin-bottom:14px">${r.text}</p><button class="btn ${r.white ? 'btn-white' : ''}" type="button" data-goto="protected">${r.btn}</button></div></div>
        <p class="hint">Until this is fixed, Aave can liquidate you as if Shield were off.</p>
        ${factsCard()}${nerds()}`;
    } else if (st === 'steppedin') {
      const after = price / (p.h + 0.06);
      const afterDrop = (1 - after / price) * 100;
      head = `${statusRow('Saved', 's-saved')}<h1>Shield stepped in.</h1><p class="say">ETH hit your line at <b class="tnum">${usd0(price)}</b>. Shield paid back part of your loan before Aave could liquidate you.</p>`;
      level = levelHTML({ now: price, aave: after, ghost: AAVE, line: null, lineMode: 'hidden', mood: 'saved', scale: { top: price, bottom: after - (price - after) * 0.3 }, ribbon: '<span class="pill">After the rescue</span>' });
      body = `<div class="card saved-hero" id="savedcard"><div class="burst" aria-hidden="true"><svg viewBox="0 0 100 100"><path d="${burstPath()}" fill="${C.heads}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/></svg><span>Nice<br>save</span></div>
          <p style="font-weight:700;margin:0">You kept</p><div class="kept"><span class="num" data-count="${EXIT.kept}" data-dec="2" data-prefix="$">${usd(EXIT.kept)}</span></div><p style="margin:0;max-width:24em">that Aave's liquidators would have taken for the same repayment.</p></div>
        <div class="receipt"><ol>
          <li>ETH fell to <b class="tnum">${usd0(price)}</b> in block ${fmt(EXIT.block, 0)}.</li>
          <li>Shield paid back <b class="tnum">${usd(EXIT.repaid)}</b> of your USDC loan.</li>
          <li>It took ETH worth <b class="tnum">${usd(EXIT.taken)}</b> (0.00995 ETH) into Shield's vault: the repaid amount plus 1%.</li>
          <li>Aave's liquidators would have taken ETH worth <b class="tnum">${usd(EXIT.aave)}</b> for the same repayment.</li>
        </ol><div class="tx"><span class="small"><b>Transaction</b> <span class="mono">${EXIT.tx}</span></span><span class="sample">Sample</span><a href="https://monadvision.com" target="_blank" rel="noopener">View on MonadVision</a></div></div>
        <div class="card"><h3 style="font-size:22px;margin-bottom:6px">Your loan now</h3><p style="margin:0">ETH can fall <b>${pct1(afterDrop)}</b> before Aave liquidates you, at <b class="tnum">${usd0(after)}</b>. Shield is off until you set a new line.</p></div>
        <div class="btn-row"><button class="btn" type="button" data-goto="setup">Protect again</button><button class="btn btn-white" type="button" data-act="share">Share this save</button></div>
        ${nerds()}`;
    }
    const order = st === 'turning' || st === 'steppedin' ? ' level-last' : '';
    return `<div class="protect${order}"><div class="p-head">${head}</div><div class="p-level">${level}</div><div class="p-body">${body}</div></div>`;
  }

  function burstPath() {
    let d = '';
    const n = 14;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? 38 : 48;
      const a = (i * Math.PI) / n;
      d += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(1) + ' ' + (50 + r * Math.sin(a)).toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  /* Turning on: the level map */
  function turnSteps() {
    const p = preset(), fo = fuel();
    const line = usd0(priceAt(p.h));
    const amt = usd(fo.amt);
    const allowEth = { short: 'Allow ETH', title: 'Let Shield take its slice, only in a rescue', what: 'An approval for your ETH on Aave. Shield can use it only when ETH hits your line, and only for what it is owed.', btn: 'Approve in wallet' };
    const on = { short: 'Switch on', title: `Switch Shield on at ${line}`, what: 'Saves your line on chain. Shield arms 15 minutes later.', btn: 'Confirm in wallet' };
    if (state.source === 'other') {
      return [allowEth, { short: 'Send fuel', title: `Send ${amt} from another chain`, what: 'Pay with USDC or USDT on Base, Arbitrum or Ethereum. It lands as fuel on Monad, usually within a minute.', btn: 'Open cross-chain payment' }, on];
    }
    return [allowEth,
      { short: 'Allow USDC', title: 'Let Shield collect your fuel', what: `An approval for ${amt} of USDC, the fuel you picked. Nothing moves yet.`, btn: 'Approve in wallet' },
      { short: 'Add fuel', title: `Add ${amt} of fuel`, what: 'Moves the USDC into Shield. Take back what you don\'t use any time.', btn: 'Confirm in wallet' },
      on];
  }
  function turnInner() {
    const steps = turnSteps();
    const n = steps.length;
    const i = clamp(state.turnStep, 0, n - 1);
    const s = steps[i];
    const nodes = steps.map((st, k) => `<li class="tnode ${k < state.turnStep ? 'done' : k === i ? 'now' : ''}"><span class="dot">${k < state.turnStep ? ICON.check : k + 1}</span><span class="tl">${st.short}</span></li>`).join('');
    const fillPct = (i / (n - 1)) * 100;
    const playerLeft = ((i + 0.5) / n) * 100;
    return `<div class="track" style="--n:${n}"><div class="track-line" aria-hidden="true"><div class="track-fill" style="width:${fillPct}%"></div></div>
        <div class="player" id="player" style="left:${playerLeft}%">${mascot('arming')}</div>
        <ol style="display:contents;list-style:none">${nodes}</ol></div>
      <div class="stepcard" aria-live="polite"><p class="kicker">Step ${i + 1} of ${n}</p><h3>${s.title}</h3><p style="margin:0">${s.what}</p>
        <button class="btn btn-big ${state.busy ? 'is-pressed' : ''}" type="button" data-act="step" ${state.busy ? 'aria-busy="true"' : ''}>${state.busy ? '<span class="waiting">Waiting for your wallet<i></i><i></i><i></i></span>' : s.btn}</button>
        <button class="linkbtn" type="button" data-goto="setup" style="margin-top:12px">Stop and go back</button></div>`;
  }
  async function doStep() {
    if (state.busy) return;
    const n = turnSteps().length;
    state.busy = true;
    $('#turn').innerHTML = turnInner();
    const run = sceneRun;
    await sleep(reduce ? 300 : 1300);
    if (run !== sceneRun) return;
    state.busy = false;
    state.turnStep++;
    if (state.turnStep >= n) { state.turnStep = 0; go('arming'); return; }
    $('#turn').innerHTML = turnInner();
    const pl = $('#player');
    if (pl && !reduce) { pl.classList.remove('hop'); void pl.offsetWidth; pl.classList.add('hop'); }
  }

  /* Re-render the setup view; the Shield line glides to its new height instead of jumping. */
  function rerenderSetup(focusSel, moved) {
    const oldNet = $('#pcontent [data-lv=net]');
    const oldF = oldNet ? oldNet.style.getPropertyValue('--f') : null;
    $('#pcontent').innerHTML = protectView('setup');
    const net = $('#pcontent [data-lv=net]');
    if (net && oldF && !reduce) {
      const newF = net.style.getPropertyValue('--f');
      net.style.setProperty('--f', oldF);
      void net.offsetWidth;
      net.style.setProperty('--f', newF);
    }
    if (moved && !reduce) {
      const pm = $('#pcontent .p-level .mascot');
      if (pm) pm.classList.add('squash');
    }
    $$('#pcontent .sticker.pop').forEach((el) => el.classList.remove('pop'));
    const f = $(focusSel);
    if (f) f.focus({ preventScroll: true });
  }

  let protectState = 'setup';
  function renderProtect(st, reason) {
    if (!STATES.find(([id]) => id === st)) st = 'setup';
    if (reason && REASONS[reason]) state.reason = reason;
    protectState = st;
    if (st !== 'turning') { state.turnStep = 0; state.busy = false; }
    const main = $('#main');
    const ae = document.activeElement;
    const fromChip = ae && ae.dataset && (ae.dataset.state || ae.dataset.reason) ? (ae.dataset.state ? `[data-state="${ae.dataset.state}"]` : `[data-reason="${ae.dataset.reason}"]`) : null;
    const fromContent = ae && ae.closest && ae.closest('#pcontent');
    const strip = $('#protostrip');
    if (!strip) {
      main.innerHTML = `<div class="wrap"><div id="protostrip"></div><div id="loanline"></div><div id="pcontent"></div></div>`;
    }
    $('#protostrip').innerHTML = protoStrip(st);
    $('#loanline').innerHTML = st === 'disconnected' ? '<div style="height:20px"></div>' : loanLine(st);
    $('#pcontent').innerHTML = protectView(st);
    $('#wallet').innerHTML = st === 'disconnected' ? 'Not connected' : '<i aria-hidden="true"></i>0x3C4a...93BC';
    afterProtect(st);
    if (fromChip) { const c = $(fromChip); if (c) c.focus({ preventScroll: true }); }
    else if (fromContent) {
      const h = $('#pcontent h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      const top = $('#pcontent').getBoundingClientRect().top;
      if (top < 0) window.scrollBy({ top: top - 90, behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  function afterProtect(st) {
    const root = $('#pcontent');
    countUps(root);
    if (st === 'arming') {
      let left = 15 * 60;
      const prog = $('#ringprog'), time = $('#ringtime');
      const draw = () => {
        const m = Math.floor(left / 60), s = left % 60;
        time.textContent = `${m}:${String(s).padStart(2, '0')}`;
        prog.style.strokeDashoffset = (402.1 * (1 - left / 900)).toFixed(1);
      };
      draw();
      every(() => { if (left > 0) { left--; draw(); } }, 1000);
    }
    if (st === 'steppedin') {
      later(() => confetti($('#savedcard .kept') || root), 250);
      const pm = $('.p-level .mascot');
      if (pm && !reduce) { pm.classList.add('jump'); }
    }
    if (st === 'outoffuel') {
      const pm = $('.p-level .mascot');
      if (pm && !reduce) pm.classList.add('shake');
    }
  }
  function go(st) {
    const hash = '#/protect/' + st + (st === 'blocked' ? '/' + state.reason : '');
    if (location.hash === hash) route(); else location.hash = hash;
  }

  /* ---------------- Vault ---------------- */
  function vaultArt() {
    return `<svg viewBox="0 0 260 230" aria-hidden="true">
      <ellipse cx="130" cy="214" rx="104" ry="10" fill="${C.skyDeep}" opacity=".6"/>
      ${coinStack(70, 58, 4)}${coinStack(186, 48, 5)}
      <path d="M128 4 L144 30 L128 40 L112 30 Z" fill="#B9A8FF" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/><path d="M112 30 L128 22 L144 30 M128 4 V22" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="28" y="70" width="204" height="138" rx="22" fill="${C.grape}" stroke="${C.ink}" stroke-width="4"/>
      <rect x="40" y="82" width="180" height="114" rx="14" fill="#8F79FF" stroke="${C.ink}" stroke-width="3"/>
      <circle cx="130" cy="139" r="40" fill="${C.plate}" stroke="${C.ink}" stroke-width="4"/>
      <circle cx="130" cy="139" r="10" fill="${C.heads}" stroke="${C.ink}" stroke-width="3"/>
      <path d="M130 103 V117 M130 161 V175 M94 139 H108 M152 139 H166 M105 114 L114 123 M146 155 L155 164 M155 114 L146 123 M114 155 L105 164" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>
      <rect x="196" y="122" width="12" height="34" rx="5" fill="${C.heads}" stroke="${C.ink}" stroke-width="3"/>
    </svg>`;
  }
  function renderVault(role) {
    const amts = [1000, 5000, 10000];
    const treasury = role === 'treasury';
    const tab = state.vaultTab;
    const amt = amts[state.vaultAmt];
    const panel = treasury
      ? `<div class="card"><h3 style="margin-bottom:6px">Treasury controls</h3><p class="hint" style="margin-bottom:14px">Connected as the treasury wallet, 0x9F1d...22A0.</p>
          <div class="seg" role="radiogroup" aria-label="Action"><button type="button" role="radio" aria-checked="${tab === 'add'}" data-vtab="add"><span class="ring"></span>Add</button><button type="button" role="radio" aria-checked="${tab === 'take'}" data-vtab="take"><span class="ring"></span>Take out</button></div>
          <div class="amounts" role="radiogroup" aria-label="Amount">${amts.map((a, i) => `<button class="btn btn-small ${i === state.vaultAmt ? '' : 'btn-white'}" type="button" role="radio" aria-checked="${i === state.vaultAmt}" data-vamt="${i}">${usd0(a)}</button>`).join('')}</div>
          <button class="btn btn-big" type="button">${tab === 'add' ? `Add ${usd0(amt)} to the vault` : `Take ${usd0(amt)} out of the vault`}</button>
          <p class="hint" style="margin-top:12px">${tab === 'add' ? 'Two wallet prompts: allow USDC, then deposit.' : 'One wallet prompt. Gains from a recent rescue reach the vault over six hours.'}</p></div>`
      : `<div class="card closed"><div class="lock">${ICON.lock}</div><div><h3 style="margin-bottom:6px">Deposits are closed</h3><p>Only Shield's treasury can add or take out money for now. That way the protocol, not the public, carries the risk while Shield is new.</p><p class="hint" style="margin:0">Outside deposits are planned for later.</p></div></div>`;
    $('#main').innerHTML = `<div class="wrap" style="padding-bottom:72px">
      <div class="proto" role="group" aria-label="Prototype controls"><span class="proto-label">Prototype: view as</span><button class="chip" type="button" data-vrole="visitor" aria-pressed="${!treasury}">Anyone</button><button class="chip" type="button" data-vrole="treasury" aria-pressed="${treasury}">Treasury wallet</button><label class="proto-select">Prototype: view as<select data-proto="vrole"><option value="visitor" ${treasury ? '' : 'selected'}>Anyone</option><option value="treasury" ${treasury ? 'selected' : ''}>Treasury wallet</option></select></label></div>
      <section class="vault-hero" style="margin-top:20px">
        <div><h1>Shield's vault.</h1><p class="say" style="margin-top:14px">The protocol's own pot. It pays for every rescue and earns from them. The protocol filled it at launch.</p><span class="sample">Sample numbers</span></div>
        <div class="vault-art">${vaultArt()}</div>
      </section>
      <div class="score">
        <div class="card"><p class="lbl">In the vault</p><div class="val" data-count="5011.87" data-dec="2" data-prefix="$">$5,011.87</div><p class="when muted">USDC, plus the ETH it holds from rescues</p></div>
        <div class="card"><p class="lbl">Rescues paid for</p><div class="val" data-count="1">1</div><p class="when muted">The last one 2 hours ago</p></div>
        <div class="card"><p class="lbl">Earned so far</p><div class="val" data-count="11.87" data-dec="2" data-prefix="$">$11.87</div><p class="when muted">Since launch, 6 days ago</p></div>
      </div>
      <div class="two-col">
        <div class="card"><h3 style="margin-bottom:8px">Where its money comes from</h3><p>Most of every fuel payment (the treasury keeps a tenth), plus the 1% slice from every rescue.</p>
          <h3 style="margin:22px 0 12px">The two risks</h3>
          <ul class="risk-list"><li><span class="rn">${ICON.warn}</span><span>After a rescue the vault holds ETH until it swaps it back to USDC, so for a while it rides ETH's price, down as well as up.</span></li><li><span class="rn">${ICON.warn}</span><span>The contracts are not audited yet. A bug could lose what's in the vault.</span></li></ul></div>
        ${panel}
      </div>
    </div>`;
    countUps($('#main'));
  }

  /* ---------------- Stats ---------------- */
  function renderStats() {
    const lenders = [
      ['Aave V3', 'live', 'Working now'], ['Euler V2', 'locked', 'Coming soon'], ['Morpho Blue', 'locked', 'Coming soon'],
      ['Curvance', 'locked', 'Coming soon'], ['Neverland', 'locked', 'Coming soon'],
    ];
    $('#main').innerHTML = `<div class="wrap" style="padding-bottom:24px">
      <div class="page-head"><h1>Stats.</h1><span class="sample">Sample numbers</span></div>
      <div class="score four">
        <div class="card"><p class="lbl">Rescues</p><div class="val" data-count="1">1</div><p class="when muted">The last one 2 hours ago</p></div>
        <div class="card"><p class="lbl">Saved for borrowers</p><div class="val" data-count="${EXIT.kept}" data-dec="2" data-prefix="$">${usd(EXIT.kept)}</div><p class="when muted">Compared with Aave's liquidators</p></div>
        <div class="card"><p class="lbl">Loans protected now</p><div class="val" data-count="${LOANS_WATCHED}">${LOANS_WATCHED}</div><p class="when muted">The newest one 40 minutes ago</p></div>
        <div class="card"><p class="lbl">Protocol income</p><div class="val" data-count="13.16" data-dec="2" data-prefix="$">$13.16</div><p class="when muted">Since launch, 6 days ago</p></div>
      </div>
      <section class="section" style="padding-bottom:0">
        <div class="section-head"><h2>Monad, block by block.</h2><p>A new block every 0.3 seconds. Shield checks every protected loan in each one.</p></div>
        ${tickerHTML()}
        <div class="ticker-meta"><span class="sample">Sample stream</span><span><b>Checks today:</b> <span class="tnum digits-inline" data-checks>${fmt(checksToday, 0)}</span></span><span class="muted small">Each tile is a block. The purple stamp is Shield's check landing in it.</span></div>
      </section>
      <section class="section" style="padding-bottom:0">
        <div class="section-head"><h2>The one liquidation on Aave Monad so far.</h2><p>It cost the borrower ${usd(REAL.extra)} on top of what was repaid.</p></div>
        ${comicHTML()}
      </section>
      <section class="section">
        <div class="section-head"><h2>Next levels.</h2><p>Shield works with Aave V3 today. Other Monad lenders come next.</p></div>
        <div class="levels">${lenders.map(([n, k, t]) => `<div class="lvl ${k}"><div>${k === 'live' ? `<span style="display:inline-block;width:36px">${ICON.shieldMini}</span>` : `<span class="lk" style="display:inline-block;width:36px">${ICON.lock}</span>`}</div><div><h3>${n}</h3><p class="small" style="margin:4px 0 0">${t}</p></div></div>`).join('')}</div>
      </section>
    </div>`;
    countUps($('#main'));
  }

  /* Typographic apostrophes in rendered copy (Lilita One's straight quote is wide). */
  function typo(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('script, style, .mono, input, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach((n) => { if (n.nodeValue.includes("'")) n.nodeValue = n.nodeValue.replace(/'/g, '\u2019'); });
  }
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) typo(n); else if (n.nodeType === 3 && n.nodeValue.includes("'")) n.nodeValue = n.nodeValue.replace(/'/g, '\u2019'); }))).observe(document.getElementById('main'), { childList: true, subtree: true });

  /* ---------------- Router and events ---------------- */
  let lastPage = null;
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = ['protect', 'vault', 'stats'].includes(parts[0]) ? parts[0] : 'home';
    clearTimers();
    if (page !== 'protect' || lastPage !== 'protect') $('#main').innerHTML = '';
    if (page === 'protect') renderProtect(parts[1] || 'setup', parts[2]);
    else if (page === 'vault') renderVault(parts[1] === 'treasury' ? 'treasury' : 'visitor');
    else if (page === 'stats') renderStats();
    else renderLanding();
    if (page !== 'protect') $('#wallet').innerHTML = '<i aria-hidden="true"></i>0x3C4a...93BC';
    $$('[data-nav]').forEach((a) => { if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (page !== lastPage) {
      window.scrollTo(0, 0);
      if (lastPage !== null) $('#main').focus({ preventScroll: true });
    }
    lastPage = page;
    every(tick, 300);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.state) { go(d.state); return; }
    if (d.reason) { state.reason = d.reason; go('blocked'); return; }
    if (d.goto) { go(d.goto); return; }
    if (d.preset) { state.preset = d.preset; rerenderSetup(`[data-preset="${d.preset}"]`, true); return; }
    if (d.fuel) { state.fuel = +d.fuel; rerenderSetup(`[data-fuel="${d.fuel}"]`); return; }
    if (d.source) { state.source = d.source; rerenderSetup(`[data-source="${d.source}"]`); return; }
    if (d.act === 'step') { doStep(); return; }
    if (d.act === 'replay') { playScene(false); return; }
    if (d.act === 'addr') { state.showAddr = true; const f = $('[data-form=addr]'); f.hidden = false; $('#addr').focus(); return; }
    if (d.act === 'share') { t.textContent = 'Share card copied'; return; }
    if (d.scroll) { const el = document.getElementById(d.scroll); if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); return; }
    if (d.vrole) { location.hash = d.vrole === 'treasury' ? '#/vault/treasury' : '#/vault'; return; }
    if (d.vtab) { state.vaultTab = d.vtab; renderVault('treasury'); $(`[data-vtab="${d.vtab}"]`).focus(); return; }
    if (d.vamt) { state.vaultAmt = +d.vamt; renderVault('treasury'); $(`[data-vamt="${d.vamt}"]`).focus(); return; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.matches('select[data-proto]')) return;
    if (t.dataset.proto === 'state') go(t.value);
    else if (t.dataset.proto === 'reason') { state.reason = t.value; go('blocked'); }
    else if (t.dataset.proto === 'vrole') location.hash = t.value === 'treasury' ? '#/vault/treasury' : '#/vault';
  });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-form=addr]')) { e.preventDefault(); go('noloan'); }
  });
  // Arrow keys move through radio-style card groups.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('[role=radio]')) return;
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const group = $$('[role=radio]', t.closest('[role=radiogroup]'));
    const i = group.indexOf(t);
    const next = group[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : group.length - 1)) % group.length];
    e.preventDefault();
    next.click();
  });

  window.addEventListener('hashchange', route);
  renderDigits($('#blocknum'), fmt(block, 0));
  route();
})();
