// SCRAPLINE — configuration in one place: weapons, economy, teams and the map
// layout. Nothing here touches three.js; map.js turns the layout into meshes.
// All names, places and weapons are original — no borrowed game content.

// ---- match ----
export const MATCH = {
  winsToTake: 8, // first to 8 rounds takes the match
  maxRounds: 15, // 7-7 after 15 rounds is a draw
  roundTime: 100, // seconds per round
  buyTime: 20, // seconds of buy phase before each round
  plantTime: 3.5, // seconds to plant the breach charge
  defuseTime: 5.0, // seconds to defuse it
  fuseTime: 35, // seconds from plant to detonation
  roundEndTime: 4.5, // seconds the round-end banner shows
  teamSize: 5, // player + 4 bot teammates vs 5 bot defenders
};

// ---- economy ----
export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  plantReward: 300,
  winReward: 3250,
  lossReward: 1900,
  lossStreakBonus: 500, // per consecutive loss, capped at 2 steps
  maxMoney: 16000,
};

// ---- teams ----
export const TEAMS = {
  atk: { id: 'atk', name: 'VANGUARD', color: 0x2fa8a0, css: '#37c8bd', role: 'attackers' },
  def: { id: 'def', name: 'EMBER', color: 0xd9552c, css: '#ff7a3c', role: 'defenders' },
};

// ---- weapons ----
// damage is body damage; headshots multiply by headMult. spread is in degrees
// (base cone half-angle). recoil is pitch kick per shot in degrees.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9', full: 'P9 sidearm', price: 0, slot: 'sidearm',
    damage: 34, headMult: 2.0, fireRate: 320, auto: false,
    mag: 12, reserve: 36, reloadTime: 1.4, spread: 1.1, moveSpread: 2.2,
    recoil: 0.55, recoilYaw: 0.25, range: 40, adsSpreadMult: 0.55,
    pellets: 1, tracer: 0xffe9a8, sound: 'pistol',
  },
  hail: {
    id: 'hail', name: 'HAIL', full: 'HAIL submachine gun', price: 1500, slot: 'primary',
    damage: 22, headMult: 2.0, fireRate: 900, auto: true,
    mag: 32, reserve: 96, reloadTime: 1.9, spread: 1.6, moveSpread: 3.4,
    recoil: 0.34, recoilYaw: 0.3, range: 32, adsSpreadMult: 0.6,
    pellets: 1, tracer: 0xffd27a, sound: 'smg',
  },
  vk47: {
    id: 'vk47', name: 'VK-47', full: 'VK-47 assault rifle', price: 2700, slot: 'primary',
    damage: 33, headMult: 4.0, fireRate: 600, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.2, spread: 1.0, moveSpread: 2.6,
    recoil: 0.62, recoilYaw: 0.28, range: 55, adsSpreadMult: 0.5,
    pellets: 1, tracer: 0xffc46b, sound: 'rifle',
  },
  scatter: {
    id: 'scatter', name: 'SCATTER-12', full: 'SCATTER-12 pump shotgun', price: 1700, slot: 'primary',
    damage: 12, headMult: 2.0, fireRate: 70, auto: false,
    mag: 6, reserve: 24, reloadTime: 2.8, spread: 4.2, moveSpread: 5.0,
    recoil: 1.9, recoilYaw: 0.6, range: 18, adsSpreadMult: 0.7,
    pellets: 8, tracer: 0xffe1a1, sound: 'shotgun',
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT', full: 'LONGSHOT marksman rifle', price: 4750, slot: 'primary',
    damage: 110, headMult: 2.5, fireRate: 48, auto: false, scoped: true,
    mag: 5, reserve: 15, reloadTime: 3.1, spread: 0.15, moveSpread: 6.0,
    recoil: 2.6, recoilYaw: 0.4, range: 90, adsSpreadMult: 0.35,
    pellets: 1, tracer: 0xfff2c0, sound: 'sniper',
  },
};

export const ARMOR_PRICE = 650; // vest: absorbs half of incoming damage
export const GRENADE_PRICE = 300; // POPPER fragmentation grenade
export const GRENADE_MAX = 2;

