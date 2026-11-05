// Small math / random helpers shared by every module.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

// Deterministic PRNG so every player in a co-op room generates the same ocean.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash -> [0,1). Used for texture dithering without storing anything.
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 1D value noise with smooth interpolation.
export function makeNoise1D(rng, size = 512) {
  const v = new Float32Array(size);
  for (let i = 0; i < size; i++) v[i] = rng() * 2 - 1;
  return (x) => {
    const i = Math.floor(x), f = x - i;
    const a = v[((i % size) + size) % size], b = v[(((i + 1) % size) + size) % size];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

export function pickWeighted(rng, list, weightOf) {
  let total = 0;
  for (const it of list) total += weightOf(it);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const it of list) { r -= weightOf(it); if (r <= 0) return it; }
  return list[list.length - 1];
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
}
export const shade = (hex, amt) => (amt < 0 ? mixHex(hex, '#000000', -amt) : mixHex(hex, '#ffffff', amt));
