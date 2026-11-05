// High-detail procedural pixel art.
// Every sprite is painted with smooth vector shapes, gradients and highlights at RES× the
// base resolution, then "pixelised": hard alpha edges plus a thin selective outline (a darker
// shade of the neighbouring colour instead of flat black). The result is fine, delicate pixel
// art with smooth shading. Sizes below are in base units; canvases are RES× larger.
import { CREATURES, PLANTS, TREASURES } from './data.js';
import { shade, hash2, mixHex } from './util.js';

export const RES = 3;
const cache = new Map();

function mk(w, h, draw, { outline = true, alpha = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
  const ctx = c.getContext('2d');
  ctx.scale(RES, RES);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  draw(ctx, w, h);
  pixelize(c, outline, alpha);
  return c;
}

function pixelize(c, outline, alpha) {
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (d[i * 4 + 3] >= 110) { solid[i] = 1; d[i * 4 + 3] = Math.round(255 * alpha); } else d[i * 4 + 3] = 0;
  }
  if (outline) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        let n = -1;
        if (x > 0 && solid[i - 1]) n = i - 1; else if (x < W - 1 && solid[i + 1]) n = i + 1;
        else if (y > 0 && solid[i - W]) n = i - W; else if (y < H - 1 && solid[i + W]) n = i + W;
        if (n < 0) continue;
        d[i * 4] = d[n * 4] * 0.3 + 4; d[i * 4 + 1] = d[n * 4 + 1] * 0.3 + 8; d[i * 4 + 2] = d[n * 4 + 2] * 0.35 + 18;
        d[i * 4 + 3] = Math.round(255 * alpha);
      }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- paint helpers
