// Core game: simulation, rendering and co-op synchronisation.
import { WORLD, CREATURES, UPGRADES, BUOYS, METRES_PER_PX, zoneAt, itemDef } from './data.js';
import { World } from './world.js';
import { Renderer3D } from './render3d.js';
import { clamp, lerp, pickWeighted } from './util.js';

const PLAYER_R = 6;
const SURFACE_Y = 4;
export class Game {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.input = input;
    this.ui = ui;
    this.r3d = new Renderer3D(canvas, document.getElementById('overlay'));
    this.minimap = document.getElementById('minimap');
    this.running = false;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.loop = this.loop.bind(this);
  }

  resize() {
    this.r3d.resize();
    this.vw = this.r3d.viewW; this.vh = this.r3d.viewH;
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
    this.r3d.build(this.world, this.profile);
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
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.update(dt);
    this.r3d.render(this, dt);
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

  screenToWorld(cx, cy) { return this.r3d.screenToWorld(cx, cy); }

  // ------------------------------------------------------------------ minimap
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
