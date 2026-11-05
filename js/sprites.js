// Procedural pixel-art sprites. Everything is drawn into tiny offscreen canvases once,
// then cached and blitted with image smoothing off, which gives the crisp pixel look.
import { CREATURES, PLANTS, TREASURES } from './data.js';
import { shade, hash2 } from './util.js';

const OUTLINE = '#0a1424';
const cache = new Map();

function grid(w, h) { return { w, h, p: new Array(w * h).fill(null) }; }
function set(g, x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.p[y * g.w + x] = c; }
function get(g, x, y) { return x >= 0 && y >= 0 && x < g.w && y < g.h ? g.p[y * g.w + x] : null; }
function disc(g, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(g, x, y, c);
}
function line(g, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) set(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
}

function toCanvas(g, { outline = OUTLINE, alpha = 1 } = {}) {
  if (outline) {
    const add = [];
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        if (get(g, x, y)) continue;
        if (get(g, x + 1, y) || get(g, x - 1, y) || get(g, x, y + 1) || get(g, x, y - 1)) add.push([x, y]);
      }
    for (const [x, y] of add) set(g, x, y, outline);
  }
  const c = document.createElement('canvas');
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext('2d');
  ctx.globalAlpha = alpha;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const col = g.p[y * g.w + x];
      if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
    }
  return c;
}

// String art: each char maps to a palette colour, '.' is transparent.
function art(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const g = grid(w, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.' && pal[ch]) set(g, x, y, pal[ch]); }));
  return toCanvas(g, { outline: null });
}

// ---------------- Diver ----------------
const DIVER = [
  [
    '............KKKKKKKK........',
    '...........KYYYYYYYyK.......',
    '..........KYyyyyyyyTK.......',
    'KK.....KKKKKTTTTTTTKKKKK....',
    'FfK..KKLLLLLLLLLLLLLLKhhKK..',
    'FFfKKsLLLSSSSSSSSSSSLKhhhGgK',
    'FFFssSSSSSBBSSSSSSSSSKhhhGGK',
    'FFfKKsssSSBBSSSSSSSSsKhhhGGK',
    'FfK..KKssssssssssssKKKhhKK..',
    'KK.....KKKKKKKsSSKKKKKKK....',
    '.............KsSSK..........',
    '..............KsSK..........',
    '...............KK...........',
  ],
  [
    '............KKKKKKKK........',
    'KK.........KYYYYYYYyK.......',
    'FfK.......KYyyyyyyyTK.......',
    'FFfK...KKKKKTTTTTTTKKKKK....',
    'FFFKKKKLLLLLLLLLLLLLLKhhKK..',
    '.KKKKsLLLSSSSSSSSSSSLKhhhGgK',
    '...ssSSSSSBBSSSSSSSSSKhhhGGK',
    '...KKsssSSBBSSSSSSSSsKhhhGGK',
    '.....KKssssssssssssKKKhhKK..',
    '.......KKKKKKKsSSKKKKKKK....',
    '............KsSSK...........',
    '............KsSK............',
    '.............KK.............',
  ],
];
export function diverSprite(color, frame) {
  const key = `diver:${color}:${frame}`;
  if (!cache.has(key)) {
    cache.set(key, art(DIVER[frame & 1], {
      K: OUTLINE, S: color, s: shade(color, -0.35), L: shade(color, 0.3), B: '#2b2f3a', h: '#2b2f3a',
      Y: '#e3e9ef', y: '#a9b5c2', T: '#6d7a88', G: '#8ff3ff', g: '#e8ffff', F: '#1d2633', f: '#3a4a60',
    }));
  }
  return cache.get(key);
}

// ---------------- Creatures ----------------
function drawFish(def, frame) {
  const L = def.size;
  const H = Math.max(5, Math.round(L * (def.long ? 0.32 : def.kind === 'shark' ? 0.36 : 0.58)));
  const pad = def.kind === 'shark' ? 6 : def.kind === 'angler' ? 8 : 2;
  const g = grid(L + 4, H + pad + 2);
  const [c0, c1] = def.colors;
  const top = pad, cy = top + H / 2 - 0.5;
  const tl = Math.max(3, Math.round(L * 0.24));
  const cx = 2 + tl + (L - tl) * 0.48, rx = (L - tl) * 0.5, ry = H / 2;
  // tail
  const wag = frame ? 1 : -1;
  for (let x = 0; x < tl; x++) {
    const hh = (1 - x / tl) * ry * 0.95 + 0.5;
    const off = (1 - x / tl) * wag;
    for (let y = -hh; y <= hh; y++) set(g, 2 + x, cy + y + off, def.pattern === 'tail' ? c1 : shade(c0, -0.1));
  }
  // body
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      let col = c0;
      if (def.pattern === 'stripes' && (Math.abs(x - (cx + rx * 0.45)) < 1 || Math.abs(x - (cx - rx * 0.15)) < 1 || Math.abs(x - (cx - rx * 0.75)) < 0.8)) col = c1;
      if (def.pattern === 'belly' && dy > 0.15) col = c1;
      if (def.pattern === 'dots' && hash2(x, y) > 0.82) col = c1;
      if (def.pattern === 'eye' && Math.abs(x - (cx - rx * 0.45)) < 1.2 && Math.abs(y - cy) < 1.2) col = c1;
      if (dy < -0.55 && col === c0) col = shade(c0, 0.18);
      if (dy > 0.6 && col === c0) col = shade(c0, -0.2);
      set(g, x, y, col);
    }
  if (def.kind === 'shark') {
    for (let i = 0; i < pad; i++) line(g, cx - 2 + i * 0.6, top - i, cx + 3, top, shade(c0, -0.15)); // dorsal
    line(g, cx + 1, cy + ry, cx - 2, cy + ry + 2, shade(c0, -0.2)); // pectoral
    set(g, cx + rx * 0.55, cy + 1, '#222'); set(g, cx + rx * 0.62, cy + 1, '#222');
  }
  if (def.kind === 'angler') {
    // big jaw + teeth + lure
    for (let x = cx + rx * 0.2; x < cx + rx; x++) set(g, x, cy + 1, '#120a10');
    for (let x = cx + rx * 0.3; x < cx + rx; x += 2) set(g, x, cy, '#ffffff');
    line(g, cx + rx * 0.2, top - 1, cx + rx * 0.7, top - 6, '#6a4a5a');
    disc(g, cx + rx * 0.9, top - 6, 1.2, def.glow);
  }
  // eye
  const ex = cx + rx * 0.6, ey = cy - ry * 0.25;
  set(g, ex, ey, def.kind === 'angler' ? '#fffbe0' : '#ffffff');
  set(g, ex + 1, ey, '#101010');
  return g;
}