const rad = (ctx, cx, cy, r, base, hi = 0.4, lo = -0.5) => {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.05, cx, cy, r * 1.1);
  g.addColorStop(0, shade(base, hi)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, lo));
  return g;
};
const vlin = (ctx, y0, y1, a, b, c) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a); if (c) { g.addColorStop(0.5, b); g.addColorStop(1, c); } else g.addColorStop(1, b);
  return g;
};
const hlin = (ctx, x0, x1, stops) => {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
};
function ell(ctx, cx, cy, rx, ry, fill, rot = 0) { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
function eye(ctx, x, y, r, iris = '#101418') {
  ell(ctx, x, y, r, r, '#f4f8ff');
  ell(ctx, x + r * 0.2, y, r * 0.62, r * 0.62, iris);
  ell(ctx, x - r * 0.1, y - r * 0.35, r * 0.28, r * 0.28, '#ffffff');
}
// Tapered limb / tentacle along a list of points.
function taper(ctx, pts, w0, w1, color) {
  ctx.strokeStyle = color;
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
}
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

// ---------------------------------------------------------------- diver
export function diverSprite(color, frame) {
  const key = `diver:${color}:${frame}`;
  if (cache.has(key)) return cache.get(key);
  const c = mk(30, 15, (ctx) => {
    const k = frame ? 1 : -1;
    const dark = shade(color, -0.45);
    // legs + fins (behind body)
    for (const [leg, ph] of [[0, k], [1, -k]]) {
      const y0 = 8.2 + leg * 1.4;
      const fy = y0 + ph * 1.6;
      taper(ctx, [[11, y0], [7.5, y0 + ph * 0.5], [4.2, fy]], 2.6, 2, leg ? shade(color, -0.3) : color);
      ctx.beginPath(); ctx.moveTo(4.6, fy - 1.2); ctx.quadraticCurveTo(0.6, fy - 2.4 + ph, 0.8, fy - 0.2 + ph * 1.2); ctx.quadraticCurveTo(1.6, fy + 1.6, 4.6, fy + 1.1); ctx.closePath();
      ctx.fillStyle = vlin(ctx, fy - 2, fy + 2, '#3d5f8a', '#16243a'); ctx.fill();
      ctx.strokeStyle = 'rgba(160,200,255,0.35)'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(4.2, fy); ctx.lineTo(1.2, fy - 0.6 + ph * 0.6); ctx.stroke();
    }
    // tank
    ctx.beginPath(); ctx.roundRect(10, 2.2, 11, 3.6, 1.8); ctx.fillStyle = vlin(ctx, 2.2, 5.8, '#f4f7fa', '#b9c3cf', '#6f7c8b'); ctx.fill();
    ell(ctx, 21.2, 3.6, 0.9, 0.9, '#3a3f48'); // valve
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(12, 2.8, 6, 0.4);
    // torso
    ctx.beginPath(); ctx.roundRect(9.5, 5.2, 13.5, 5.6, 2.8); ctx.fillStyle = vlin(ctx, 5.2, 10.8, shade(color, 0.35), color, dark); ctx.fill();
    ctx.fillStyle = '#23272f'; ctx.fillRect(14, 5.4, 1.1, 5.2); ctx.fillRect(18.6, 5.4, 0.9, 5.2); // harness
    ctx.fillStyle = '#c9a23a'; ctx.fillRect(14.1, 8.4, 0.9, 0.9); // buckle
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(11, 5.9, 10, 0.5);
    // arm
    taper(ctx, [[20, 8.5], [21.5, 11], [23.6, 12.2]], 1.9, 1.6, shade(color, -0.15));
    ell(ctx, 24.1, 12.3, 1, 0.9, '#23272f');
    // hose
    ctx.strokeStyle = '#2a2e36'; ctx.lineWidth = 0.55; ctx.beginPath(); ctx.moveTo(21.4, 3.4); ctx.bezierCurveTo(25, 2, 27, 5, 26.2, 8.4); ctx.stroke();
    // head + hood
    ell(ctx, 25.2, 6.8, 3.4, 3.2, rad(ctx, 25.2, 6.8, 3.4, '#2f3440', 0.25, -0.5));
    // mask
    ctx.beginPath(); ctx.roundRect(25.3, 4.6, 3.9, 3.1, 1.2); ctx.fillStyle = '#1b1f27'; ctx.fill();
    ctx.beginPath(); ctx.roundRect(25.8, 5.0, 3.0, 2.3, 0.9); ctx.fillStyle = vlin(ctx, 5, 7.3, '#c9fbff', '#4fc6e8', '#1f6f9a'); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(26.3, 5.3, 0.9, 0.5);
    ell(ctx, 27, 8.7, 1, 0.8, '#3a3f48'); // regulator
  });
  cache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- creatures
function fish(def, frame) {
  const L = def.size;
  const H = L * (def.long ? 0.32 : def.kind === 'shark' ? 0.36 : def.kind === 'angler' ? 0.62 : 0.56);
  const pad = def.kind === 'shark' ? 6 : def.kind === 'angler' ? 9 : 3;
  return mk(L + 5, H + pad + 3, (ctx) => {
    const [c0, c1] = def.colors;
    const wag = frame ? 1 : -1;
    const top = pad, cy = top + H / 2;
    const tl = L * (def.kind === 'shark' ? 0.3 : 0.25);
    const x0 = 1.2, rx = (L - tl) * 0.52, cx = x0 + tl + rx * 0.92, ry = H / 2;
    const tailCol = def.pattern === 'tail' ? c1 : shade(c0, -0.08);
    // tail
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.8, cy);
    const tt = def.kind === 'shark' ? 1.5 : 1;
    ctx.quadraticCurveTo(x0 + tl * 0.5, cy - ry * 0.25, x0, cy - ry * 1.05 * tt + wag);
    ctx.quadraticCurveTo(x0 + tl * 0.5, cy + wag * 0.4, x0 + (def.kind === 'shark' ? tl * 0.3 : 0), cy + ry * 0.95 + wag);
    ctx.quadraticCurveTo(x0 + tl * 0.5, cy + ry * 0.25, cx - rx * 0.8, cy);
    ctx.fillStyle = vlin(ctx, cy - ry, cy + ry, shade(tailCol, 0.25), tailCol, shade(tailCol, -0.35)); ctx.fill();
    ctx.strokeStyle = rgba(shade(tailCol, -0.5), 0.45); ctx.lineWidth = 0.25;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(cx - rx * 0.85, cy); ctx.lineTo(x0 + 1, cy + i * ry * 0.38 + wag * 0.7); ctx.stroke(); }
    // dorsal & anal fins
    const finCol = def.pattern === 'tail' ? c1 : shade(c0, -0.18);
    ctx.fillStyle = vlin(ctx, cy - ry * 1.6, cy - ry, shade(finCol, 0.2), finCol);
    ctx.beginPath();
    if (def.kind === 'shark') { ctx.moveTo(cx - rx * 0.35, cy - ry * 0.85); ctx.lineTo(cx - rx * 0.15, cy - ry - pad + 0.5); ctx.quadraticCurveTo(cx + rx * 0.05, cy - ry * 1.2, cx + rx * 0.25, cy - ry * 0.85); }
    else { ctx.moveTo(cx - rx * 0.6, cy - ry * 0.75); ctx.quadraticCurveTo(cx - rx * 0.2, cy - ry * 1.55, cx + rx * 0.35, cy - ry * 0.8); }
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - rx * 0.55, cy + ry * 0.75); ctx.quadraticCurveTo(cx - rx * 0.4, cy + ry * 1.35, cx - rx * 0.05, cy + ry * 0.8); ctx.fillStyle = finCol; ctx.fill();
    // body
    ctx.save();
    ctx.beginPath();
    if (def.long || def.kind === 'shark') {
      ctx.moveTo(cx + rx * 1.05, cy + ry * 0.1);
      ctx.bezierCurveTo(cx + rx * 0.7, cy - ry * 1.05, cx - rx * 0.6, cy - ry * 1.0, cx - rx, cy);
      ctx.bezierCurveTo(cx - rx * 0.6, cy + ry * 1.0, cx + rx * 0.6, cy + ry * 1.05, cx + rx * 1.05, cy + ry * 0.1);
    } else ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = rad(ctx, cx + rx * 0.1, cy, Math.max(rx, ry), c0, 0.45, -0.45); ctx.fill();
    ctx.clip();
    if (def.pattern === 'stripes') {
      for (const bx of [0.5, -0.05, -0.62]) {
        const x = cx + rx * bx, w = rx * (bx === -0.62 ? 0.14 : 0.2);
        ell(ctx, x, cy, w + 0.45, ry * 1.2, '#15161a');
        ell(ctx, x, cy, w, ry * 1.2, vlin(ctx, cy - ry, cy + ry, '#ffffff', '#e6eef5'));
      }
    }
    if (def.pattern === 'belly' || def.kind === 'shark') { ctx.fillStyle = vlin(ctx, cy, cy + ry, rgba(c1, 0.0), rgba(c1, 0.95)); ctx.fillRect(cx - rx * 1.2, cy - 0.2, rx * 2.4, ry * 1.3); }
    if (def.pattern === 'dots') for (let i = 0; i < 9; i++) ell(ctx, cx - rx * 0.8 + i * rx * 0.2, cy + ry * (0.35 + 0.25 * Math.sin(i * 1.7)), 0.45, 0.45, c1);
    if (def.pattern === 'eye') { ell(ctx, cx - rx * 0.45, cy - ry * 0.1, ry * 0.36, ry * 0.36, c1); ell(ctx, cx - rx * 0.45, cy - ry * 0.1, ry * 0.26, ry * 0.26, '#ffffff'); ell(ctx, cx - rx * 0.45, cy - ry * 0.1, ry * 0.18, ry * 0.18, c1); ctx.fillStyle = 'rgba(30,30,30,0.85)'; ctx.fillRect(cx + rx * 0.35, cy - ry, rx * 0.12, ry * 2); }
    if (def.pattern === 'tail') { ctx.strokeStyle = '#141820'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(cx + rx * 0.5, cy - ry * 0.55); ctx.bezierCurveTo(cx, cy - ry * 0.95, cx - rx * 0.5, cy - ry * 0.2, cx - rx * 0.9, cy - ry * 0.4); ctx.stroke(); }
    // scales shimmer + top highlight + belly shade
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 14; i++) { const sx = cx - rx * 0.7 + (i % 7) * rx * 0.22, sy = cy - ry * 0.3 + Math.floor(i / 7) * ry * 0.45; ctx.beginPath(); ctx.arc(sx, sy, 0.55, Math.PI * 0.2, Math.PI * 0.8, true); ctx.fill(); }
    ell(ctx, cx + rx * 0.05, cy - ry * 0.62, rx * 0.65, ry * 0.18, 'rgba(255,255,255,0.28)');
    ctx.fillStyle = vlin(ctx, cy + ry * 0.2, cy + ry, 'rgba(0,10,30,0)', 'rgba(0,10,30,0.3)'); ctx.fillRect(cx - rx * 1.2, cy, rx * 2.4, ry);
    ctx.restore();
    // gills
    ctx.strokeStyle = rgba(shade(c0, -0.6), 0.55); ctx.lineWidth = 0.3;
    const gx = cx + rx * (def.kind === 'shark' ? 0.4 : 0.4);
    if (def.kind === 'shark') for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(gx - i * 0.9, cy - ry * 0.35); ctx.lineTo(gx - i * 0.9 - 0.3, cy + ry * 0.25); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(gx - ry * 0.55, cy, ry * 0.6, -0.9, 0.9); ctx.stroke(); }
    // pectoral fin
    ctx.save(); ctx.translate(cx + rx * 0.2, cy + ry * 0.25); ctx.rotate(0.5 + wag * 0.25);
    ell(ctx, -ry * 0.3, 0, ry * 0.42, ry * 0.18, rgba(shade(finCol, 0.25), 0.9)); ctx.restore();
    if (def.kind === 'angler') {
      ctx.fillStyle = '#0d0710';
      ctx.beginPath(); ctx.moveTo(cx + rx * 1.02, cy - ry * 0.1); ctx.lineTo(cx + rx * 0.2, cy + ry * 0.25); ctx.lineTo(cx + rx * 0.95, cy + ry * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f2f0e6';
      for (let i = 0; i < 4; i++) { const tx = cx + rx * (0.35 + i * 0.17); ctx.beginPath(); ctx.moveTo(tx, cy - ry * 0.02 + i * 0.05); ctx.lineTo(tx + 0.35, cy + ry * 0.22); ctx.lineTo(tx + 0.7, cy - ry * 0.02); ctx.fill(); ctx.beginPath(); ctx.moveTo(tx, cy + ry * 0.55); ctx.lineTo(tx + 0.35, cy + ry * 0.32); ctx.lineTo(tx + 0.7, cy + ry * 0.55); ctx.fill(); }
      ctx.strokeStyle = shade(c0, 0.25); ctx.lineWidth = 0.55;
      ctx.beginPath(); ctx.moveTo(cx + rx * 0.2, cy - ry * 0.9); ctx.quadraticCurveTo(cx + rx * 0.4, top - 7, cx + rx * 0.95, top - 6.2 + wag * 0.3); ctx.stroke();
      const bx = cx + rx * 0.95, by = top - 6.2 + wag * 0.3;
      const g = ctx.createRadialGradient(bx - 0.3, by - 0.3, 0.1, bx, by, 1.6); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, def.glow); g.addColorStop(1, shade(def.glow, -0.3));
      ell(ctx, bx, by, 1.5, 1.5, g);
    }
    eye(ctx, cx + rx * (def.kind === 'shark' ? 0.62 : 0.55), cy - ry * (def.kind === 'angler' ? 0.45 : 0.22), Math.max(0.75, ry * (def.kind === 'shark' ? 0.16 : 0.24)), def.kind === 'angler' ? '#3a2a10' : '#101418');
  });
}

