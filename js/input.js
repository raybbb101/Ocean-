// Unified input: keyboard + mouse on PC, virtual joystick + buttons on touch screens.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.mouse = { x: 0, y: 0, down: false, lastMove: 0 };
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.touchHeld = { shoot: false };
    this.enabled = true;
    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.lastTouch = 0;

    const keyAction = { KeyE: 'grab', Space: 'grab', KeyB: 'action', KeyQ: 'action', Escape: 'menu', KeyP: 'menu' };
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code) && keyAction[e.code]) this.edges.add(keyAction[e.code]);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.lastMove = performance.now(); });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouse.down = true; this.mouse.lastMove = performance.now(); } });
    window.addEventListener('mouseup', () => (this.mouse.down = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setupTouch();
  }

  setupTouch() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    const R = 46;
    const place = (x, y) => { base.style.left = `${x}px`; base.style.top = `${y}px`; };
    zone.addEventListener('pointerdown', (e) => {
      this.lastTouch = performance.now();
      this.joy.id = e.pointerId; this.joy.ox = e.clientX; this.joy.oy = e.clientY;
      const r = zone.getBoundingClientRect();
      place(e.clientX - r.left, e.clientY - r.top);
      base.classList.add('active');
      try { zone.setPointerCapture(e.pointerId); } catch {}
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R; this.joy.y = dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null; this.joy.x = 0; this.joy.y = 0;
      knob.style.transform = '';
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const bind = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.lastTouch = performance.now(); el.classList.add('down'); onDown(); });
      const up = () => { el.classList.remove('down'); onUp && onUp(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up);
    };
    bind('btnGrab', () => this.edges.add('grab'));
    bind('btnAction', () => this.edges.add('action'));
    bind('btnShoot', () => (this.touchHeld.shoot = true), () => (this.touchHeld.shoot = false));
  }

  get usingTouch() { return this.isTouch && performance.now() - this.mouse.lastMove > 2000; }

  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (x || y) { const d = Math.hypot(x, y); return { x: x / d, y: y / d }; }
    const m = Math.hypot(this.joy.x, this.joy.y);
    if (m > 0.15) return { x: this.joy.x, y: this.joy.y };
    return { x: 0, y: 0 };
  }

  shooting() {
    if (!this.enabled) return false;
    return this.keys.has('KeyF') || this.keys.has('KeyJ') || this.mouse.down || this.touchHeld.shoot;
  }

  // True once per press.
  take(action) {
    if (!this.enabled && action !== 'menu') { this.edges.delete(action); return false; }
    const had = this.edges.has(action);
    this.edges.delete(action);
    return had;
  }

  clear() { this.edges.clear(); this.mouse.down = false; this.touchHeld.shoot = false; }
}