// ---- movement ----
export const MOVE = {
  walkSpeed: 4.3,
  crouchSpeed: 2.1,
  adsSpeedMult: 0.55,
  scopeSpeedMult: 0.4,
  accel: 34,
  friction: 26,
  jumpSpeed: 4.6,
  gravity: 12.5,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.12,
  radius: 0.36,
};

// ---- map layout: YARD 9, a container yard, 64 x 44 m ----
// Ground runs x in [-32, 32], z in [-22, 22]. Attackers spawn south (z +),
// defenders north (z -). Site A is west, Site B is east. Mid is the gantry lane.
export const MAP = {
  halfX: 32,
  halfZ: 22,
  sites: {
    A: { id: 'A', name: 'CRANE BAY', x: -23, z: -13, r: 4.5 },
    B: { id: 'B', name: 'FURNACE', x: 23, z: -13, r: 4.5 },
  },
  spawns: {
    atk: [
      [-6, 18], [-2, 19], [2, 19], [6, 18], [0, 16],
    ],
    def: [
      [-24, -17], [-8, -18], [0, -19], [8, -18], [24, -17],
    ],
  },
  // Walls: {x, z, w, d, h} — axis-aligned boxes, y from 0 to h.
  // Perimeter + interior walls shaping three lanes (A west, mid, B east).
  walls: [
    // perimeter
    { x: 0, z: -22.5, w: 66, d: 1, h: 5 },
    { x: 0, z: 22.5, w: 66, d: 1, h: 5 },
    { x: -32.5, z: 0, w: 1, d: 46, h: 5 },
    { x: 32.5, z: 0, w: 1, d: 46, h: 5 },
    // mid cross wall with two gaps (the gantry lane)
    { x: -22, z: -2, w: 18, d: 1.2, h: 3.4 },
    { x: 22, z: -2, w: 18, d: 1.2, h: 3.4 },
    // A-site back wall and B-site back wall
    { x: -23, z: -18.5, w: 14, d: 1.2, h: 4.2 },
    { x: 23, z: -18.5, w: 14, d: 1.2, h: 4.2 },
    // lane divider stubs
    { x: -12, z: 8, w: 1.2, d: 10, h: 3.2 },
    { x: 12, z: 8, w: 1.2, d: 10, h: 3.2 },
    { x: -12, z: -10, w: 1.2, d: 8, h: 3.2 },
    { x: 12, z: -10, w: 1.2, d: 8, h: 3.2 },
  ],
  // Crates and containers: {x, z, w, d, h, color} — cover objects.
  crates: [
    // mid lane cover
    { x: -4, z: 2, w: 2.4, d: 2.4, h: 1.2, color: 0x8a6f3c },
    { x: 4, z: -5, w: 2.4, d: 2.4, h: 1.2, color: 0x7a7d84 },
    { x: 0, z: 6, w: 3.2, d: 1.6, h: 1.1, color: 0x9a7b4f },
    { x: -2, z: -9, w: 2.2, d: 2.2, h: 2.4, color: 0x6b7a6e },
    { x: 3, z: -12, w: 2.2, d: 2.2, h: 2.4, color: 0x8a6f3c },
    // A lane
    { x: -16, z: 4, w: 2.4, d: 2.4, h: 1.2, color: 0x7a7d84 },
    { x: -20, z: -6, w: 2.6, d: 2.6, h: 2.6, color: 0xb3542e },
    { x: -26, z: -8, w: 2.2, d: 2.2, h: 1.2, color: 0x8a6f3c },
    { x: -18, z: -14, w: 2.4, d: 2.4, h: 1.2, color: 0x6b7a6e },
    { x: -27, z: -14, w: 2.0, d: 2.0, h: 2.2, color: 0x7a7d84 },
    // B lane
    { x: 16, z: 4, w: 2.4, d: 2.4, h: 1.2, color: 0x6b7a6e },
    { x: 20, z: -6, w: 2.6, d: 2.6, h: 2.6, color: 0x2e6b8a },
    { x: 26, z: -8, w: 2.2, d: 2.2, h: 1.2, color: 0x7a7d84 },
    { x: 18, z: -14, w: 2.4, d: 2.4, h: 1.2, color: 0x8a6f3c },
    { x: 27, z: -14, w: 2.0, d: 2.0, h: 2.2, color: 0x6b7a6e },
    // spawn cover
    { x: -8, z: 14, w: 2.4, d: 2.4, h: 1.2, color: 0x7a7d84 },
    { x: 8, z: 14, w: 2.4, d: 2.4, h: 1.2, color: 0x8a6f3c },
    { x: -14, z: -16, w: 2.4, d: 2.4, h: 1.2, color: 0x6b7a6e },
    { x: 14, z: -16, w: 2.4, d: 2.4, h: 1.2, color: 0x7a7d84 },
  ],
  // Tall containers (visual landmarks + hard cover), same shape as crates.
  containers: [
    { x: -27, z: 8, w: 6.0, d: 2.6, h: 2.6, color: 0xb3542e },
    { x: 27, z: 8, w: 6.0, d: 2.6, h: 2.6, color: 0x2e6b8a },
    { x: -27, z: -2, w: 2.6, d: 6.0, h: 2.6, color: 0x3f6b4f },
    { x: 27, z: -2, w: 2.6, d: 6.0, h: 2.6, color: 0x8a6f3c },
    { x: 0, z: -18, w: 6.0, d: 2.6, h: 2.6, color: 0x6b5a8a },
  ],
};