function jelly(def, frame) {
  const s = def.size;
  return mk(s + 4, s * 1.45 + 3, (ctx, w) => {
    const [c0, c1] = def.colors, cx = w / 2, by = s * 0.6 + 1;
    for (let i = 0; i < 7; i++) {
      const tx = cx - s * 0.42 + i * (s * 0.84 / 6);
      ctx.strokeStyle = rgba(c1, 0.85); ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(tx, by);
      for (let y = 0; y <= s * 0.8; y += 0.8) ctx.lineTo(tx + Math.sin(y * 0.55 + i + frame * 2) * 0.8, by + y);
      ctx.stroke();
    }
    for (const o of [-1, 1]) {
      ctx.strokeStyle = rgba(c0, 0.95); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(cx + o * 0.8, by);
      for (let y = 0; y <= s * 0.6; y += 0.6) ctx.lineTo(cx + o * 0.8 + Math.sin(y * 0.4 + o + frame * 1.5) * 1.1, by + y);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx - s / 2, by);
    ctx.bezierCurveTo(cx - s / 2, 0.4, cx + s / 2, 0.4, cx + s / 2, by);
    for (let i = 0; i < 6; i++) { const x1 = cx + s / 2 - (i + 1) * (s / 6); ctx.quadraticCurveTo(x1 + s / 12, by + 1.2, x1, by); }
    const g = ctx.createRadialGradient(cx - s * 0.12, by * 0.45, 0.3, cx, by * 0.7, s * 0.65); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c1); g.addColorStop(1, c0);
    ctx.fillStyle = g; ctx.fill();
    for (let i = 0; i < 4; i++) { ctx.strokeStyle = rgba(shade(c0, -0.25), 0.7); ctx.lineWidth = 0.4; ctx.beginPath(); ctx.arc(cx - s * 0.24 + i * s * 0.16, by * 0.72, s * 0.06, 0, Math.PI * 2); ctx.stroke(); }
    ell(ctx, cx - s * 0.16, by * 0.38, s * 0.12, s * 0.06, 'rgba(255,255,255,0.8)', -0.4);
  }, { alpha: def.alpha || 1 });
}

