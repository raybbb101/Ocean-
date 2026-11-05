// Boot + DOM user interface (title, shop, pause, save codes).
import { Game } from './game.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Save } from './save.js';
import { UPGRADES, MAX_LEVEL, BUOYS, CREATURES, PLANTS, TREASURES, TROPHIES, SUIT_COLORS, itemDef } from './data.js';

const WORLD_SEED = 20261105; // same ocean every time, so players can learn the map
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

const input = new Input($('game'));
if (input.isTouch) document.body.classList.add('touch');

let game = null;
let net = null;
let chosenColor = null;
let shopMode = 'dock';
let shopTab = 'sell';

// ---------------------------------------------------------------- UI hooks used by the game
const ui = {
  save(profile) { if (!Save.store(profile)) ui.toast('⚠️ Could not save (browser storage full or blocked)'); },

  toast(msg, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 500);
  },

  updateHud(g) {
    const h = g.hudInfo();
    $('o2Bar').style.width = `${Math.min(1, Math.max(0, h.o2)) * 100}%`;
    $('o2Bar').parentElement.classList.toggle('low', h.o2 < 0.25);
    $('hpBar').style.width = `${Math.max(0, h.hp) * 100}%`;
    $('hpBar').parentElement.classList.toggle('low', h.hp < 0.3);
    $('depthTxt').textContent = `${h.depthM} m / ${h.safeM} m safe`;
    $('zoneTxt').textContent = h.zone;
    $('cargoTxt').textContent = `🎒 ${h.kg}/${h.cap} kg`;
    $('cargoTxt').classList.toggle('heavy', h.kg >= h.cap);
    $('coinTxt').textContent = `🪙 ${h.coins}`;
    $('warn').textContent = h.warn;

    const touch = input.usingTouch;
    let prompt = '';
    if (h.nearStop) {
      const dock = h.nearStop.id === 'dock';
      prompt = touch ? '' : `<b>[B]</b> ${dock ? 'Open shop' : 'Board the boat'}`;
      $('btnAction').textContent = dock ? '🏪 SHOP' : '⛵ BOAT';
    } else if (h.grab) {
      const d = itemDef(h.grab.key);
      prompt = `${touch ? '✋' : '<b>[E]</b>'} ${h.grab.type === 'creature' ? 'Catch' : 'Grab'} ${d.name} <span style="opacity:.7">(${d.kg} kg)</span>`;
    }
    $('prompt').innerHTML = prompt;
    show('btnAction', !!h.nearStop);
    g.drawMinimap();
  },

  openShop(mode) {
    shopMode = mode;
    shopTab = mode === 'dock' ? 'sell' : 'boat';
    input.enabled = false;
    input.clear();
    renderShop();
    show('screen-shop');
  },

  exitToTitle(reason) {
    quitGame();
    if (reason) ui.toast(reason, 4000);
  },
};

