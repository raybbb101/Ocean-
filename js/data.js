// All game content lives here so it is easy to tweak balance or add new things.
// Depth is in world pixels; the HUD shows metres = y * METRES_PER_PX.

export const WORLD = { W: 8000, D: 5000, DOCK_X: 150 };
export const METRES_PER_PX = 0.5;

export const ZONES = [
  { name: 'Sunlit Zone', top: 0 },
  { name: 'Twilight Zone', top: 700 },
  { name: 'Midnight Zone', top: 1800 },
  { name: 'The Abyss', top: 3200 },
];
export const zoneAt = (y) => { let z = ZONES[0]; for (const it of ZONES) if (y >= it.top) z = it; return z; };

// Water colour stops by depth.
export const WATER = [
  [0, '#3fb4d6'], [400, '#1f7fb0'], [1200, '#10457a'], [2400, '#08214a'], [3800, '#040d24'], [5000, '#02040c'],
];

// Boat stops on the surface. The first is the home dock (shop); others unlock when you surface next to them.
export const BUOYS = [
  { id: 'dock', name: 'Home Dock', x: 150 },
  { id: 'reef', name: 'Coral Buoy', x: 2200 },
  { id: 'shelf', name: 'Shelf Buoy', x: 4500 },
  { id: 'trench', name: 'Trench Buoy', x: 6800 },
];

// ---------------- Creatures ----------------
// kind: sprite family. behavior: wander | flee | drift | hostile
// w = spawn weight. catch = can be caught with the net. drop = trophy given to whoever kills a hostile.
export const CREATURES = {
  clownfish:  { name: 'Clownfish', kind: 'fish', size: 10, colors: ['#ff8a1f', '#ffffff'], pattern: 'stripes', min: 20, max: 650, w: 6, speed: 26, behavior: 'wander', catch: true, value: 5, kg: 1 },
  bluetang:   { name: 'Blue Tang', kind: 'fish', size: 11, colors: ['#2d63ff', '#ffd21a'], pattern: 'tail', min: 20, max: 750, w: 5, speed: 30, behavior: 'wander', catch: true, value: 7, kg: 1 },
  butterfly:  { name: 'Butterflyfish', kind: 'fish', size: 10, colors: ['#ffe14a', '#222222'], pattern: 'eye', min: 20, max: 600, w: 4, speed: 28, behavior: 'wander', catch: true, value: 6, kg: 1 },
  seahorse:   { name: 'Seahorse', kind: 'horse', size: 12, colors: ['#ffb347'], min: 120, max: 900, w: 1.2, speed: 14, behavior: 'flee', catch: true, value: 35, kg: 1, rare: true },
  turtle:     { name: 'Sea Turtle', kind: 'turtle', size: 22, colors: ['#5f8f3a', '#c7b26a'], min: 40, max: 900, w: 0.8, speed: 22, behavior: 'flee', catch: true, value: 80, kg: 6, rare: true },
  lanternfish:{ name: 'Lanternfish', kind: 'fish', size: 9, colors: ['#3c4a6a', '#9ff5ff'], pattern: 'dots', glow: '#7ff0ff', min: 700, max: 2000, w: 6, speed: 34, behavior: 'wander', catch: true, value: 14, kg: 1 },
  hatchet:    { name: 'Hatchetfish', kind: 'fish', size: 9, colors: ['#b8c4d6', '#e8f6ff'], pattern: 'belly', glow: '#bfe8ff', min: 800, max: 2400, w: 4, speed: 32, behavior: 'wander', catch: true, value: 18, kg: 1 },
  nautilus:   { name: 'Nautilus', kind: 'naut', size: 12, colors: ['#f2e6d0', '#b5552d'], min: 900, max: 2200, w: 1.2, speed: 18, behavior: 'flee', catch: true, value: 65, kg: 2, rare: true },
  glassocto:  { name: 'Glass Octopus', kind: 'octo', size: 14, colors: ['#bfefff', '#ffd27a'], alpha: 0.6, min: 1600, max: 3200, w: 0.9, speed: 30, behavior: 'flee', catch: true, value: 120, kg: 2, rare: true },
  vampsquid:  { name: 'Vampire Squid', kind: 'squid', size: 16, colors: ['#7a1030', '#ff5a7a'], glow: '#5a8cff', min: 1900, max: 3600, w: 2, speed: 28, behavior: 'flee', catch: true, value: 75, kg: 2 },
  dumbo:      { name: 'Dumbo Octopus', kind: 'octo', size: 14, colors: ['#ff9fb0', '#ffd6de'], min: 3000, max: 5000, w: 1.4, speed: 22, behavior: 'flee', catch: true, value: 220, kg: 2, rare: true },
  seadragon:  { name: 'Golden Seadragon', kind: 'horse', size: 16, colors: ['#ffd23a'], glow: '#ffe27a', min: 3600, max: 5000, w: 0.25, speed: 75, behavior: 'flee', catch: true, value: 900, kg: 2, rare: true, legendary: true },
  // hostiles
  jelly:      { name: 'Moon Jelly', kind: 'jelly', size: 12, colors: ['#ff9be6', '#ffd6f5'], glow: '#ff9be6', min: 200, max: 2600, w: 2.5, speed: 10, behavior: 'drift', hostile: true, hp: 2, dmg: 6, value: 0 },
  barracuda:  { name: 'Barracuda', kind: 'fish', size: 20, long: true, colors: ['#9aa8b8', '#dfe8ef'], pattern: 'belly', min: 120, max: 1500, w: 2, speed: 62, behavior: 'hostile', hostile: true, hp: 3, dmg: 8, aggro: 110, drop: 'fang' },
  shark:      { name: 'Reef Shark', kind: 'shark', size: 42, colors: ['#6f8396', '#e6edf2'], min: 500, max: 2600, w: 1, speed: 66, behavior: 'hostile', hostile: true, hp: 8, dmg: 18, aggro: 160, drop: 'tooth' },
  angler:     { name: 'Anglerfish', kind: 'angler', size: 22, colors: ['#3b2a35', '#6a4a5a'], glow: '#c8ff6a', min: 1900, max: 4400, w: 1.6, speed: 44, behavior: 'hostile', hostile: true, hp: 5, dmg: 14, aggro: 130, drop: 'lure' },
  giantsquid: { name: 'Giant Squid', kind: 'squid', size: 64, colors: ['#9b2b2b', '#e06a5a'], min: 3300, max: 5000, w: 0.35, speed: 55, behavior: 'hostile', hostile: true, hp: 22, dmg: 26, aggro: 210, drop: 'beak' },
};