function octo(def, frame) {
  const s = def.size;
  return mk(s + 8, s + 7, (ctx, w) => {
    const [c0, c1] = def.colors, cx = w / 2, hy = s * 0.36 + 1.5;
    const dumbo = def.name.startsWith('Dumbo');
    for (let i = 0; i < 8; i++) {
      const a = -0.95 + i * (1.9 / 7);
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        pts.push([cx + Math.sin(a) * (s * 0.18 + t * s * 0.42) + Math.sin(t * 5 + i + frame * 1.8) * 0.9 * t, hy + s * 0.22 + t * s * 0.48 * Math.cos(a * 0.6)]);
      }
      taper(ctx, pts, 1.7, 0.45, i % 2 ? shade(c0, -0.12) : c0);
      for (let j = 2; j < 8; j += 2) ell(ctx, pts[j][0], pts[j][1] + 0.3, 0.28, 0.28, c1);
    }
    if (dumbo) for (const o of [-1, 1]) { ctx.save(); ctx.translate(cx + o * s * 0.33, hy - s * 0.2); ctx.rotate(o * (0.5 + frame * 0.35)); ell(ctx, o * 1.2, 0, s * 0.18, s * 0.1, c1); ctx.restore(); }
    ell(ctx, cx, hy, s * 0.31, s * 0.36, rad(ctx, cx, hy, s * 0.36, c0, 0.45, -0.4));
    for (let i = 0; i < 6; i++) ell(ctx, cx - s * 0.15 + hash2(i, 3) * s * 0.3, hy - s * 0.2 + hash2(i, 9) * s * 0.3, 0.35, 0.35, rgba(shade(c0, -0.3), 0.7));
    ell(ctx, cx - s * 0.1, hy - s * 0.18, s * 0.09, s * 0.05, 'rgba(255,255,255,0.75)', -0.5);
    eye(ctx, cx - s * 0.13, hy + s * 0.14, 0.9); eye(ctx, cx + s * 0.13, hy + s * 0.14, 0.9);
  }, { alpha: def.alpha || 1 });
}

function squid(def, frame) {
  const L = def.size, H = Math.max(6, L * 0.3);
  return mk(L + 5, H + 6, (ctx) => {
    const [c0, c1] = def.colors, cy = (H + 6) / 2;
    const mx0 = L * 0.42, mx1 = L + 2.5;
    for (let i = 0; i < 8; i++) {
      const pts = [], oy = (i - 3.5) * (H / 9);
      for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push([mx0 - t * (mx0 - 1.5), cy + oy * (0.4 + t) + Math.sin(t * 6 + i + frame * 2) * 0.8 * t]); }
      taper(ctx, pts, Math.max(0.9, H * 0.14), 0.3, i % 2 ? c1 : shade(c1, -0.15));
    }
    // fins at the mantle tip
    const fh = Math.min(H * 0.85, cy - 0.6); ctx.beginPath(); ctx.moveTo(mx1 - L * 0.16, cy); ctx.lineTo(mx1 - L * 0.04, cy - fh); ctx.lineTo(mx1, cy); ctx.lineTo(mx1 - L * 0.04, cy + fh); ctx.closePath();
    ctx.fillStyle = shade(c0, -0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(mx0 - 1, cy - H * 0.38); ctx.quadraticCurveTo(mx1 - 1, cy - H * 0.55, mx1, cy); ctx.quadraticCurveTo(mx1 - 1, cy + H * 0.55, mx0 - 1, cy + H * 0.38); ctx.closePath();
    ctx.fillStyle = rad(ctx, (mx0 + mx1) / 2, cy, H * 0.8, c0, 0.4, -0.45); ctx.fill();
    for (let i = 0; i < 10; i++) ell(ctx, mx0 + 2 + hash2(i, 1) * (mx1 - mx0 - 4), cy - H * 0.3 + hash2(i, 5) * H * 0.55, 0.4, 0.4, rgba(shade(c0, -0.4), 0.7));
    ell(ctx, (mx0 + mx1) / 2, cy - H * 0.3, (mx1 - mx0) * 0.3, H * 0.07, 'rgba(255,255,255,0.35)');
    eye(ctx, mx0 + 0.6, cy - H * 0.08, Math.max(0.8, H * 0.16));
  });
}