// ---------------------------------------------------------------- title screen
function renderProfiles() {
  const list = Save.list();
  const box = $('profileList');
  box.innerHTML = '';
  for (const p of list.slice(0, 8)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>`;
    const name = document.createElement('button');
    name.className = 'x';
    name.style.color = 'var(--ink)';
    name.textContent = `${p.name} · 🪙${p.coins}`;
    name.onclick = () => { $('nameInput').value = p.name; pickColor(p.color); };
    const del = document.createElement('button');
    del.className = 'x';
    del.textContent = '✕';
    del.title = 'Delete profile';
    del.onclick = () => { if (confirm(`Delete diver "${p.name}"? This cannot be undone.`)) { Save.remove(p.name); renderProfiles(); } };
    chip.append(name, del);
    box.appendChild(chip);
  }
}

function pickColor(c) {
  chosenColor = c;
  for (const b of $('colorPick').children) b.classList.toggle('on', b.dataset.c === c);
}
for (const c of SUIT_COLORS) {
  const b = document.createElement('button');
  b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', `Suit colour ${c}`);
  b.onclick = () => pickColor(c);
  $('colorPick').appendChild(b);
}

function getProfile() {
  const name = $('nameInput').value.trim();
  if (!name) { $('netStatus').textContent = 'Please enter a diver name first.'; $('nameInput').focus(); return null; }
  const p = Save.loadOrCreate(name);
  if (chosenColor) p.color = chosenColor;
  return p;
}

function startGame(opts) {
  show('screen-title', false);
  show('hud');
  show('touch', input.isTouch);
  input.enabled = true;
  input.clear();
  game = game || new Game($('game'), input, ui);
  game.start(opts);
  ui.save(opts.profile);
  if (opts.mode === 'host') { $('roomTag').textContent = `Room code: ${opts.net.code}`; show('roomTag'); }
  else if (opts.mode === 'guest') { $('roomTag').textContent = `In room ${opts.net.code}`; show('roomTag'); }
  else show('roomTag', false);
  ui.toast(opts.mode === 'guest' ? '🤿 Joined! Dive in with your crew.' : '🌊 Welcome to the Home Dock. Dive in!');
}

function quitGame() {
  if (game) game.stop();
  if (net) { net.close(); net = null; }
  for (const s of ['screen-shop', 'screen-pause', 'hud', 'touch']) show(s, false);
  show('screen-title');
  $('netStatus').textContent = '';
  renderProfiles();
}

$('soloBtn').onclick = () => {
  const profile = getProfile();
  if (profile) startGame({ profile, mode: 'solo', seed: WORLD_SEED });
};

$('hostBtn').onclick = async () => {
  const profile = getProfile();
  if (!profile) return;
  $('netStatus').textContent = 'Creating room…';
  net = new Net();
  try {
    const code = await net.host();
    $('netStatus').textContent = '';
    startGame({ profile, mode: 'host', net, seed: WORLD_SEED });
    ui.toast(`📣 Share code ${code} with friends so they can join`, 6000);
  } catch (e) {
    $('netStatus').textContent = `Could not create room: ${e.message || e}`;
    net = null;
  }
};

$('joinBtn').onclick = async () => {
  const profile = getProfile();
  if (!profile) return;
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 5) { $('netStatus').textContent = 'Enter the 5-letter room code.'; return; }
  $('netStatus').textContent = 'Connecting…';
  net = new Net();
  try {
    net.onMessage = (m) => {
      if (m.t === 'welcome') startGame({ profile, mode: 'guest', net, seed: m.seed, taken: m.taken });
      else if (m.t === 'full') { $('netStatus').textContent = 'That room is full (4 divers max).'; net.close(); net = null; }
    };
    await net.join(code);
    $('netStatus').textContent = 'Connected! Waiting for host…';
  } catch (e) {
    $('netStatus').textContent = e.message || String(e);
    if (net) net.close();
    net = null;
  }
};

// ---------------------------------------------------------------- save codes
function openCode(mode) {
  const area = $('codeArea');
  if (mode === 'export') {
    const p = Save.load($('nameInput').value.trim()) || Save.list()[0];
    if (!p) { $('netStatus').textContent = 'No saved diver to export yet.'; return; }
    $('codeTitle').textContent = `Export: ${p.name}`;
    $('codeHint').textContent = 'Copy this code and paste it into "Import save" on another device or browser.';
    area.value = Save.exportCode(p);
    area.readOnly = true;
    $('codeAction').textContent = 'Copy';
    $('codeAction').onclick = async () => {
      area.select();
      try { await navigator.clipboard.writeText(area.value); } catch { document.execCommand('copy'); }
      $('codeAction').textContent = 'Copied!';
    };
  } else {
    $('codeTitle').textContent = 'Import save';
    $('codeHint').textContent = 'Paste a save code. A diver with the same name on this device will be replaced.';
    area.value = '';
    area.readOnly = false;
    $('codeAction').textContent = 'Import';
    $('codeAction').onclick = () => {
      try {
        const p = Save.importCode(area.value);
        Save.store(p);
        $('nameInput').value = p.name;
        pickColor(p.color);
        renderProfiles();
        show('screen-code', false);
        ui.toast(`✅ Imported ${p.name}`);
      } catch {
        $('codeHint').textContent = '❌ That code is not valid. Make sure you copied all of it.';
      }
    };
  }
  show('screen-code');
}
$('exportBtn').onclick = () => openCode('export');
$('importBtn').onclick = () => openCode('import');
$('codeClose').onclick = () => show('screen-code', false);

// ---------------------------------------------------------------- shop
function groupCargo(cargo) {
  const m = new Map();
  for (const k of cargo) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()];
}

function renderShop() {
  const p = game.profile;
  const here = BUOYS.find((b) => game.nearStop && b.id === game.nearStop.id) || BUOYS[0];
  $('shopTitle').textContent = shopMode === 'dock' ? '🏪 Home Dock Shop' : `⛵ ${here.name}`;
  $('shopCoins').textContent = `🪙 ${p.coins}`;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === shopTab);
  const body = $('shopBody');
  const dockOnly = '<p class="note">🏝️ Trading and upgrades are only available at the Home Dock. Take the boat back to sell!</p>';

  if (shopTab === 'sell') {
    if (shopMode !== 'dock') { body.innerHTML = dockOnly; return; }
    const groups = groupCargo(p.cargo);
    if (!groups.length) { body.innerHTML = '<p class="note">Your bag is empty. Go find something shiny!</p>'; return; }
    let total = 0;
    const rows = groups.map(([k, n]) => {
      const d = itemDef(k); const v = d.value * n; total += v;
      return `<div class="li"><span class="${d.legendary ? 'legend' : ''}">${d.name} × ${n}</span><span class="v">🪙 ${v}</span></div>`;
    }).join('');
    body.innerHTML = `<div class="list">${rows}</div><div class="row"><button id="sellAll" class="big">Sell everything for 🪙 ${total}</button></div>`;
    $('sellAll').onclick = () => {
      p.coins += total; p.totalEarned += total; p.cargo = [];
      ui.save(p);
      ui.toast(`💰 Sold for ${total} coins!`);
      renderShop();
    };
  } else if (shopTab === 'upgrades') {
    if (shopMode !== 'dock') { body.innerHTML = dockOnly; return; }
    body.innerHTML = '<div class="cards"></div>';
    const cards = body.firstChild;
    for (const [key, u] of Object.entries(UPGRADES)) {
      const lvl = p.upgrades[key];
      const maxed = lvl >= MAX_LEVEL;
      const cost = maxed ? 0 : u.cost[lvl];
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h4>${u.name}</h4><div class="pips">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        <div>${u.desc}</div><div class="now">Now: ${u.fmt(u.val(lvl))}${maxed ? '' : `<br>Next: ${u.fmt(u.val(lvl + 1))}`}</div>`;
      const btn = document.createElement('button');
      btn.textContent = maxed ? 'MAX' : `Buy 🪙 ${cost}`;
      btn.disabled = maxed || p.coins < cost;
      btn.onclick = () => {
        if (p.coins < cost) return;
        p.coins -= cost; p.upgrades[key]++;
        game.refreshStats();
        game.me.o2 = game.st.o2;
        ui.save(p);
        ui.toast(`⬆️ ${u.name} upgraded to level ${p.upgrades[key]}`);
        renderShop();
      };
      card.appendChild(btn);
      cards.appendChild(card);
    }
  } else if (shopTab === 'boat') {
    body.innerHTML = '<p class="note">Sail to any boat stop you have discovered. Surface next to a buoy to unlock it.</p><div class="list"></div>';
    const list = body.lastChild;
    for (const b of BUOYS) {
      const on = p.buoys.includes(b.id);
      const row = document.createElement('div');
      row.className = 'li';
      row.innerHTML = `<span>${on ? b.name : '??? (undiscovered)'}</span>`;
      if (on) {
        const btn = document.createElement('button');
        const isHere = here.id === b.id;
        btn.textContent = isHere ? 'You are here' : 'Sail ⛵';
        btn.disabled = isHere;
        btn.onclick = () => {
          Object.assign(game.me, { x: b.x, y: 4, vx: 0, vy: 0 });
          game.cam.x = b.x; game.cam.y = 0;
          closeShop();
          ui.toast(`⛵ Arrived at ${b.name}`);
        };
        row.appendChild(btn);
      }
      list.appendChild(row);
    }
  } else if (shopTab === 'journal') {
    const sections = [['Creatures', CREATURES], ['Plants', PLANTS], ['Treasure', TREASURES], ['Trophies', TROPHIES]];
    let found = 0, all = 0, html = '';
    for (const [title, defs] of sections) {
      html += `<h3>${title}</h3><div class="grid-j">`;
      for (const [k, d] of Object.entries(defs)) {
        all++;
        const j = p.journal[k];
        if (j) found++;
        html += j
          ? `<div class="j"><span class="${d.legendary ? 'legend' : ''}">${d.name}</span><small>${d.hostile ? 'Hostile' : `🪙 ${d.value} · ${d.kg} kg`} · collected ${j.n}</small></div>`
          : `<div class="j unk">???<small>${d.legendary ? 'Legendary' : d.rare ? 'Rare' : 'Undiscovered'}</small></div>`;
      }
      html += '</div>';
    }
    body.innerHTML = `<p class="note">Discovered ${found} / ${all} · Deepest dive: ${Math.round(p.bestDepth * 0.5)} m · Lifetime earnings: 🪙 ${p.totalEarned}</p>${html}`;
  }
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => { shopTab = b.dataset.tab; renderShop(); };