// ---------------- Seabed things (plants + treasure) ----------------
export const PLANTS = {
  seagrass:  { name: 'Sea Grass', art: 'grass', colors: ['#3fae4a', '#7bd66a'], min: 0, max: 600, w: 6, value: 2, kg: 1 },
  kelp:      { name: 'Giant Kelp', art: 'kelp', colors: ['#5c8a1e', '#9cc43a'], min: 0, max: 700, w: 4, value: 4, kg: 1 },
  redcoral:  { name: 'Red Coral', art: 'coral', colors: ['#e2483a', '#ff9a7a'], min: 30, max: 900, w: 4, value: 7, kg: 2 },
  seafan:    { name: 'Purple Sea Fan', art: 'fan', colors: ['#8a3fd0', '#c88aff'], min: 100, max: 1000, w: 3, value: 9, kg: 2 },
  starfish:  { name: 'Starfish', art: 'star', colors: ['#ff6a3a', '#ffb07a'], min: 0, max: 1400, w: 2.5, value: 8, kg: 1 },
  sealily:   { name: 'Sea Lily', art: 'lily', colors: ['#e8c25a', '#fff0b0'], min: 700, max: 2000, w: 3, value: 16, kg: 2 },
  glowsponge:{ name: 'Glow Sponge', art: 'sponge', colors: ['#2fb6a6', '#9ffff0'], glow: '#5fffe6', min: 900, max: 2400, w: 3, value: 22, kg: 3 },
  blackcoral:{ name: 'Black Coral', art: 'coral', colors: ['#222428', '#5a6070'], min: 1800, max: 3600, w: 2.5, value: 40, kg: 3 },
  anemone:   { name: 'Luminous Anemone', art: 'anemone', colors: ['#3a6cff', '#b4d0ff'], glow: '#7aa8ff', min: 1800, max: 3800, w: 2.5, value: 55, kg: 2 },
  tubeworm:  { name: 'Tube Worm Bloom', art: 'tube', colors: ['#f0f0f0', '#ff3030'], min: 3200, max: 5000, w: 3, value: 80, kg: 3 },
  pearlmoss: { name: 'Abyssal Pearl Moss', art: 'moss', colors: ['#8affc8', '#ffffff'], glow: '#aaffdd', min: 3600, max: 5000, w: 0.8, value: 150, kg: 1, rare: true },
};