function horse(def, frame) {
  const s = def.size;
  return mk(s * 0.9 + 4, s + 5, (ctx, w) => {
    const c0 = def.colors[0];
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) pts.push([w * 0.48 + Math.sin(t * 5.2 + 0.4) * s * 0.17 - t * 1.6, 2.2 + t * s, (1 - t) * s * 0.15 + 0.55]);
    if (def.legendary) for (let i = 2; i < pts.length - 3; i += 3) { const [x, y] = pts[i]; ctx.save(); ctx.translate(x, y); ctx.rotate(-0.8 + (i % 2) * 1.6); ell(ctx, -2.2, 0, 1.8, 0.7, rgba(shade(c0, 0.2), 0.95)); ctx.restore(); }
    // dorsal fin flutter
    const [fx, fy] = pts[8];
    ctx.beginPath(); ctx.moveTo(fx - 1, fy - 1.6); ctx.quadraticCurveTo(fx - 3.4 - frame, fy, fx - 1, fy + 1.8); ctx.fillStyle = rgba(shade(c0, 0.35), 0.85); ctx.fill();
    for (let i = pts.length - 1; i >= 0; i--) { const [x, y, r] = pts[i]; ell(ctx, x, y, r * 1.08, r, rad(ctx, x, y, r, c0, 0.4, -0.35)); }
    ctx.strokeStyle = rgba(shade(c0, -0.45), 0.6); ctx.lineWidth = 0.25;
    for (let i = 3; i < pts.length; i += 2) { const [x, y, r] = pts[i]; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.stroke(); }
    const [hx, hy, hr] = pts[1];
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(0.25);
    ctx.beginPath(); ctx.roundRect(hr * 0.4, -0.55, s * 0.32, 1.1, 0.5); ctx.fillStyle = vlin(ctx, -0.6, 0.6, shade(c0, 0.3), shade(c0, -0.2)); ctx.fill();
    ctx.restore();
    ell(ctx, hx - 0.4, hy - hr * 0.9, 0.8, 0.9, shade(c0, -0.15)); // coronet
    const [ex, ey] = pts[pts.length - 1];
    ctx.strokeStyle = shade(c0, -0.2); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(ex + 1.3, ey - 1.1, 1.2, Math.PI * 0.6, Math.PI * 2.1); ctx.stroke();
    eye(ctx, hx + 0.3, hy - 0.2, 0.6);
  });
}

function naut(def, frame) {
  const s = def.size;
  return mk(s + 7, s + 3, (ctx) => {
    const [c0, c1] = def.colors, cx = s / 2 + 5, cy = s / 2 + 1.5, r = s / 2;
    for (let i = 0; i < 5; i++) taper(ctx, [[cx - r * 0.75, cy + 0.5], [cx - r - 1.5, cy - 0.5 + i * 0.7], [2, cy - 1.5 + i * 1.1 + (frame ? 0.5 : -0.5)]], 0.8, 0.35, '#e8b38a');
    ell(ctx, cx, cy, r, r, rad(ctx, cx, cy, r, c0, 0.45, -0.35));
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = c1; ctx.lineWidth = r * 0.16;
    for (let a = -0.4; a < 3.6; a += 0.75) { ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); ctx.quadraticCurveTo(cx + Math.cos(a + 0.4) * r * 0.8, cy + Math.sin(a + 0.4) * r * 0.8, cx + Math.cos(a + 0.2) * r * 1.1, cy + Math.sin(a + 0.2) * r * 1.1); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = rgba(shade(c0, -0.5), 0.6); ctx.lineWidth = 0.35;
    ctx.beginPath(); for (let a = 0; a < Math.PI * 3.2; a += 0.15) { const rr = r * 0.9 * Math.exp(-a * 0.17); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    ell(ctx, cx - r * 0.8, cy, r * 0.32, r * 0.55, shade('#4a2a20', 0.1)); // aperture / hood
    eye(ctx, cx - r * 0.8, cy - r * 0.15, 0.7);
    ell(ctx, cx - r * 0.25, cy - r * 0.55, r * 0.35, r * 0.12, 'rgba(255,255,255,0.5)', -0.3);
  });
}

function turtle(def, frame) {
  const s = def.size;
  return mk(s + 8, s * 0.62 + 6, (ctx, w, h) => {
    const [c0, c1] = def.colors, cx = s / 2 + 3, cy = h / 2;
    const f = frame ? 1 : -1;
    const flip = (x, y, rx, ry, rot) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ell(ctx, rx * 0.8, 0, rx, ry, vlin(ctx, -ry, ry, shade(c1, 0.2), shade(c1, -0.25))); ctx.restore(); };
    flip(cx + s * 0.2, cy + s * 0.12, s * 0.24, s * 0.07, 0.6 + f * 0.35);
    flip(cx - s * 0.3, cy + s * 0.12, s * 0.13, s * 0.05, 2.6 - f * 0.25);
    flip(cx + s * 0.18, cy - s * 0.05, s * 0.22, s * 0.065, -0.5 - f * 0.35);
    // head
    ell(ctx, cx + s * 0.5, cy + 0.2, s * 0.11, s * 0.085, rad(ctx, cx + s * 0.5, cy, s * 0.1, c1, 0.3, -0.3));
    eye(ctx, cx + s * 0.54, cy - 0.3, 0.6);
    // shell
    ell(ctx, cx, cy, s * 0.42, s * 0.25, rad(ctx, cx, cy, s * 0.42, c0, 0.4, -0.5));
    ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.42, s * 0.25, 0, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = rgba(shade(c0, -0.5), 0.75); ctx.lineWidth = 0.35;
    for (let i = -2; i <= 2; i++) { const x = cx + i * s * 0.16; ctx.beginPath(); ctx.moveTo(x - 1.4, cy - s * 0.3); ctx.lineTo(x - 2, cy); ctx.lineTo(x - 1.4, cy + s * 0.3); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - s * 0.45, cy); ctx.lineTo(cx + s * 0.45, cy); ctx.stroke();
    for (let i = -2; i <= 1; i++) ell(ctx, cx + i * s * 0.16 + s * 0.06, cy - s * 0.1, s * 0.05, s * 0.04, rgba(shade(c0, 0.45), 0.5));
    ctx.restore();
    ctx.fillStyle = shade(c1, -0.05); ctx.fillRect(cx - s * 0.42, cy + s * 0.19, s * 0.84, s * 0.05);
  });
}

export function creatureSprite(key, frame) {
  const k = `cre:${key}:${frame}`;
  if (!cache.has(k)) {
    const def = CREATURES[key];
    const f = { jelly, octo, squid, horse, naut, turtle }[def.kind] || fish;
    cache.set(k, f(def, frame));
  }
  return cache.get(k);
}

