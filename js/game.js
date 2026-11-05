// Core game: simulation, rendering and co-op synchronisation.
import { WORLD, CREATURES, UPGRADES, BUOYS, WATER, METRES_PER_PX, zoneAt, itemDef } from './data.js';
import { World } from './world.js';
import { creatureSprite, itemSprite, diverSprite, rockSprite } from './sprites.js';
import { clamp, lerp, mixHex, pickWeighted, hash2, smooth } from './util.js';

const PLAYER_R = 6;
const SURFACE_Y = 4;
const LUT_STEP = 10;

// ---- Colour lookup tables (avoid per-pixel colour maths every frame) ----
function waterColor(y) {
  for (let i = 1; i < WATER.length; i++) {
    if (y <= WATER[i][0]) { const [y0, c0] = WATER[i - 1], [y1, c1] = WATER[i]; return mixHex(c0, c1, (y - y0) / (y1 - y0)); }
  }
  return WATER[WATER.length - 1][1];
}
const WATER_LUT = [], FAR1_LUT = [], FAR2_LUT = [], FLOOR_LUT = [], FLOOR_TOP_LUT = [];
for (let y = 0; y <= WORLD.D + 400; y += LUT_STEP) {
  const w = waterColor(y);
  WATER_LUT.push(w);
  FAR1_LUT.push(mixHex(w, '#04101e', 0.22));
  FAR2_LUT.push(mixHex(w, '#04101e', 0.42));
  const f = mixHex('#c9b27a', '#1b2230', clamp(y / 2400, 0, 1));
  FLOOR_LUT.push(f);
  FLOOR_TOP_LUT.push(mixHex(f, '#ffffff', 0.18));
}
const lut = (T, y) => T[clamp(Math.round(y / LUT_STEP), 0, T.length - 1)];