function drawJelly(def, frame) {
  const s = def.size, g = grid(s + 4, s + 8);
  const [c0, c1] = def.colors, cx = (s + 4) / 2 - 0.5;
  for (let y = 0; y < s * 0.55; y++)
    for (let x = 0; x < s + 4; x++) {
      const dx = (x - cx) / (s / 2), dy = (y - s * 0.55) / (s * 0.55);
      if (dx * dx + dy * dy <= 1) set(g, x, y + 1, dy < -0.5 ? c1 : c0);
    }
  for (let i = 0; i < 4; i++) {
    const tx = cx - s / 2 + 2 + i * ((s - 3) / 3);
    for (let y = 0; y < s * 0.6; y++) set(g, tx + Math.round(Math.sin(y * 0.6 + i + frame * 2) * 0.8), s * 0.55 + 1 + y, c1);
  }
  return g;
}

function drawOcto(def, frame) {
  const s = def.size, g = grid(s + 6, s + 6);
  const [c0, c1] = def.colors, cx = (s + 6) / 2 - 0.5;
  disc(g, cx, s * 0.35 + 1, s * 0.33, c0);
  if (def.name.startsWith('Dumbo')) { disc(g, cx - s * 0.38, s * 0.25, 1.8 + frame * 0.5, c1); disc(g, cx + s * 0.38, s * 0.25, 1.8 + frame * 0.5, c1); }
  for (let i = 0; i < 4; i++) {
    const bx = cx - s * 0.25 + i * (s * 0.5 / 3);
    for (let y = 0; y < s * 0.5; y++) {
      const curl = Math.sin(y * 0.5 + i * 1.3 + frame * 1.6) * 1.1 + (i - 1.5) * y * 0.12;
      set(g, bx + curl, s * 0.55 + 1 + y, y > s * 0.35 ? c1 : c0);
    }
  }
  set(g, cx - 2, s * 0.38, '#101010'); set(g, cx + 2, s * 0.38, '#101010');
  return g;
}