// ---------------------------------------------------------------- plants
function plant(def, frame) {
  const [c0, c1] = def.colors;
  const sw = frame ? 0.6 : -0.6;
  const stem = (pts, w0, w1, col) => taper(ctx_, pts, w0, w1, col);
  let ctx_;
  const sizes = { grass: [12, 12], kelp: [12, 40], coral: [15, 14], fan: [16, 15], star: [12, 9], lily: [13, 16], sponge: [12, 14], anemone: [15, 12], tube: [15, 17], moss: [15, 9] };
  const [w, h] = sizes[def.art] || [8, 8];
  return mk(w, h, (ctx) => {
    ctx_ = ctx;
    switch (def.art) {
      case 'grass':
        for (let i = 0; i < 7; i++) {
          const bx = 1.8 + i * 1.4, bh = 6 + ((i * 7) % 5);
          const tip = [bx + sw * (i % 2 ? 1 : -1) * 1.2, h - bh];
          stem([[bx, h - 0.5], [bx + (tip[0] - bx) * 0.3, h - bh * 0.5], tip], 0.95, 0.25, i % 3 ? c0 : c1);
        }
        break;
      case 'kelp': {
        const pts = [];
        for (let y = 0; y <= 38; y += 1.5) pts.push([6 + Math.sin(y * 0.16 + frame * 1.1) * 1.8 * (y / 38), h - 0.5 - y]);
        stem(pts, 0.9, 0.5, shade(c0, -0.2));
        for (let i = 2; i < pts.length - 1; i += 2) {
          const [x, y] = pts[i], o = i % 4 === 2 ? 1 : -1;
          ctx.save(); ctx.translate(x, y); ctx.rotate(o * (0.9 + sw * 0.15));
          ell(ctx, 0, -2.4, 0.85, 2.5, vlin(ctx, -5, 0, shade(c1, 0.25), c0)); ctx.restore();
          if (i % 6 === 0) ell(ctx, x + o * 0.6, y + 0.4, 0.55, 0.55, '#c8b04a');
        }
        break;
      }
      case 'coral': {
        const br = (x, y, a, len, d, wd) => {
          if (d > 4 || len < 0.8) return;
          const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
          stem([[x, y], [x2, y2]], wd, wd * 0.75, d > 2 ? shade(c1, 0.1) : c0);
          if (d >= 3) ell(ctx, x2, y2, wd * 0.6, wd * 0.6, shade(c1, 0.35));
          br(x2, y2, a - 0.5, len * 0.72, d + 1, wd * 0.75); br(x2, y2, a + 0.42, len * 0.68, d + 1, wd * 0.75);
        };
        br(7.5, h - 0.5, -Math.PI / 2, 4.6, 0, 1.6);
        break;
      }
      case 'fan': {
        const ox = 8, oy = h - 0.5;
        for (let a = -2.75; a <= -0.4; a += 0.16) stem([[ox, oy], [ox + Math.cos(a) * 4, oy + Math.sin(a) * 6], [ox + Math.cos(a) * 7 + sw * 0.4, oy + Math.sin(a) * 12.5]], 0.6, 0.25, a % 0.32 < 0.16 ? c0 : shade(c0, -0.2));
        ctx.strokeStyle = rgba(c1, 0.8); ctx.lineWidth = 0.25;
        for (let r = 3; r < 12; r += 2) { ctx.beginPath(); ctx.ellipse(ox, oy, r * 0.58, r, 0, Math.PI * 1.13, Math.PI * 1.87); ctx.stroke(); }
        break;
      }
      case 'star': {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 1.6 : 4.8; const x = 6 + Math.cos(a) * r, y = 5.2 + Math.sin(a) * r * 0.75; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath(); ctx.fillStyle = rad(ctx, 6, 5, 4.5, c0, 0.35, -0.4); ctx.fill();
        for (let i = 0; i < 12; i++) ell(ctx, 6 + Math.cos(i * 2.4) * (1 + (i % 3)), 5.2 + Math.sin(i * 2.4) * (0.8 + (i % 3) * 0.7), 0.3, 0.3, c1);
        break;
      }
      case 'lily': {
        stem([[6.5, h - 0.5], [6.5 + sw * 0.3, 11], [6.5 + sw, 7]], 0.8, 0.5, '#9a8a5a');
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI + 0.1 + (i * (Math.PI - 0.2)) / 8;
          const ex = 6.5 + sw + Math.cos(a) * 5, ey = 6.5 + Math.sin(a) * 5.5;
          stem([[6.5 + sw, 7], [ex, ey]], 0.55, 0.3, i % 2 ? c1 : c0);
          ctx.strokeStyle = rgba(c1, 0.7); ctx.lineWidth = 0.2;
          for (let t = 0.3; t < 1; t += 0.2) { const px = 6.5 + sw + Math.cos(a) * 5 * t, py = 7 + Math.sin(a) * 5.5 * t; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a + 1.2) * 0.8, py + Math.sin(a + 1.2) * 0.8); ctx.stroke(); }
        }
        ell(ctx, 6.5 + sw, 7, 1, 0.9, shade(c0, -0.2));
        break;
      }
      case 'sponge': {
        ctx.beginPath(); ctx.moveTo(2.5, h - 0.5); ctx.quadraticCurveTo(1.6, 6, 3, 1.5); ctx.lineTo(9, 1.5); ctx.quadraticCurveTo(10.4, 6, 9.5, h - 0.5); ctx.closePath();
        ctx.fillStyle = hlin(ctx, 1.5, 10.5, [shade(c0, -0.35), shade(c0, 0.2), c0, shade(c0, -0.45)]); ctx.fill();
        ell(ctx, 6, 1.9, 2.9, 0.9, shade(c0, -0.6));
        for (let i = 0; i < 16; i++) ell(ctx, 3 + hash2(i, 2) * 6, 3.5 + hash2(i, 8) * 9.5, 0.3, 0.3, i % 3 ? rgba(shade(c0, -0.5), 0.8) : c1);
        break;
      }
      case 'anemone': {
        ctx.beginPath(); ctx.roundRect(4.5, 7.5, 6, 4, 1.2); ctx.fillStyle = vlin(ctx, 7.5, 11.5, shade(c0, -0.05), shade(c0, -0.45)); ctx.fill();
        for (let i = 0; i < 13; i++) {
          const a = -Math.PI + 0.25 + (i * (Math.PI - 0.5)) / 12;
          const pts = [];
          for (let t = 0; t <= 1; t += 0.2) pts.push([7.5 + Math.cos(a) * t * 6 + Math.sin(t * 4 + i + frame * 2) * 0.5, 8 + Math.sin(a) * t * 6.5]);
          taper(ctx, pts, 0.75, 0.35, c0);
          ell(ctx, pts[pts.length - 1][0], pts[pts.length - 1][1], 0.42, 0.42, c1);
        }
        break;
      }
      case 'tube': {
        for (let i = 0; i < 5; i++) {
          const bx = 2.4 + i * 2.5, th = 7 + ((i * 5) % 6);
          ctx.beginPath(); ctx.roundRect(bx - 0.75, h - th, 1.5, th, 0.6); ctx.fillStyle = hlin(ctx, bx - 0.8, bx + 0.8, ['#c9c9c4', '#ffffff', '#9a9a95']); ctx.fill();
          for (let j = 0; j < 7; j++) { const a = -Math.PI / 2 + (j - 3) * 0.32 + (frame && i % 2 ? 0.12 : 0); stem([[bx, h - th], [bx + Math.cos(a) * 1.8, h - th + Math.sin(a) * 1.8]], 0.45, 0.25, j % 2 ? c1 : shade(c1, -0.2)); }
        }
        break;
      }
      case 'moss': {
        ell(ctx, 7.5, h, 7, 6, rad(ctx, 7.5, h - 2, 7, c0, 0.35, -0.35));
        for (let i = 0; i < 30; i++) ell(ctx, 1.5 + hash2(i, 4) * 12, h - hash2(i, 6) * 5, 0.35, 0.35, rgba(shade(c0, 0.4), 0.8));
        for (const [x, y] of [[4, 5.5], [8, 4.2], [10.5, 6], [6.3, 7]]) { ell(ctx, x, y, 0.9, 0.9, rad(ctx, x, y, 0.9, c1, 0.6, -0.25)); }
        break;
      }
    }
  });
}