// ---- bot navigation graph ----
// Nodes the bots walk between. Edges are bidirectional; bots path with BFS.
// Coordinates are open floor (never inside a wall or crate).
export const WAYPOINTS = [
  { x: -6, z: 18 }, // 0 atk spawn left
  { x: 6, z: 18 }, // 1 atk spawn right
  { x: 0, z: 14 }, // 2 atk mid
  { x: -10, z: 12 }, // 3 A approach low
  { x: 10, z: 12 }, // 4 B approach low
  { x: -18, z: 8 }, // 5 A lane
  { x: 18, z: 8 }, // 6 B lane
  { x: 0, z: 8 }, // 7 mid low
  { x: -8, z: 2 }, // 8 mid west gap
  { x: 8, z: 2 }, // 9 mid east gap
  { x: 0, z: 0 }, // 10 gantry centre
  { x: -16, z: -2 }, // 11 A lane high
  { x: 16, z: -2 }, // 12 B lane high
  { x: -8, z: -6 }, // 13 mid west high
  { x: 8, z: -6 }, // 14 mid east high
  { x: 0, z: -8 }, // 15 mid high
  { x: -23, z: -9 }, // 16 site A entry
  { x: 23, z: -9 }, // 17 site B entry
  { x: -23, z: -13 }, // 18 site A
  { x: 23, z: -13 }, // 19 site B
  { x: -8, z: -16 }, // 20 def mid west
  { x: 8, z: -16 }, // 21 def mid east
  { x: 0, z: -19 }, // 22 def spawn
  { x: -26, z: -17 }, // 23 A hold
  { x: 26, z: -17 }, // 24 B hold
  { x: -14, z: -13 }, // 25 A flank
  { x: 14, z: -13 }, // 26 B flank
];

export const WAY_EDGES = [
  [0, 2], [1, 2], [2, 3], [2, 4], [2, 7],
  [3, 5], [4, 6], [3, 8], [4, 9], [7, 8], [7, 9],
  [5, 11], [6, 12], [8, 10], [9, 10], [8, 13], [9, 14],
  [10, 15], [11, 16], [12, 17], [13, 15], [14, 15],
  [11, 25], [12, 26], [16, 18], [17, 19], [16, 25], [17, 26],
  [13, 20], [14, 21], [15, 22], [20, 22], [21, 22],
  [20, 23], [21, 24], [23, 18], [24, 19], [18, 25], [19, 26],
  [25, 20], [26, 21], [22, 23], [22, 24],
];

// Where defenders hold when nothing is happening: [waypoint, site].
export const DEFEND_POSTS = [
  { node: 23, site: 'A' },
  { node: 16, site: 'A' },
  { node: 20, site: 'A' },
  { node: 24, site: 'B' },
  { node: 17, site: 'B' },
  { node: 21, site: 'B' },
  { node: 15, site: null }, // mid watcher
];

// Bot callsigns (original).
export const BOT_NAMES = {
  atk: ['ROOK', 'FABLE', 'IRIS', 'MOSS'],
  def: ['ASH', 'CINDER', 'SOOT', 'FLINT', 'GRAVEL'],
};

// Seeded RNG (mulberry32) so demo shots and bot spawns are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
