// Save system: profiles stored in this browser (localStorage).
// Account/cloud saves need a backend (see README), so we save locally and offer
// export/import "save codes" to move progress between devices.
import { UPGRADES, SUIT_COLORS } from './data.js';

const KEY = 'deepDiveExplorers.profiles.v1';
const LAST = 'deepDiveExplorers.lastProfile';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function writeAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
}

export function newProfile(name) {
  const upgrades = {};
  for (const k of Object.keys(UPGRADES)) upgrades[k] = 0;
  return {
    name, coins: 0, upgrades, cargo: [], journal: {}, buoys: ['dock'],
    color: SUIT_COLORS[Math.floor(Math.random() * SUIT_COLORS.length)],
    bestDepth: 0, totalEarned: 0, created: Date.now(), updated: Date.now(),
  };
}

// Fill in fields that older saves may be missing.
function normalize(p) {
  const base = newProfile(p.name || 'Diver');
  const out = { ...base, ...p, upgrades: { ...base.upgrades, ...(p.upgrades || {}) } };
  if (!Array.isArray(out.cargo)) out.cargo = [];
  if (!Array.isArray(out.buoys) || !out.buoys.includes('dock')) out.buoys = ['dock', ...(out.buoys || [])];
  return out;
}

export const Save = {
  list() {
    return Object.values(readAll()).sort((a, b) => b.updated - a.updated);
  },
  load(name) {
    const p = readAll()[name.toLowerCase()];
    return p ? normalize(p) : null;
  },
  loadOrCreate(name) {
    return this.load(name) || newProfile(name);
  },
  store(profile) {
    const all = readAll();
    profile.updated = Date.now();
    all[profile.name.toLowerCase()] = profile;
    localStorage.setItem(LAST, profile.name);
    return writeAll(all);
  },
  remove(name) {
    const all = readAll();
    delete all[name.toLowerCase()];
    writeAll(all);
  },
  lastName() {
    try { return localStorage.getItem(LAST) || ''; } catch { return ''; }
  },
  exportCode(profile) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(profile))));
  },
  importCode(code) {
    const p = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!p || typeof p.name !== 'string' || typeof p.coins !== 'number') throw new Error('Not a valid save code');
    return normalize(p);
  },
};