// ---------------------------------------------------------------- treasure
function treasure(def) {
  const [c0, c1] = def.colors;
  const sizes = { chest: [16, 12], coins: [14, 8], cup: [10, 12], compass: [11, 11], clam: [14, 9], idol: [10, 14], crown: [14, 10] };
  const [w, h] = sizes[def.art];
  return mk(w, h, (ctx) => {
    switch (def.art) {
      case 'chest': {
        const wood = c0, metal = c1;
        ctx.beginPath(); ctx.moveTo(1.5, 5); ctx.quadraticCurveTo(8, -0.5, 14.5, 5); ctx.closePath(); ctx.fillStyle = vlin(ctx, 1, 5, shade(wood, 0.3), wood); ctx.fill();
        ctx.fillStyle = vlin(ctx, 5, 11.5, shade(wood, 0.1), shade(wood, -0.35)); ctx.fillRect(1.5, 5, 13, 6.5);
        ctx.strokeStyle = rgba(shade(wood, -0.55), 0.8); ctx.lineWidth = 0.25;
        for (let y = 6.6; y < 11.5; y += 1.6) { ctx.beginPath(); ctx.moveTo(1.5, y); ctx.lineTo(14.5, y); ctx.stroke(); }
        const band = vlin(ctx, 1, 11.5, shade(metal, 0.45), metal, shade(metal, -0.35));
        ctx.fillStyle = band; ctx.fillRect(1.5, 4.6, 13, 1); ctx.fillRect(3.2, 2.2, 1, 9.3); ctx.fillRect(11.8, 2.2, 1, 9.3);
        ctx.beginPath(); ctx.roundRect(6.9, 4.4, 2.2, 2.8, 0.4); ctx.fillStyle = band; ctx.fill();
        ell(ctx, 8, 6.2, 0.35, 0.5, '#1a1208');
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(4.5, 2.6, 5, 0.35);
        for (const x of [5.2, 10.8]) { ell(ctx, x, 4.5, 0.75, 0.38, shade(metal, 0.25)); }
        break;
      }
      case 'coins': {
        const coin = (x, y) => { ell(ctx, x, y, 1.6, 0.75, rad(ctx, x, y, 1.6, c0, 0.5, -0.3)); ctx.strokeStyle = rgba(c1, 0.9); ctx.lineWidth = 0.22; ctx.beginPath(); ctx.ellipse(x, y, 1.1, 0.45, 0, 0, Math.PI * 2); ctx.stroke(); };
        const rows = [[2.5, 7.2, 5], [3.6, 6.1, 4], [4.7, 5.0, 3], [5.8, 3.9, 2], [6.9, 2.8, 1]];
        for (const [x0, y, n] of rows) for (let i = 0; i < n; i++) coin(x0 + i * 2.2, y);
        ell(ctx, 7.7, 1.4, 1.1, 1.1, rad(ctx, 7.7, 1.4, 1.1, c0, 0.6, -0.2));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(7.3, 1, 0.4, 0.4);
        break;
      }
      case 'cup': {
        const met = hlin(ctx, 1, 9, [shade(c1, -0.2), '#ffffff', c0, shade(c1, -0.35), c0]);
        ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(9, 1); ctx.quadraticCurveTo(9, 5.6, 5.6, 6.2); ctx.lineTo(4.4, 6.2); ctx.quadraticCurveTo(1, 5.6, 1, 1); ctx.fillStyle = met; ctx.fill();
        ctx.fillStyle = met; ctx.fillRect(4.4, 6.2, 1.2, 3.4);
        ctx.beginPath(); ctx.ellipse(5, 10.6, 3, 1, 0, 0, Math.PI * 2); ctx.fill();
        ell(ctx, 5, 1.1, 3.9, 0.6, shade(c1, -0.5));
        ell(ctx, 3.3, 2.8, 0.7, 0.7, '#e2384a'); ell(ctx, 6.7, 2.8, 0.7, 0.7, '#3a7aff');
        break;
      }
      case 'compass': {
        ell(ctx, 5.5, 5.5, 4.7, 4.7, rad(ctx, 5.5, 5.5, 4.7, c0, 0.5, -0.4));
        ell(ctx, 5.5, 5.5, 3.6, 3.6, vlin(ctx, 2, 9, c1, shade(c1, -0.15)));
        ctx.strokeStyle = rgba(shade(c0, -0.5), 0.8); ctx.lineWidth = 0.2;
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(5.5 + Math.cos(a) * 2.8, 5.5 + Math.sin(a) * 2.8); ctx.lineTo(5.5 + Math.cos(a) * 3.4, 5.5 + Math.sin(a) * 3.4); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(5.5, 2.3); ctx.lineTo(6.2, 5.5); ctx.lineTo(4.8, 5.5); ctx.fillStyle = '#e2384a'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(5.5, 8.7); ctx.lineTo(6.2, 5.5); ctx.lineTo(4.8, 5.5); ctx.fillStyle = '#2a2a30'; ctx.fill();
        ell(ctx, 5.5, 5.5, 0.45, 0.45, c0);
        ell(ctx, 4, 3.6, 1.3, 0.55, 'rgba(255,255,255,0.6)', -0.6);
        break;
      }
      case 'clam': {
        const shell = (y0, dir) => {
          ctx.beginPath(); ctx.moveTo(1, y0); ctx.quadraticCurveTo(7, y0 + dir * 5.5, 13, y0); ctx.closePath();
          ctx.fillStyle = rad(ctx, 7, y0 + dir * 2, 6, c0, 0.4, -0.35); ctx.fill();
          ctx.strokeStyle = rgba(shade(c0, -0.45), 0.7); ctx.lineWidth = 0.25;
          for (let i = 1; i < 7; i++) { ctx.beginPath(); ctx.moveTo(7, y0 + dir * 0.3); ctx.lineTo(1 + i * 1.71, y0 + dir * (Math.sin((i / 7) * Math.PI) * 4)); ctx.stroke(); }
        };
        shell(4.2, -1);
        ell(ctx, 7, 5.3, 5.5, 1.1, shade(c0, -0.6));
        shell(5.3, 1);
        ell(ctx, 7.6, 4.6, 1.9, 1.9, rad(ctx, 7.6, 4.6, 1.9, c1, 0.7, -0.25));
        ell(ctx, 7, 3.9, 0.55, 0.4, '#ffffff');
        break;
      }
      case 'idol': {
        const jade = (x, y, rx, ry) => ell(ctx, x, y, rx, ry, rad(ctx, x, y, Math.max(rx, ry), c0, 0.5, -0.4));
        jade(5, 11.5, 4, 1.8);
        ctx.beginPath(); ctx.roundRect(2.6, 5.2, 4.8, 6.5, 1.4); ctx.fillStyle = hlin(ctx, 2.6, 7.4, [shade(c0, 0.35), c0, shade(c0, -0.4)]); ctx.fill();
        jade(5, 3.4, 2.7, 2.9);
        ctx.fillStyle = '#0d2a1a'; ctx.fillRect(3.9, 3.1, 0.8, 0.6); ctx.fillRect(5.4, 3.1, 0.8, 0.6); ctx.fillRect(4.3, 4.7, 1.4, 0.35);
        ell(ctx, 4.3, 3.4, 0.25, 0.25, c1); ell(ctx, 5.8, 3.4, 0.25, 0.25, c1);
        ctx.strokeStyle = rgba(c1, 0.8); ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(3.2, 7.5); ctx.lineTo(6.8, 7.5); ctx.moveTo(3.2, 9.2); ctx.lineTo(6.8, 9.2); ctx.stroke();
        ell(ctx, 4, 2, 0.8, 0.45, 'rgba(255,255,255,0.55)', -0.4);
        break;
      }
      case 'crown': {
        const gold = vlin(ctx, 0.5, 9.5, shade(c0, 0.5), c0, shade(c0, -0.4));
        ctx.beginPath(); ctx.moveTo(1.5, 9); ctx.lineTo(1, 2.5); ctx.lineTo(4, 5.5); ctx.lineTo(7, 1); ctx.lineTo(10, 5.5); ctx.lineTo(13, 2.5); ctx.lineTo(12.5, 9); ctx.closePath();
        ctx.fillStyle = gold; ctx.fill();
        ctx.fillStyle = shade(c0, -0.25); ctx.fillRect(1.4, 7.2, 11.2, 1.8);
        for (const [x, y, r, col] of [[1, 2.5, 0.75, '#ffffff'], [7, 1, 0.9, '#ffffff'], [13, 2.5, 0.75, '#ffffff'], [4, 8.1, 0.65, '#e2384a'], [7, 8.1, 0.8, c1], [10, 8.1, 0.65, '#e2384a']]) ell(ctx, x, y, r, r, rad(ctx, x, y, r, col, 0.6, -0.3));
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(3, 6.2, 4, 0.35);
        break;
      }
    }
  });
}

export function itemSprite(key, frame) {
  const k = `item:${key}:${TREASURES[key] ? 0 : frame}`;
  if (!cache.has(k)) cache.set(k, TREASURES[key] ? treasure(TREASURES[key]) : plant(PLANTS[key], frame));
  return cache.get(k);
}