export const TREASURES = {
  coins:     { name: 'Doubloon Pile', art: 'coins', colors: ['#ffd23a', '#b8860b'], min: 0, max: 1600, w: 5, value: 25, kg: 3 },
  clam:      { name: 'Pearl Clam', art: 'clam', colors: ['#c9a3c9', '#ffffff'], min: 100, max: 2200, w: 3, value: 50, kg: 2 },
  cup:       { name: 'Silver Goblet', art: 'cup', colors: ['#d8dde6', '#8a93a3'], min: 300, max: 2600, w: 3, value: 45, kg: 3 },
  compass:   { name: 'Brass Compass', art: 'compass', colors: ['#d9a441', '#fff4dc'], min: 500, max: 3000, w: 2.5, value: 70, kg: 2 },
  chest:     { name: 'Sunken Chest', art: 'chest', colors: ['#8a5a2b', '#ffd23a'], min: 800, max: 4200, w: 2, value: 160, kg: 6 },
  idol:      { name: 'Jade Idol', art: 'idol', colors: ['#3fa36a', '#a6f0c0'], min: 2000, max: 5000, w: 1.2, value: 270, kg: 5 },
  rubychest: { name: 'Ruby Chest', art: 'chest', colors: ['#8a1a2a', '#ff4a6a'], min: 2800, max: 5000, w: 1, value: 450, kg: 7 },
  crown:     { name: 'Crown of the Deep', art: 'crown', colors: ['#ffd23a', '#4af0ff'], min: 3800, max: 5000, w: 0.3, value: 1200, kg: 4, rare: true, legendary: true },
};

// Trophies dropped by hostile creatures.
export const TROPHIES = {
  fang:  { name: 'Barracuda Fang', value: 25, kg: 1 },
  tooth: { name: 'Shark Tooth', value: 70, kg: 2 },
  lure:  { name: 'Angler Lure', value: 95, kg: 1 },
  beak:  { name: 'Giant Squid Beak', value: 350, kg: 4 },
};

// Look up any collectible by key.
export function itemDef(key) {
  return CREATURES[key] || PLANTS[key] || TREASURES[key] || TROPHIES[key] || null;
}

// ---------------- Upgrades ----------------
// Each upgrade has 7 levels (0..6). cost[i] = price to go from level i to i+1.
export const UPGRADES = {
  fins:    { name: 'Fins', desc: 'Swim faster', cost: [60, 150, 350, 700, 1300, 2400], val: (l) => 1 + 0.18 * l, fmt: (v) => `${Math.round(v * 100)}% speed` },
  tank:    { name: 'Oxygen Tank', desc: 'Stay down longer', cost: [80, 200, 450, 900, 1600, 2800], val: (l) => 100 + 70 * l, fmt: (v) => `${v} O₂` },
  bag:     { name: 'Cargo Bag', desc: 'Carry more weight', cost: [70, 180, 400, 800, 1500, 2600], val: (l) => 12 + 8 * l, fmt: (v) => `${v} kg` },
  suit:    { name: 'Pressure Suit', desc: 'Safe depth & less heaviness', cost: [100, 260, 600, 1200, 2200, 4000], val: (l) => [550, 1100, 1800, 2600, 3400, 4200, 5100][l], fmt: (v) => `${Math.round(v * METRES_PER_PX)} m safe` },
  harpoon: { name: 'Harpoon Gun', desc: 'Damage & reload', cost: [90, 220, 500, 1000, 1800, 3000], val: (l) => ({ dmg: 1 + l, reload: Math.max(0.22, 0.8 - 0.1 * l) }), fmt: (v) => `${v.dmg} dmg / ${v.reload.toFixed(2)}s` },
  lamp:    { name: 'Dive Lamp', desc: 'See in the dark', cost: [50, 140, 320, 650, 1200, 2000], val: (l) => 60 + 30 * l, fmt: (v) => `light radius ${v}` },
};
export const MAX_LEVEL = 6;

export const SUIT_COLORS = ['#ffcc33', '#ff5a5a', '#4ad66d', '#4aa8ff', '#c77dff', '#ff8ad8'];