function drawSquid(def, frame) {
  const L = def.size, H = Math.max(6, Math.round(L * 0.3));
  const g = grid(L + 4, H + 6);
  const [c0, c1] = def.colors, cy = (H + 6) / 2;
  // mantle on the right (squids swim mantle-first), tentacles trail left
  const mx0 = L * 0.45, mx1 = L + 1;
  for (let x = mx0; x < mx1; x++) {
    const t = (x - mx0) / (mx1 - mx0);
    const hh = (H / 2) * Math.sin(Math.min(1, (1 - t) * 1.6 + 0.2) * Math.PI * 0.5) * (t > 0.85 ? 1.4 : 1);
    for (let y = -hh; y <= hh; y++) set(g, x, cy + y, y < -hh * 0.4 ? shade(c0, 0.15) : c0);
  }
  for (let i = 0; i < 5; i++) {
    const oy = (i - 2) * (H / 5);
    for (let x = 1; x < mx0; x++) set(g, x, cy + oy * (x / mx0) + Math.sin(x * 0.45 + i + frame * 2) * 0.9, c1);
  }
  set(g, mx0 + 2, cy - 1, '#ffffff'); set(g, mx0 + 3, cy - 1, '#101010');
  return g;
}

function drawHorse(def, frame) {
  const s = def.size, g = grid(s, s + 4);
  const c0 = def.colors[0];
  const pts = [];
  for (let t = 0; t <= 1; t += 0.04) {
    const y = 2 + t * s;
    const x = s / 2 + Math.sin(t * 5.2 + 0.4) * s * 0.18 - t * 1.5;
    pts.push([x, y, (1 - t) * s * 0.17 + 1]);
  }
  pts.forEach(([x, y, r], i) => disc(g, x, y, r * (i < 6 ? 1.2 : 1), i % 5 === 0 ? shade(c0, -0.2) : c0));
  line(g, pts[2][0] + 2, pts[2][1], pts[2][0] + s * 0.32, pts[2][1] + 1, c0); // snout
  set(g, pts[2][0] + 1, pts[2][1] - 1, '#101010');
  disc(g, pts[pts.length - 1][0] + 1.5, pts[pts.length - 1][1] - 1, 1.2, shade(c0, -0.25)); // curl
  set(g, pts[8][0] - 3 - frame, pts[8][1], shade(c0, 0.3)); // fin flutter
  return g;
}

function drawNaut(def, frame) {
  const s = def.size, g = grid(s + 6, s + 2);
  const [c0, c1] = def.colors, cx = s / 2 + 4, cy = s / 2 + 1;
  disc(g, cx, cy, s / 2, c0);
  for (let a = 0; a < Math.PI * 2; a += 0.6) line(g, cx, cy, cx + Math.cos(a) * s / 2, cy + Math.sin(a) * s / 2 * (a > Math.PI ? 1 : 0.2), c1);
  disc(g, cx - s * 0.1, cy, s * 0.15, shade(c0, -0.3));
  for (let i = 0; i < 3; i++) line(g, cx - s / 2, cy + i - 1, 1, cy + i * 2 - 2 + frame, '#e8b38a');
  return g;
}

function drawTurtle(def, frame) {
  const s = def.size, g = grid(s + 6, Math.round(s * 0.6) + 6);
  const [c0, c1] = def.colors, cx = s / 2 + 2, cy = g.h / 2;
  const f = frame ? 2 : -1;
  line(g, cx + 3, cy + 1, cx + 6, cy + 5 + f, c1); line(g, cx - 4, cy + 1, cx - 8, cy + 4 - f, c1);
  line(g, cx + 3, cy - 1, cx + 7, cy - 4 - f, c1);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const dx = (x - cx) / (s * 0.42), dy = (y - cy) / (s * 0.26);
      if (dx * dx + dy * dy <= 1) set(g, x, y, (x + y) % 4 === 0 ? shade(c0, -0.3) : dy < -0.4 ? shade(c0, 0.15) : c0);
    }
  disc(g, cx + s * 0.5, cy, 2.2, c1); set(g, cx + s * 0.5 + 1, cy - 1, '#101010');
  return g;
}