function closeShop() {
  show('screen-shop', false);
  input.enabled = true;
  input.clear();
}
$('shopClose').onclick = closeShop;

// ---------------------------------------------------------------- pause / help
function openPause() {
  if (!game || !game.running) return;
  input.enabled = false;
  $('pauseRoom').textContent = net ? `Online room code: ${net.code} — the ocean keeps moving while paused in co-op.` : '';
  show('screen-pause');
}
function closePause() { show('screen-pause', false); input.enabled = true; input.clear(); }
$('btnMenu').onclick = openPause;
$('resumeBtn').onclick = closePause;
$('quitBtn').onclick = () => quitGame();
$('fullBtn').onclick = () => {
  const d = document;
  if (d.fullscreenElement) d.exitFullscreen?.();
  else d.documentElement.requestFullscreen?.().catch(() => ui.toast('Fullscreen is not supported here'));
};
const openHelp = () => show('screen-help');
$('helpBtn').onclick = openHelp;
$('help2Btn').onclick = openHelp;
$('helpClose').onclick = () => show('screen-help', false);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (!$('screen-help').classList.contains('hidden')) show('screen-help', false);
  else if (!$('screen-code').classList.contains('hidden')) show('screen-code', false);
  else if (!$('screen-shop').classList.contains('hidden')) closeShop();
  else if (!$('screen-pause').classList.contains('hidden')) closePause();
  else if (game && game.running) openPause();
});

window.addEventListener('beforeunload', () => { if (game && game.running) game.saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game && game.running) game.saveNow(); });

// debug handle for the browser console
window.__ddx = { get game() { return game; }, startGame, Save };

// ---------------------------------------------------------------- boot
$('nameInput').value = Save.lastName();
const last = Save.load(Save.lastName() || '_');
pickColor(last ? last.color : SUIT_COLORS[0]);
renderProfiles();
