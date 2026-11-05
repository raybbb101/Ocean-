// Procedural ocean: seabed profile, boulders and seabed collectibles, all from one seed.
import { WORLD, PLANTS, TREASURES } from './data.js';
import { mulberry32, makeNoise1D, smooth, clamp, pickWeighted, mixHex } from './util.js';

const STEP = 8;

export class World {
  constructor(seed) {
    this.seed = seed;
    const rng = mulberry32(seed);
    const noise = makeNoise1D(rng);
    const W = WORLD.W, D = WORLD.D;
    const trenches = [];
    for (let i = 0; i < 4; i++) trenches.push({ cx: 2500 + rng() * 5000, w: 120 + rng() * 200, d: 250 + rng() * 450 });
    // Rough depth profile: each zone gets its own stretch of the map (x, depth).
    const PROFILE = [[0, 30], [300, 80], [1900, 560], [2500, 900], [3700, 1550], [4300, 2150], [5600, 2900], [6200, 3700], [8000, 4750]];
    const profileAt = (x) => {
      for (let i = 1; i < PROFILE.length; i++) {
        if (x <= PROFILE[i][0]) { const [x0, y0] = PROFILE[i - 1], [x1, y1] = PROFILE[i]; const t = smooth(0, 1, (x - x0) / (x1 - x0)); return y0 + (y1 - y0) * t; }
      }
      return PROFILE[PROFILE.length - 1][1];
    };

    const n = Math.ceil(W / STEP) + 2;
    this.floor = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * STEP;
      let y = profileAt(x);
      const amp = 15 + y * 0.12;
      y += noise(x / 380) * amp + noise(x / 80 + 77) * amp * 0.3;
      for (const tr of trenches) y += tr.d * Math.exp(-(((x - tr.cx) / tr.w) ** 2));
      if (x < 700) y = Math.min(y, 6 + x * 0.32 + 12 * Math.abs(noise(x / 40))); // gentle beach sloping out from the island
      this.floor[i] = clamp(y, 40, D - 30);
    }

    // Boulders: half-buried ones on the seabed plus floating arches deeper down.
    this.rocks = [];
    for (let i = 0; i < 170; i++) {
      const x = 300 + rng() * (W - 350);
      const fy = this.floorAt(x);
      const r = Math.round(6 + rng() * (10 + 16 * (fy / D)));
      this.rocks.push({ x, y: fy - r * 0.25, r, tint: this.rockTint(fy) });
    }
    for (let i = 0; i < 45; i++) {
      const x = 1200 + rng() * (W - 1300);
      const fy = this.floorAt(x);
      if (fy < 600) continue;
      const y = fy * (0.55 + rng() * 0.3);
      const r = Math.round(10 + rng() * 22);
      this.rocks.push({ x, y, r, tint: this.rockTint(y) });
    }
    this.rocks.sort((a, b) => a.x - b.x);

    // Seabed collectibles.
    this.items = [];
    let id = 0;
    for (let x = 260; x < W - 40; x += 16 + rng() * 30) {
      const fy = this.floorAt(x);
      const treasureChance = 0.07 + 0.08 * (fy / D);
      const pool = rng() < treasureChance ? TREASURES : PLANTS;
      const keys = Object.keys(pool).filter((k) => fy >= pool[k].min && fy <= pool[k].max);
      const key = pickWeighted(rng, keys, (k) => pool[k].w);
      if (!key) continue;
      this.items.push({ id: id++, key, x: Math.round(x), y: Math.round(fy), treasure: pool === TREASURES, taken: false, respawnAt: 0 });
    }
    // A few legendary crowns hidden at the very deepest points of the map.
    const deep = [];
    for (let x = 5000; x < W - 60; x += 200) {
      let bx = x, by = 0;
      for (let xx = x; xx < x + 200; xx += STEP) { const fy = this.floorAt(xx); if (fy > by) { by = fy; bx = xx; } }
      deep.push([bx, by]);
    }
    deep.sort((a, b) => b[1] - a[1]);
    for (const [x, y] of deep.slice(0, 3)) this.items.push({ id: id++, key: 'crown', x: Math.round(x), y: Math.round(y), treasure: true, taken: false, respawnAt: 0 });
  }

  rockTint(y) { return mixHex('#8a7a5f', '#2c3140', clamp(y / 2600, 0, 1)); }

  floorAt(x) {
    const f = clamp(x, 0, WORLD.W) / STEP;
    const i = Math.floor(f), t = f - i;
    const a = this.floor[i], b = this.floor[Math.min(i + 1, this.floor.length - 1)];
    return a + (b - a) * t;
  }

  // Rocks whose x-extent overlaps [x0, x1]. rocks are sorted by x.
  rocksIn(x0, x1) {
    const out = [];
    for (const r of this.rocks) { if (r.x + r.r < x0) continue; if (r.x - r.r > x1) break; out.push(r); }
    return out;
  }

  // Push a circle (x,y,rad) out of the seabed and boulders. Returns corrected {x,y,hit}.
  collide(x, y, rad) {
    let hit = false;
    const fy = this.floorAt(x);
    if (y + rad > fy) { y = fy - rad; hit = true; }
    for (const r of this.rocksIn(x - rad - 40, x + rad + 40)) {
      const dx = x - r.x, dy = y - r.y, d = Math.hypot(dx, dy), min = r.r + rad;
      if (d < min && d > 0.001) { x = r.x + (dx / d) * min; y = r.y + (dy / d) * min; hit = true; }
    }
    return { x, y, hit };
  }
}