export function creatureSprite(key, frame) {
  const k = `cre:${key}:${frame}`;
  if (!cache.has(k)) {
    const def = CREATURES[key];
    let g;
    switch (def.kind) {
      case 'jelly': g = drawJelly(def, frame); break;
      case 'octo': g = drawOcto(def, frame); break;
      case 'squid': g = drawSquid(def, frame); break;
      case 'horse': g = drawHorse(def, frame); break;
      case 'naut': g = drawNaut(def, frame); break;
      case 'turtle': g = drawTurtle(def, frame); break;
      default: g = drawFish(def, frame);
    }
    cache.set(k, toCanvas(g, { alpha: def.alpha || 1 }));
  }
  return cache.get(k);
}

// ---------------- Plants ----------------
function drawPlant(def, frame) {
  const [c0, c1] = def.colors;
  let g;
  const sway = frame ? 1 : 0;
  switch (def.art) {
    case 'grass': {
      g = grid(12, 12);
      for (let i = 0; i < 5; i++) { const bx = 2 + i * 2; const h = 6 + ((i * 7) % 5); for (let y = 0; y < h; y++) set(g, bx + (y > h / 2 ? sway * (i % 2 ? 1 : -1) : 0), 11 - y, y > h - 2 ? c1 : c0); }
      break;
    }
    case 'kelp': {
      g = grid(12, 38);
      for (let y = 0; y < 36; y++) {
        const x = 5 + Math.round(Math.sin(y * 0.18 + frame * 1.2) * 1.6 * (y / 36));
        set(g, x, 37 - y, c0);
        if (y % 5 === 2) { set(g, x + 1, 37 - y, c1); set(g, x + 2, 36 - y, c1); }
        if (y % 5 === 4) { set(g, x - 1, 37 - y, c1); set(g, x - 2, 36 - y, c1); }
      }
      break;
    }
    case 'coral': {
      g = grid(14, 14);
      const br = (x, y, a, len, d) => { if (d > 3 || len < 1) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; line(g, x, y, x2, y2, d > 1 ? c1 : c0); br(x2, y2, a - 0.5, len * 0.7, d + 1); br(x2, y2, a + 0.45, len * 0.65, d + 1); };
      br(7, 13, -Math.PI / 2, 5, 0); set(g, 6, 13, c0); set(g, 8, 13, c0);
      break;
    }
    case 'fan': {
      g = grid(14, 14);
      for (let a = -2.6; a <= -0.5; a += 0.25) line(g, 7, 13, 7 + Math.cos(a) * 6.5, 13 + Math.sin(a) * 9, c0);
      for (let a = -2.4; a <= -0.6; a += 0.5) set(g, 7 + Math.cos(a) * 5 + sway * 0.3, 13 + Math.sin(a) * 7, c1);
      break;
    }
    case 'star': {
      g = grid(11, 9);
      disc(g, 5, 5, 1.6, c0);
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / 5; line(g, 5, 5, 5 + Math.cos(a) * 4.4, 5 + Math.sin(a) * 3.6, c0); }
      set(g, 5, 4, c1); set(g, 4, 5, c1);
      break;
    }
    case 'lily': {
      g = grid(12, 16);
      for (let y = 0; y < 9; y++) set(g, 6 + (y > 5 ? sway : 0), 15 - y, '#9a8a5a');
      for (let i = 0; i < 7; i++) { const a = -Math.PI + (i * Math.PI) / 6; line(g, 6 + sway, 6, 6 + sway + Math.cos(a) * 5, 6 + Math.sin(a) * 5, i % 2 ? c1 : c0); }
      break;
    }
    case 'sponge': {
      g = grid(12, 14);
      for (let y = 2; y < 14; y++) for (let x = 2; x < 10; x++) set(g, x, y, (x === 5 || x === 6) && y < 9 ? shade(c0, -0.45) : (hash2(x, y) > 0.8 ? c1 : c0));
      break;
    }
    case 'anemone': {
      g = grid(14, 12);
      for (let x = 4; x < 10; x++) for (let y = 8; y < 12; y++) set(g, x, y, shade(c0, -0.2));
      for (let i = 0; i < 7; i++) { const bx = 3 + i * 1.3; for (let y = 0; y < 6; y++) set(g, bx + Math.sin(y * 0.8 + i + frame * 2) * 0.9, 8 - y, y > 3 ? c1 : c0); }
      break;
    }
    case 'tube': {
      g = grid(14, 16);
      for (let i = 0; i < 5; i++) { const bx = 2 + i * 2.4, h = 7 + ((i * 5) % 6); for (let y = 0; y < h; y++) set(g, bx, 15 - y, c0); disc(g, bx + (frame && i % 2 ? 0.5 : 0), 15 - h, 1.1, c1); }
      break;
    }
    case 'moss': {
      g = grid(14, 9);
      for (let y = 0; y < 9; y++) for (let x = 0; x < 14; x++) { const dx = (x - 7) / 6, dy = (y - 8) / 6; if (dx * dx + dy * dy <= 1) set(g, x, y, c0); }
      [[4, 5], [8, 4], [10, 6], [6, 7]].forEach(([x, y]) => set(g, x, y, c1));
      break;
    }
    default: g = grid(4, 4);
  }
  return g;
}