export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.ui = ui;
    this.mask = document.createElement('canvas');
    this.mctx = this.mask.getContext('2d');
    this.minimap = document.getElementById('minimap');
    this.running = false;
    this.snow = Array.from({ length: 80 }, () => ({ x: Math.random() * 2000, y: Math.random() * 2000, z: 0.3 + Math.random() * 0.7 }));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.loop = this.loop.bind(this);
  }

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    const scale = Math.max(2, Math.round(Math.min(W, H) / 230));
    this.vw = Math.ceil(W / scale); this.vh = Math.ceil(H / scale);
    this.canvas.width = this.vw; this.canvas.height = this.vh;
    this.mask.width = this.vw; this.mask.height = this.vh;
    this.ctx.imageSmoothingEnabled = false;
  }

  // ------------------------------------------------------------------ lifecycle
  start({ profile, mode, net = null, seed, taken = [] }) {
    this.profile = profile;
    this.mode = mode; // 'solo' | 'host' | 'guest'
    this.net = net;
    this.myId = net ? net.myId : 'local';
    this.world = new World(seed);
    for (const id of taken) { const it = this.world.items[id]; if (it) it.taken = true; }
    this.refreshStats();
    this.me = { x: WORLD.DOCK_X, y: SURFACE_Y, vx: 0, vy: 0, face: 1, o2: this.st.o2, hp: 100, invuln: 0, reload: 0, anim: 0, bubbleT: 0 };
    this.cam = { x: this.me.x, y: this.me.y };
    this.others = new Map();
    this.creatures = new Map();
    this.nextCid = 1;
    this.shots = []; this.fx = []; this.popups = [];
    this.time = 0; this.netT = 0; this.spawnT = 0; this.respawnT = 0; this.hudT = 0; this.saveT = 0; this.shake = 0;
    this.warn = '';
    this.buildMinimapBase();
    if (net) this.bindNet();
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.saveNow();
  }

  get isAuth() { return this.mode !== 'guest'; }

  refreshStats() {
    const u = this.profile.upgrades;
    this.st = {
      speed: UPGRADES.fins.val(u.fins), o2: UPGRADES.tank.val(u.tank), cap: UPGRADES.bag.val(u.bag),
      depth: UPGRADES.suit.val(u.suit), suitLvl: u.suit, harpoon: UPGRADES.harpoon.val(u.harpoon), lamp: UPGRADES.lamp.val(u.lamp),
    };
  }

  cargoKg() { let kg = 0; for (const k of this.profile.cargo) kg += itemDef(k)?.kg || 0; return kg; }

  saveNow() { if (this.profile) this.ui.save(this.profile); }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const inp = this.input, me = this.me, st = this.st;
    this.time += dt;
    this.warn = '';

    // --- movement: deeper = heavier, cargo adds weight ---
    const ax = inp.axis();
    const depth = Math.max(0, me.y);
    const kg = this.cargoKg();
    const heavy = 1 + (depth / 1800) * (1 - 0.11 * st.suitLvl) + (kg / st.cap) * 0.35;
    this.heavy = heavy;
    const maxV = (80 * st.speed) / heavy;
    const k = Math.min(1, dt * 4);
    me.vx += (ax.x * maxV - me.vx) * k;
    me.vy += (ax.y * maxV - me.vy) * k;
    if (me.y > SURFACE_Y + 3) me.vy += 40 * (heavy - 1) * dt; // the deep pulls you down
    me.x = clamp(me.x + me.vx * dt, 6, WORLD.W - 6);
    me.y += me.vy * dt;
    if (me.y < SURFACE_Y) { me.y = SURFACE_Y; if (me.vy < 0) me.vy = 0; }
    const col = this.world.collide(me.x, me.y, PLAYER_R);
    me.x = col.x; me.y = Math.max(SURFACE_Y, col.y);
    if (Math.abs(me.vx) > 4) me.face = Math.sign(me.vx);
    me.anim += dt * (1.5 + Math.hypot(me.vx, me.vy) / 18);
    me.invuln -= dt; me.reload -= dt;
    if (me.y > this.profile.bestDepth) this.profile.bestDepth = Math.round(me.y);

    // bubbles
    me.bubbleT -= dt;
    if (me.bubbleT <= 0 && me.y > SURFACE_Y + 4) { me.bubbleT = 0.5 + Math.random() * 0.7; this.addBubble(me.x + me.face * 8, me.y - 3); }

    // --- oxygen, pressure, health ---
    const atSurface = me.y <= SURFACE_Y + 6;
    if (atSurface) { me.o2 = Math.min(st.o2, me.o2 + 50 * dt); me.hp = Math.min(100, me.hp + 15 * dt); }
    else me.o2 -= 1.5 * (1 + depth / 1500) * dt;
    if (me.o2 <= 0) { me.o2 = 0; me.hp -= 14 * dt; this.warn = 'OUT OF OXYGEN — SURFACE NOW!'; }
    else if (me.o2 < st.o2 * 0.25) this.warn = 'Low oxygen';
    if (depth > st.depth) { me.hp -= (5 + (depth - st.depth) / 30) * dt; this.warn = 'PRESSURE! Too deep for your suit'; }
    if (me.hp <= 0) return this.blackout();

    // --- surface stops (shop / boat) ---
    this.nearStop = null;
    if (atSurface) {
      for (const b of BUOYS) {
        if (Math.abs(me.x - b.x) < (b.id === 'dock' ? 110 : 60)) {
          this.nearStop = b;
          if (!this.profile.buoys.includes(b.id)) {
            this.profile.buoys.push(b.id);
            this.ui.toast(`⚓ Boat stop unlocked: ${b.name}`);
            this.saveNow();
          }
        }
      }
    }
    if (this.nearStop && inp.take('action')) this.ui.openShop(this.nearStop.id === 'dock' ? 'dock' : 'buoy');

    // --- grab ---
    this.grabTarget = this.findGrabTarget();
    if (inp.take('grab') && this.grabTarget) this.tryGrab(this.grabTarget);

    // --- shoot ---
    if (inp.shooting() && me.reload <= 0 && me.y > SURFACE_Y + 2) this.fire();

    this.updateShots(dt);
    if (this.isAuth) this.simulateCreatures(dt); else this.interpolateCreatures(dt);
    this.creatureContact();
    for (const o of this.others.values()) { const t = Math.min(1, dt * 10); o.x = lerp(o.x, o.tx, t); o.y = lerp(o.y, o.ty, t); o.anim += dt * 4; }
    this.updateFx(dt);

    // journal: mark creatures seen within lamp range
    const seenR2 = (st.lamp + 30) ** 2;
    for (const c of this.creatures.values()) {
      if ((c.x - me.x) ** 2 + (c.y - me.y) ** 2 < seenR2) this.markSeen(c.key);
    }

    // network
    if (this.net) this.netTick(dt);

    // camera
    const t = Math.min(1, dt * 6);
    this.cam.x = lerp(this.cam.x, me.x + me.face * 20, t * 0.5);
    this.cam.y = lerp(this.cam.y, me.y, t);
    this.cam.x = clamp(this.cam.x, -170 + this.vw * 0.5, WORLD.W - this.vw / 2);
    this.cam.y = clamp(this.cam.y, -this.vh * 0.12, WORLD.D - this.vh / 2 + 20);
    this.shake = Math.max(0, this.shake - dt);

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.ui.updateHud(this); }
    this.saveT += dt;
    if (this.saveT > 15) { this.saveT = 0; this.saveNow(); }
  }

  blackout() {
    const lost = this.profile.cargo.length;
    this.profile.cargo = [];
    Object.assign(this.me, { x: WORLD.DOCK_X, y: SURFACE_Y, vx: 0, vy: 0, o2: this.st.o2, hp: 100, invuln: 2 });
    this.cam.x = this.me.x; this.cam.y = this.me.y;
    this.ui.toast(`💫 You blacked out! The rescue boat brought you home.${lost ? ` ${lost} item(s) lost.` : ''}`, 4500);
    this.saveNow();
  }

  markSeen(key) {
    const j = this.profile.journal;
    if (!j[key]) { j[key] = { n: 0 }; this.ui.toast(`📖 New discovery: ${itemDef(key).name}`); }
  }

  addCargo(key) {
    const def = itemDef(key);
    if (this.cargoKg() + def.kg > this.st.cap) { this.popup(`Bag full! ${def.name} lost`, '#ff8080'); return false; }
    this.profile.cargo.push(key);
    this.markSeen(key);
    this.profile.journal[key].n++;
    this.popup(`+ ${def.name}`, def.legendary ? '#ffe066' : '#ffffff');
    if (def.legendary) this.ui.toast(`🌟 LEGENDARY! You found the ${def.name}!`, 5000);
    return true;
  }

  // ------------------------------------------------------------------ grab / collect
  findGrabTarget() {
    const me = this.me;
    let best = null, bd = 1e9;
    for (const it of this.world.items) {
      if (it.taken || Math.abs(it.x - me.x) > 30) continue;
      const d = Math.hypot(it.x - me.x, it.y - 6 - me.y);
      if (d < 22 && d < bd) { bd = d; best = { type: 'item', ref: it, key: it.key }; }
    }
    for (const c of this.creatures.values()) {
      const def = CREATURES[c.key];
      if (!def.catch) continue;
      const d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < def.size * 0.5 + 14 && d < bd) { bd = d; best = { type: 'creature', ref: c, key: c.key }; }
    }
    return best;
  }

  tryGrab(t) {
    const def = itemDef(t.key);
    if (this.cargoKg() + def.kg > this.st.cap) { this.popup('Bag full! Return to the dock to sell.', '#ff8080'); return; }
    this.burst(t.ref.x, t.ref.y - (t.type === 'item' ? 5 : 0), '#bff6ff', 6);
    if (t.type === 'item') {
      if (this.isAuth) { if (this.authTakeItem(t.ref.id, this.myId)) this.addCargo(t.key); }
      else { t.ref.taken = true; this.net.send({ t: 'take', id: t.ref.id }); }
    } else {
      if (this.isAuth) { if (this.authCatch(t.ref.id, this.myId)) this.addCargo(t.key); }
      else { this.creatures.delete(t.ref.id); this.net.send({ t: 'catch', cid: t.ref.id }); }
    }
  }

  authTakeItem(id, by) {
    const it = this.world.items[id];
    if (!it || it.taken) return false;
    it.taken = true;
    it.respawnAt = this.time + (it.treasure ? 240 : 90);
    if (this.net) this.net.send({ t: 'gone', id });
    return true;
  }

  authCatch(cid, by) {
    const c = this.creatures.get(cid);
    if (!c || !CREATURES[c.key].catch) return false;
    this.creatures.delete(cid);
    if (this.net) this.net.send({ t: 'cgone', id: cid });
    return true;
  }

  // ------------------------------------------------------------------ combat
  fire() {
    const me = this.me, inp = this.input, h = this.st.harpoon;
    let dx = me.face, dy = 0;
    if (!inp.usingTouch && performance.now() - inp.mouse.lastMove < 4000) {
      const p = this.screenToWorld(inp.mouse.x, inp.mouse.y);
      dx = p.x - me.x; dy = p.y - me.y;
    } else {
      // auto-aim at the nearest hostile for touch / keyboard players
      let best = null, bd = 150;
      for (const c of this.creatures.values()) {
        if (!CREATURES[c.key].hostile) continue;
        const d = Math.hypot(c.x - me.x, c.y - me.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { dx = best.x - me.x; dy = best.y - me.y; }
      else { const a = inp.axis(); if (a.x || a.y) { dx = a.x; dy = a.y; } }
    }
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (Math.abs(dx) > 0.2) me.face = Math.sign(dx);
    me.reload = h.reload;
    const shot = { x: me.x + dx * 8, y: me.y + dy * 8, vx: dx * 300, vy: dy * 300, life: 0.6, mine: true, dmg: h.dmg };
    this.shots.push(shot);
    if (this.net) this.net.send({ t: 'shot', x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy });
  }

  updateShots(dt) {
    for (const s of this.shots) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.y > this.world.floorAt(s.x) || s.y < 0) { s.life = 0; this.burst(s.x, s.y, '#d8c8a0', 3); continue; }
      if (!s.mine) continue;
      for (const c of this.creatures.values()) {
        const def = CREATURES[c.key];
        if (!def.hostile) continue;
        if (Math.hypot(c.x - s.x, c.y - s.y) < def.size * 0.42 + 3) {
          s.life = 0;
          this.burst(s.x, s.y, '#ff6060', 5);
          if (this.isAuth) this.authHit(c.id, s.dmg, this.myId);
          else { c.hurt = 0.25; this.net.send({ t: 'hit', cid: c.id, dmg: s.dmg }); }
          break;
        }
      }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  authHit(cid, dmg, by) {
    const c = this.creatures.get(cid);
    if (!c) return;
    c.hp -= dmg; c.hurt = 0.25; c.retreat = 1.2;
    if (c.hp <= 0) {
      this.creatures.delete(cid);
      this.burst(c.x, c.y, '#ff9090', 14);
      if (this.net) this.net.send({ t: 'cgone', id: cid, burst: 1 });
      const def = CREATURES[c.key];
      if (def.drop) {
        if (by === this.myId) this.addCargo(def.drop);
        else this.net.send({ t: 'got', key: def.drop }, by);
      }
    }
  }

  creatureContact() {
    const me = this.me;
    if (me.invuln > 0 || me.y < SURFACE_Y + 5) return;
    for (const c of this.creatures.values()) {
      const def = CREATURES[c.key];
      if (!def.hostile) continue;
      const d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < def.size * 0.4 + PLAYER_R) {
        me.hp -= def.dmg; me.invuln = 1;
        const nx = (me.x - c.x) / (d || 1), ny = (me.y - c.y) / (d || 1);
        me.vx += nx * 120; me.vy += ny * 120;
        this.shake = 0.3;
        this.popup(`-${def.dmg}`, '#ff5050');
        this.burst(me.x, me.y, '#ff5050', 6);
        if (this.isAuth) c.retreat = 1.4;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ creatures (authoritative)
  allPlayers() {
    const list = [{ id: this.myId, x: this.me.x, y: this.me.y }];
    for (const [id, o] of this.others) list.push({ id, x: o.tx, y: o.ty });
    return list;
  }

  simulateCreatures(dt) {
    const players = this.allPlayers();
    const W = this.world;
    for (const c of this.creatures.values()) {
      const def = CREATURES[c.key];
      c.t += dt; c.hurt -= dt; c.retreat -= dt;
      let near = null, nd = 1e9;
      for (const p of players) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < nd) { nd = d; near = p; } }
      let tvx, tvy;
      c.ang += (Math.random() - 0.5) * dt * 2;
      const wander = (m) => { tvx = Math.cos(c.ang) * def.speed * m; tvy = Math.sin(c.ang) * def.speed * m * 0.4; };
      const away = (m) => { const d = nd || 1; tvx = ((c.x - near.x) / d) * def.speed * m; tvy = ((c.y - near.y) / d) * def.speed * m; };
      switch (def.behavior) {
        case 'flee': if (near && nd < 85) away(1); else wander(0.4); break;
        case 'drift': tvx = Math.cos(c.ang) * def.speed * 0.5; tvy = Math.sin(c.t * 1.6) * 14; break;
        case 'hostile':
          if (c.retreat > 0 && near) away(0.8);
          else if (near && nd < def.aggro && near.y > SURFACE_Y + 12) { tvx = ((near.x - c.x) / nd) * def.speed; tvy = ((near.y - c.y) / nd) * def.speed; }
          else wander(0.45);
          break;
        default: wander(0.55);
      }
      const fy = W.floorAt(c.x);
      if (c.y < def.min) tvy += 18;
      if (c.y > def.max) tvy -= 18;
      if (c.y < 16) tvy = Math.abs(tvy) + 10;
      if (c.y > fy - 18) tvy -= 30;
      const k = Math.min(1, dt * 2.5);
      c.vx += (tvx - c.vx) * k; c.vy += (tvy - c.vy) * k;
      c.x = clamp(c.x + c.vx * dt, 40, WORLD.W - 10);
      c.y += c.vy * dt;
      const col = W.collide(c.x, c.y, Math.max(3, def.size * 0.28));
      if (col.hit) c.ang += Math.PI * 0.7;
      c.x = col.x; c.y = Math.max(12, col.y);
      if (Math.abs(c.vx) > 3) c.face = Math.sign(c.vx);
    }

    // spawn & despawn around players
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.35;
      for (const p of players) {
        if (p.y < 25) continue;
        let count = 0;
        for (const c of this.creatures.values()) if (Math.abs(c.x - p.x) < 480 && Math.abs(c.y - p.y) < 480) count++;
        if (count < 15) this.spawnNear(p);
      }
      for (const c of [...this.creatures.values()]) {
        let far = true;
        for (const p of players) if (Math.abs(c.x - p.x) < 900 && Math.abs(c.y - p.y) < 900) { far = false; break; }
        if (far) this.creatures.delete(c.id);
      }
    }

    // seabed item regrowth
    this.respawnT -= dt;
    if (this.respawnT <= 0) {
      this.respawnT = 1;
      for (const it of this.world.items) {
        if (it.taken && it.respawnAt && this.time > it.respawnAt) {
          it.taken = false;
          if (this.net) this.net.send({ t: 'back', id: it.id });
        }
      }
    }
  }

  spawnNear(p) {
    const a = Math.random() * Math.PI * 2, d = 280 + Math.random() * 180;
    const x = p.x + Math.cos(a) * d;
    if (x < 120 || x > WORLD.W - 20) return;
    const fy = this.world.floorAt(x);
    const y = clamp(p.y + Math.sin(a) * d, 20, fy - 14);
    if (fy - 14 < 20) return;
    const keys = Object.keys(CREATURES).filter((k) => y >= CREATURES[k].min && y <= CREATURES[k].max);
    const key = pickWeighted(Math.random, keys, (k) => CREATURES[k].w);
    if (!key) return;
    const def = CREATURES[key];
    const n = !def.hostile && !def.rare && def.kind === 'fish' && Math.random() < 0.6 ? 2 + Math.floor(Math.random() * 3) : 1;
    const ang = Math.random() < 0.5 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const id = this.nextCid++;
      this.creatures.set(id, { id, key, x: x + i * 12, y: y + (i % 2) * 8, vx: 0, vy: 0, face: 1, hp: def.hp || 1, t: Math.random() * 3, hurt: 0, retreat: 0, ang });
    }
  }

  interpolateCreatures(dt) {
    const k = Math.min(1, dt * 8);
    for (const c of this.creatures.values()) {
      c.x = lerp(c.x, c.tx, k); c.y = lerp(c.y, c.ty, k); c.t += dt; c.hurt -= dt;
    }
  }

  // ------------------------------------------------------------------ networking
  bindNet() {
    const net = this.net;
    net.onMessage = (m, from) => this.onNet(m, from);
    if (net.isHost) {
      net.onJoin = (id) => {
        net.send({ t: 'welcome', seed: this.world.seed, id, host: this.profile.name, taken: this.world.items.filter((i) => i.taken).map((i) => i.id) }, id);
      };
      net.onLeave = (id) => { const o = this.others.get(id); this.others.delete(id); this.ui.toast(`👋 ${o ? o.name : 'A diver'} left the room`); };
    } else {
      net.onDisconnect = () => { if (this.running) this.ui.exitToTitle('Lost connection to the host.'); };
    }
  }

  onNet(m, from) {
    const host = this.net.isHost;
    switch (m.t) {
      case 'me': {
        if (!host) break;
        let o = this.others.get(from);
        if (!o) { o = { x: m.x, y: m.y, anim: 0 }; this.others.set(from, o); this.ui.toast(`🤿 ${m.n} joined the dive!`); }
        Object.assign(o, { tx: m.x, ty: m.y, face: m.f, name: m.n, color: m.c, lamp: m.l });
        break;
      }
      case 'pl': {
        const seen = new Set();
        for (const [id, name, color, x, y, face, lamp] of m.l) {
          if (id === this.myId) continue;
          seen.add(id);
          let o = this.others.get(id);
          if (!o) { o = { x, y, anim: 0 }; this.others.set(id, o); }
          Object.assign(o, { tx: x, ty: y, face, name, color, lamp });
        }
        for (const id of [...this.others.keys()]) if (!seen.has(id)) this.others.delete(id);
        break;
      }
      case 'cre': {
        const seen = new Set();
        for (const [id, key, x, y, face, hurt] of m.l) {
          seen.add(id);
          let c = this.creatures.get(id);
          if (!c) { c = { id, key, x, y, t: Math.random() * 3, hurt: 0 }; this.creatures.set(id, c); }
          c.tx = x; c.ty = y; c.face = face; if (hurt) c.hurt = 0.2;
        }
        for (const id of [...this.creatures.keys()]) if (!seen.has(id)) this.creatures.delete(id);
        break;
      }
      case 'take':
        if (host) {
          if (this.authTakeItem(m.id, from)) this.net.send({ t: 'got', key: this.world.items[m.id].key }, from);
          else this.net.send({ t: 'miss' }, from);
        }
        break;
      case 'catch':
        if (host) {
          const c = this.creatures.get(m.cid);
          if (c && this.authCatch(m.cid, from)) this.net.send({ t: 'got', key: c.key }, from);
          else this.net.send({ t: 'miss' }, from);
        }
        break;
      case 'hit': if (host) this.authHit(m.cid, m.dmg, from); break;
      case 'shot':
        this.shots.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, life: 0.6, mine: false });
        if (host) this.net.send(m, null, from);
        break;
      case 'gone': { const it = this.world.items[m.id]; if (it) it.taken = true; break; }
      case 'back': { const it = this.world.items[m.id]; if (it) it.taken = false; break; }
      case 'cgone': { const c = this.creatures.get(m.id); if (c && m.burst) this.burst(c.x, c.y, '#ff9090', 14); this.creatures.delete(m.id); break; }
      case 'got': this.addCargo(m.key); break;
      case 'miss': this.popup('Someone grabbed it first!', '#ffd080'); break;
    }
  }

  netTick(dt) {
    this.netT -= dt;
    if (this.netT > 0) return;
    this.netT = 0.08;
    const me = this.me, p = this.profile;
    if (this.net.isHost) {
      const pl = [[this.myId, p.name, p.color, Math.round(me.x), Math.round(me.y), me.face, this.st.lamp]];
      for (const [id, o] of this.others) pl.push([id, o.name, o.color, Math.round(o.tx), Math.round(o.ty), o.face, o.lamp]);
      this.net.send({ t: 'pl', l: pl });
      const cl = [];
      for (const c of this.creatures.values()) cl.push([c.id, c.key, Math.round(c.x), Math.round(c.y), c.face, c.hurt > 0 ? 1 : 0]);
      this.net.send({ t: 'cre', l: cl });
    } else {
      this.net.send({ t: 'me', x: Math.round(me.x), y: Math.round(me.y), f: me.face, n: p.name, c: p.color, l: this.st.lamp });
    }
  }

  // ------------------------------------------------------------------ effects
  addBubble(x, y) { this.fx.push({ type: 'bubble', x, y, vy: -20 - Math.random() * 15, life: 3, r: Math.random() < 0.3 ? 2 : 1 }); }
  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 50;
      this.fx.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, color });
    }
  }
  popup(text, color = '#fff') { this.popups.push({ text, color, x: this.me.x, y: this.me.y - 14, life: 1.6 }); }
  updateFx(dt) {
    for (const f of this.fx) {
      f.life -= dt;
      if (f.type === 'bubble') { f.y += f.vy * dt; f.x += Math.sin(f.life * 6) * 0.3; if (f.y < 2) f.life = 0; }
      else { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; }
    }
    this.fx = this.fx.filter((f) => f.life > 0);
    for (const p of this.popups) { p.life -= dt; p.y -= 12 * dt; }
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  screenToWorld(cx, cy) {
    const sx = (cx / window.innerWidth) * this.vw, sy = (cy / window.innerHeight) * this.vh;
    return { x: sx + this.camX, y: sy + this.camY };
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const ctx = this.ctx, vw = this.vw, vh = this.vh;
    const sh = this.shake > 0 ? (Math.random() - 0.5) * 4 : 0;
    const camX = (this.camX = Math.round(this.cam.x - vw / 2 + sh));
    const camY = (this.camY = Math.round(this.cam.y - vh / 2));
    const surf = -camY; // screen y of the water surface
    const t = this.time;

    // sky + water background
    for (let sy = 0; sy < vh; sy += 2) {
      const wy = camY + sy;
      ctx.fillStyle = wy < 0 ? mixHex('#d9f3ff', '#5fb8f0', clamp(-wy / 140, 0, 1)) : lut(WATER_LUT, wy);
      ctx.fillRect(0, sy, vw, 2);
    }
    if (surf > 0) {
      ctx.fillStyle = '#fff6c0';
      ctx.fillRect(vw - 60 - (camX * 0.05) % 20, surf - 70, 12, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 4; i++) { const cx = ((i * 157 - camX * 0.15 + t * 3) % (vw + 80) + vw + 80) % (vw + 80) - 40; ctx.fillRect(cx, surf - 50 - i * 9, 26, 4); ctx.fillRect(cx + 5, surf - 54 - i * 9, 14, 4); }
    }

    // distant seabed ridges (parallax 2.5D layers)
    this.drawFarLayer(0.45, 2300, FAR2_LUT, surf);
    this.drawFarLayer(0.7, 900, FAR1_LUT, surf);

    // god rays near the surface
    if (camY < 700) {
      ctx.globalCompositeOperation = 'lighter';
      const a = 0.07 * (1 - clamp(camY / 700, 0, 1));
      ctx.fillStyle = `rgba(190,240,255,${a})`;
      for (let i = 0; i < 6; i++) {
        const x0 = ((i * 211 - camX * 0.3 + Math.sin(t * 0.3 + i) * 20) % (vw + 200) + vw + 200) % (vw + 200) - 100;
        ctx.beginPath(); ctx.moveTo(x0, surf); ctx.lineTo(x0 + 18, surf); ctx.lineTo(x0 + 120, surf + 420); ctx.lineTo(x0 + 70, surf + 420); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // marine snow
    for (const p of this.snow) {
      const sx = (((p.x - camX * p.z) % vw) + vw) % vw;
      const sy = (((p.y - camY * p.z - t * 5 * p.z) % vh) + vh) % vh;
      if (sy < surf) continue;
      ctx.fillStyle = `rgba(220,240,255,${0.15 + 0.3 * p.z})`;
      ctx.fillRect(sx | 0, sy | 0, 1, 1);
    }

    this.drawLand(camX, camY);

    // seabed
    for (let sx = 0; sx < vw; sx += 2) {
      const wx = camX + sx;
      if (wx < 0) continue;
      const fy = this.world.floorAt(wx);
      const sy = Math.round(fy - camY);
      if (sy >= vh) continue;
      ctx.fillStyle = lut(FLOOR_LUT, fy);
      ctx.fillRect(sx, sy, 2, vh - sy);
      ctx.fillStyle = lut(FLOOR_TOP_LUT, fy);
      ctx.fillRect(sx, sy, 2, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let r = 6; r < Math.min(60, vh - sy); r += 5) if (hash2(wx >> 1, (fy + r) >> 2) > 0.8) ctx.fillRect(sx, sy + r, 2, 2);
    }

    // rocks
    for (const r of this.world.rocksIn(camX - 40, camX + vw + 40)) {
      if (r.y + r.r < camY || r.y - r.r > camY + vh) continue;
      ctx.drawImage(rockSprite(r.r, r.tint), Math.round(r.x - r.r - 1 - camX), Math.round(r.y - r.r - 1 - camY));
    }

    // seabed items
    const glows = [];
    for (const it of this.world.items) {
      if (it.taken || it.x < camX - 20 || it.x > camX + vw + 20 || it.y < camY - 50 || it.y > camY + vh + 10) continue;
      const spr = itemSprite(it.key, Math.floor(t * 1.5 + it.id) % 2);
      ctx.drawImage(spr, Math.round(it.x - spr.width / 2 - camX), Math.round(it.y - spr.height + 2 - camY));
      const def = itemDef(it.key);
      if (def.glow) glows.push([it.x, it.y - 5, def.glow, 26]);
      if (def.legendary || it.treasure) glows.push([it.x, it.y - 4, '#fff2a0', it.treasure && !def.legendary ? 12 : 30]);
    }
    if (this.grabTarget) {
      const g = this.grabTarget.ref, gy = this.grabTarget.type === 'item' ? g.y - 14 : g.y - 12;
      ctx.fillStyle = '#ffffff';
      const bob = Math.round(Math.sin(t * 6));
      ctx.fillRect(Math.round(g.x - camX) - 1, Math.round(gy - camY) + bob - 3, 3, 1);
      ctx.fillRect(Math.round(g.x - camX), Math.round(gy - camY) + bob - 2, 1, 2);
    }

    // creatures
    for (const c of this.creatures.values()) {
      if (c.x < camX - 70 || c.x > camX + vw + 70 || c.y < camY - 50 || c.y > camY + vh + 50) continue;
      const def = CREATURES[c.key];
      if (c.hurt > 0 && Math.floor(t * 30) % 2) continue;
      const spr = creatureSprite(c.key, Math.floor(c.t * 4) % 2);
      this.blit(spr, c.x - camX, c.y - camY, c.face < 0);
      if (def.glow) glows.push([c.x + (def.kind === 'angler' ? c.face * def.size * 0.4 : 0), c.y - (def.kind === 'angler' ? 6 : 0), def.glow, def.kind === 'angler' ? 34 : 22]);
    }

    // other divers
    ctx.font = '7px monospace'; ctx.textAlign = 'center';
    for (const o of this.others.values()) {
      if (o.tx === undefined) continue;
      this.blit(diverSprite(o.color || '#ffcc33', Math.floor(o.anim) % 2), o.x - camX, o.y - camY, o.face < 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(o.name || '', Math.round(o.x - camX), Math.round(o.y - camY - 9));
    }
    // me
    const me = this.me;
    if (!(me.invuln > 0 && Math.floor(t * 20) % 2)) this.blit(diverSprite(this.profile.color, Math.floor(me.anim) % 2), me.x - camX, me.y - camY, me.face < 0);

    // shots
    ctx.fillStyle = '#eaf6ff';
    for (const s of this.shots) {
      const n = Math.hypot(s.vx, s.vy);
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(s.x - camX - (s.vx / n) * i), Math.round(s.y - camY - (s.vy / n) * i), 1, 1);
    }
    // fx
    for (const f of this.fx) {
      if (f.type === 'bubble') { ctx.fillStyle = 'rgba(210,245,255,0.7)'; ctx.fillRect(Math.round(f.x - camX), Math.round(f.y - camY), f.r, f.r); }
      else { ctx.fillStyle = f.color; ctx.fillRect(Math.round(f.x - camX), Math.round(f.y - camY), 1, 1); }
    }

    // water surface line
    if (surf >= -2 && surf < vh) {
      for (let sx = 0; sx < vw; sx += 2) {
        if (camX + sx < -10) continue;
        const wy = surf + Math.round(Math.sin((camX + sx) * 0.06 + t * 2));
        ctx.fillStyle = 'rgba(220,250,255,0.9)'; ctx.fillRect(sx, wy, 2, 1);
        ctx.fillStyle = 'rgba(160,230,255,0.35)'; ctx.fillRect(sx, wy + 1, 2, 2);
      }
    }
    this.drawSurfaceProps(camX, camY);

    // darkness + lights
    const dark = smooth(120, 2700, this.cam.y) * 0.95;
    if (dark > 0.02) {
      const m = this.mctx;
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, vw, vh);
      m.fillStyle = `rgba(1,3,10,${dark})`;
      m.fillRect(0, 0, vw, vh);
      m.globalCompositeOperation = 'destination-out';
      const hole = (x, y, r, a = 1) => {
        const g = m.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.55, `rgba(0,0,0,${a * 0.7})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = g; m.fillRect(x - r, y - r, r * 2, r * 2);
      };
      hole(me.x - camX + me.face * this.st.lamp * 0.3, me.y - camY, this.st.lamp);
      hole(me.x - camX, me.y - camY, 24);
      for (const o of this.others.values()) if (o.tx !== undefined) hole(o.x - camX + (o.face || 1) * (o.lamp || 60) * 0.3, o.y - camY, o.lamp || 60);
      for (const [x, y, , r] of glows) hole(x - camX, y - camY, r, 0.8);
      ctx.drawImage(this.mask, 0, 0);
    }
    // glow halos on top of the darkness
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, col, r] of glows) {
      const g = ctx.createRadialGradient(x - camX, y - camY, 0, x - camX, y - camY, r * 0.45);
      g.addColorStop(0, col + '88'); g.addColorStop(1, col + '00');
      ctx.fillStyle = g; ctx.fillRect(x - camX - r, y - camY - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // pressure / low oxygen vignette
    const danger = me.y > this.st.depth ? 0.35 : me.o2 <= 0 ? 0.3 : 0;
    if (danger) {
      const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
      g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${danger * (0.6 + 0.4 * Math.sin(t * 6))})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    }

    // floating text
    ctx.font = 'bold 8px monospace';
    for (const p of this.popups) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = '#000'; ctx.fillText(p.text, Math.round(p.x - camX) + 1, Math.round(p.y - camY) + 1);
      ctx.fillStyle = p.color; ctx.fillText(p.text, Math.round(p.x - camX), Math.round(p.y - camY));
    }
    ctx.globalAlpha = 1;
  }

  blit(spr, x, y, flip) {
    const ctx = this.ctx;
    const dx = Math.round(x - spr.width / 2), dy = Math.round(y - spr.height / 2);
    if (!flip) { ctx.drawImage(spr, dx, dy); return; }
    ctx.save(); ctx.translate(dx + spr.width, dy); ctx.scale(-1, 1); ctx.drawImage(spr, 0, 0); ctx.restore();
  }

  drawFarLayer(scale, offset, T, surf) {
    const ctx = this.ctx, vw = this.vw, vh = this.vh;
    for (let sx = 0; sx < vw; sx += 2) {
      let wx = this.cam.x + (sx - vw / 2) / scale + offset;
      wx = WORLD.W - Math.abs((((wx % (2 * WORLD.W)) + 2 * WORLD.W) % (2 * WORLD.W)) - WORLD.W); // ping-pong wrap, no seams
      const fy = this.world.floorAt(wx) * 0.92;
      let sy = Math.round((fy - this.cam.y) * scale + vh / 2 - 30 * (1 - scale));
      if (sy >= vh) continue;
      const top = Math.max(sy, surf + 1);
      if (top >= vh) continue;
      ctx.fillStyle = lut(T, this.cam.y + (top - vh / 2) / scale);
      ctx.fillRect(sx, top, 2, vh - top);
    }
  }

  drawLand(camX, camY) {
    if (camX > 0) return;
    const ctx = this.ctx, vh = this.vh;
    for (let sx = 0; sx < -camX && sx < this.vw; sx += 2) {
      const wx = camX + sx;
      const top = -8 - Math.min(12, Math.max(0, -wx - 90) * 0.15) + (wx < -90 ? Math.round(Math.sin(wx * 0.05)) : 0);
      const sy = top - camY;
      ctx.fillStyle = '#e8d49a'; ctx.fillRect(sx, sy, 2, vh);
      ctx.fillStyle = '#f6e7b8'; ctx.fillRect(sx, sy, 2, 2);
      ctx.fillStyle = '#b89f68'; ctx.fillRect(sx, Math.max(sy, -camY + 1), 2, vh);
    }
  }

  drawSurfaceProps(camX, camY) {
    const ctx = this.ctx, t = this.time;
    const X = (x) => Math.round(x - camX), Y = (y) => Math.round(y - camY);
    if (camY > 120) return;
    // palm tree
    ctx.fillStyle = '#8a5a2b';
    for (let i = 0; i < 26; i++) ctx.fillRect(X(-150 + Math.sin(i * 0.12) * 4), Y(-16 - i), 3, 1);
    ctx.fillStyle = '#3f9a3a';
    for (let a = 0; a < 5; a++) for (let i = 0; i < 14; i++) ctx.fillRect(X(-149 + Math.cos(a * 1.25 - 0.3) * i), Y(-41 + Math.sin(a * 1.25 - 0.3) * i * 0.5 + i * i * 0.03), 2, 2);
    // shop hut
    ctx.fillStyle = '#a0683a'; ctx.fillRect(X(-70), Y(-34), 56, 26);
    ctx.fillStyle = '#7a4a24'; for (let i = 0; i < 6; i++) ctx.fillRect(X(-70), Y(-34 + i * 5), 56, 1);
    ctx.fillStyle = '#d24a3a';
    for (let i = 0; i < 12; i++) ctx.fillRect(X(-76 + i * 2.5), Y(-36 - i), 68 - i * 5, 1);
    ctx.fillStyle = '#3a2412'; ctx.fillRect(X(-49), Y(-24), 12, 16);
    ctx.fillStyle = '#ffe9a0'; ctx.fillRect(X(-66), Y(-28), 12, 8); ctx.fillRect(X(-31), Y(-28), 12, 8);
    ctx.fillStyle = '#20304a'; ctx.fillRect(X(-60), Y(-56), 34, 10);
    ctx.fillStyle = '#ffd23a'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText('SHOP', X(-43), Y(-48));
    // dock
    ctx.fillStyle = '#7a5230';
    for (let x = -30; x < WORLD.DOCK_X + 40; x += 30) ctx.fillRect(X(x), Y(-6), 2, Math.max(0, this.world.floorAt(Math.max(0, x)) + 6));
    ctx.fillStyle = '#a8763f'; ctx.fillRect(X(-40), Y(-8), WORLD.DOCK_X + 80, 3);
    // boat at the dock
    this.drawBoat(WORLD.DOCK_X + 70, t);
    // buoys
    for (const b of BUOYS) {
      if (b.id === 'dock') continue;
      const on = this.profile.buoys.includes(b.id);
      const bob = Math.round(Math.sin(t * 2 + b.x) * 1.5);
      ctx.fillStyle = on ? '#e33' : '#888'; ctx.fillRect(X(b.x - 4), Y(-4 + bob), 9, 6);
      ctx.fillStyle = '#fff'; ctx.fillRect(X(b.x - 4), Y(-2 + bob), 9, 2);
      ctx.fillStyle = '#333'; ctx.fillRect(X(b.x), Y(-18 + bob), 1, 14);
      ctx.fillStyle = on ? '#ffd23a' : '#aaa'; ctx.fillRect(X(b.x + 1), Y(-18 + bob), 6, 4);
      if (on) this.drawBoat(b.x + 30, t + b.x);
    }
  }

  drawBoat(x, t) {
    const ctx = this.ctx, camX = this.camX, camY = this.camY;
    const bob = Math.round(Math.sin(t * 1.8) * 1.2);
    const X = Math.round(x - camX), Y = Math.round(-2 - camY) + bob;
    ctx.fillStyle = '#f2f2f2'; for (let i = 0; i < 6; i++) ctx.fillRect(X - 22 + i, Y + i, 44 - i * 2, 1);
    ctx.fillStyle = '#2a6fd0'; ctx.fillRect(X - 21, Y + 2, 42, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(X - 6, Y - 9, 14, 9);
    ctx.fillStyle = '#7fd7ff'; ctx.fillRect(X - 4, Y - 7, 4, 3); ctx.fillRect(X + 2, Y - 7, 4, 3);
    ctx.fillStyle = '#d24a3a'; ctx.fillRect(X - 7, Y - 11, 16, 2);
  }

  buildMinimapBase() {
    const c = document.createElement('canvas');
    c.width = this.minimap.width; c.height = this.minimap.height;
    const m = c.getContext('2d');
    const sx = c.width / WORLD.W, sy = c.height / WORLD.D;
    const g = m.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#2d8fbf'); g.addColorStop(0.3, '#0e3d70'); g.addColorStop(1, '#02060f');
    m.fillStyle = g; m.fillRect(0, 0, c.width, c.height);
    m.fillStyle = '#6b5a40';
    for (let x = 0; x < c.width; x++) { const fy = this.world.floorAt(x / sx) * sy; m.fillRect(x, fy, 1, c.height - fy); }
    this.minimapBase = c;
  }

  drawMinimap() {
    const m = this.minimap.getContext('2d');
    const sx = this.minimap.width / WORLD.W, sy = this.minimap.height / WORLD.D;
    m.drawImage(this.minimapBase, 0, 0);
    for (const b of BUOYS) { m.fillStyle = this.profile.buoys.includes(b.id) ? '#ffd23a' : '#777'; m.fillRect(b.x * sx - 1, 0, 3, 3); }
    m.fillStyle = 'rgba(255,60,60,0.6)';
    m.fillRect(0, this.st.depth * sy, this.minimap.width, 1);
    for (const o of this.others.values()) if (o.tx !== undefined) { m.fillStyle = o.color || '#fff'; m.fillRect(o.x * sx - 1, o.y * sy - 1, 3, 3); }
    m.fillStyle = '#ffffff'; m.fillRect(this.me.x * sx - 2, this.me.y * sy - 2, 4, 4);
    m.fillStyle = this.profile.color; m.fillRect(this.me.x * sx - 1, this.me.y * sy - 1, 2, 2);
  }

  hudInfo() {
    const me = this.me;
    return {
      o2: me.o2 / this.st.o2, hp: me.hp / 100,
      depthM: Math.round(Math.max(0, me.y - SURFACE_Y) * METRES_PER_PX),
      safeM: Math.round(this.st.depth * METRES_PER_PX),
      zone: me.y <= SURFACE_Y + 6 ? 'Surface' : zoneAt(me.y).name,
      kg: this.cargoKg(), cap: this.st.cap, coins: this.profile.coins, warn: this.warn,
      heavy: this.heavy, nearStop: this.nearStop, grab: this.grabTarget,
    };
  }
}