// ---------------- Treasure ----------------
const T_ART = {
  chest: ['..KKKKKKKKKK..', '.KbBBBBBBBBbK.', 'KbBBBBBBBBBBbK', 'KyyyyyyyyyyyyK', 'KbbbbbYYbbbbbK', 'KbBBBBYYBBBBbK', 'KbBBBBBBBBBBbK', 'KbbbbbbbbbbbbK', '.KKKKKKKKKKKK.'],
  coins: ['.....YY.....', '....YyyY....', '..YYyYYyYY..', '.YyyYyyYyyY.', 'YyYYyYYyYYyY', 'KKKKKKKKKKKK'],
  cup: ['KWWWWWWWK', 'KWwwwwwWK', '.KWwwwWK.', '..KWwWK..', '...KWK...', '...KWK...', '..KWWWK..', '.KWWWWWK.'],
  compass: ['..KKKKK..', '.KyyyyyK.', 'KywwrwwyK', 'KywwrwwyK', 'KywwkwwyK', 'KywwkwwyK', 'KywwwwwyK', '.KyyyyyK.', '..KKKKK..'],
  clam: ['.KKKKKKKKKK.', 'KppPPPPPPppK', 'KKKKKKKKKKKK', 'KppWWppppppK', 'KpWWwppppppK', '.KKKKKKKKKK.'],
  idol: ['..KKKK..', '.KgGGgK.', '.KkgGkK.', '.KgGGgK.', '..KggK..', '.KgGGgK.', 'KgKGGKgK', 'KgKGGKgK', '.KgGGgK.', '.KgKKgK.', 'KKK..KKK'],
  crown: ['Y....Y....Y', 'YK..YYY..KY', 'YYKYYgYYKYY', 'YYYYYYYYYYY', 'YgYYrYYrYgY', 'KKKKKKKKKKK'],
};
function treasureSprite(def) {
  const [c0, c1] = def.colors;
  return art(T_ART[def.art], {
    K: OUTLINE, b: shade(c0, -0.35), B: c0, y: c1, Y: def.art === 'chest' ? shade(c1, 0.3) : c0,
    W: c0, w: shade(c0, 0.4), r: '#e23a3a', k: '#202020', p: c0, P: shade(c0, 0.25), g: c0, G: c1,
    ...(def.art === 'crown' ? { y: c1, g: c1 } : {}),
    ...(def.art === 'coins' ? { y: c1 } : {}),
    ...(def.art === 'cup' ? { w: c1 } : {}),
    ...(def.art === 'compass' ? { y: c0, w: c1 } : {}),
    ...(def.art === 'clam' ? { W: c1, w: shade(c1, -0.2) } : {}),
  });
}

export function itemSprite(key, frame) {
  const k = `item:${key}:${frame}`;
  if (!cache.has(k)) {
    if (TREASURES[key]) cache.set(k, treasureSprite(TREASURES[key]));
    else cache.set(k, toCanvas(drawPlant(PLANTS[key], frame)));
  }
  return cache.get(k);
}

// ---------------- Rocks ----------------
export function rockSprite(r, tint) {
  const k = `rock:${r}:${tint}`;
  if (!cache.has(k)) {
    const s = r * 2 + 2, g = grid(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x - r, dy = y - r;
        const d = Math.sqrt(dx * dx + dy * dy) + hash2(x, y) * 1.5;
        if (d > r) continue;
        const light = (-dx - dy) / (r * 1.4);
        let col = shade(tint, light > 0.3 ? 0.15 : light < -0.3 ? -0.35 : 0);
        if (hash2(x + 7, y) > 0.9) col = shade(col, -0.2);
        set(g, x, y, col);
      }
    cache.set(k, toCanvas(g, { outline: shade(tint, -0.6) }));
  }
  return cache.get(k);
}
