// SCRAPLINE — entry point. Boots three.js, owns the fixed-step loop (60 Hz
// simulation, rendering decoupled), the player controller, the viewmodel and
// the round flow. Bots, weapons, combat and the HUD live in their own modules.
import * as THREE from 'three';
import { MATCH, ECONOMY, WEAPONS, ARMOR_PRICE, GRENADE_PRICE, MAP, MOVE, TEAMS, mulberry32 } from './config.js';
import { buildMap, moveCircle, hasLOS, pointInSite, updateSiteBeacons } from './map.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import {
  makeLoadout, makeWeaponState, currentWeapon, switchWeapon, tickWeapon,
  startReload, canFire, consumeShot, currentSpread, makeGrenade, stepGrenade,
} from './weapons.js';
import { createBot, buildBotMesh, assignRoles, updateBot, syncMesh, nearestNode } from './bots.js';
import { traceShot, applyDamage, spreadDir, createEffects } from './combat.js';
import { createMatch, startBuyPhase, startRound, checkRoundEnd, endRound, advanceAfterRound, awardKill, awardPlant } from './state.js';
import { initHud, initBuyMenu, showTitle, hideTitle, showRoundEnd, hideRoundEnd, showMatchEnd } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const DEMO_SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || 7);
const rng = mulberry32(SEED);

// ---- renderer / scene ----
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
scene.add(camera);

const { colliders, sites } = buildMap(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = initHud();

// ---- match + combatants ----
const match = createMatch();
const player = {
  id: 'player', name: 'YOU', team: 'atk', isPlayer: true,
  pos: { x: 0, y: 0, z: 16 }, yaw: 0, pitch: 0,
  hp: 100, alive: true, lastSeen: 0,
  loadout: makeLoadout(null),
  vel: { x: 0, z: 0 }, vy: 0, onGround: true, crouched: false,
  isMoving: false, spectateId: null, plantProgress: 0,
  recoilPitch: 0, recoilYaw: 0, walkPhase: 0, stepAcc: 0,
  ads: false, scoped: false, fov: 75,
};
let bots = [];
let grenades = [];
let noiseEvents = [];
let paused = false;
let worldTime = 0;

const world = {
  colliders, bots, sites, charge: match.charge, rng,
  get time() { return worldTime; },
  noise: noiseEvents,
  onShotFired(shooter, eye, point, color, dist) {
    effects.tracer(eye, point, color);
    const d = Math.hypot(eye.x - player.pos.x, eye.z - player.pos.z);
    audio.shot(shooter.loadout ? currentWeapon(shooter.loadout).def.sound : 'rifle', Math.min(1, d / 45));
    noiseEvents.push({ x: eye.x, z: eye.z, at: worldTime });
  },
  onImpact(point) { effects.impact(point); },
  onDamage(target, dealt, attacker, head) {
    if (target.isPlayer) hud.damageFlash();
    if (attacker && attacker.isPlayer) hud.hitmarker(head);
  },
  onKill(killer, victim, head) {
    const k = killer.isPlayer ? 'YOU' : killer.name;
    const v = victim.isPlayer ? 'YOU' : victim.name;
    const kc = killer.team === 'atk' ? 'atk' : 'def';
    const vc = victim.team === 'atk' ? 'atk' : 'def';
    hud.feed(`<b class="${kc}">${k}</b> ${head ? '⌖' : '✕'} <b class="${vc}">${v}</b>`, '');
    if (killer.isPlayer) {
      awardKill(match);
      audio.kill();
    }
    if (victim.isPlayer) {
      player.alive = false;
      spectateNext();
      if (match.charge.carrierId === 'player') transferCharge();
    }
    // If the charge carrier dies, a teammate picks the charge up.
    if (match.charge.carrierId === victim.id && match.charge.state === 'carried') {
      const aliveAtk = bots.filter((b) => b.team === 'atk' && b.alive);
      if (player.alive) match.charge.carrierId = 'player';
      else if (aliveAtk.length) match.charge.carrierId = aliveAtk[Math.floor(rng() * aliveAtk.length)].id;
      else match.charge.carrierId = null;
    }
  },
  onPlantProgress(bot, p) { /* bots plant silently; the HUD shows the bar for the player only */ },
  onDefuseProgress(bot, p) { /* same */ },
  onPlant(site, bot) {
    match.charge.state = 'planted';
    match.charge.site = site;
    match.charge.plantT = MATCH.fuseTime;
    match.charge.pos = { x: sites[site].x, z: sites[site].z };
    hud.banner(`CHARGE PLANTED AT ${site}`, bot.isPlayer ? 'Defend it — 35 seconds to detonation' : `${bot.name} planted the charge — defend it`, 3000);
    hud.feed(`<b class="atk">${bot.isPlayer ? 'YOU' : bot.name}</b> planted the charge at ${site}`, '');
    audio.plantBeep(true);
    if (bot.isPlayer) awardPlant(match);
  },
  onDefuse(bot) {
    match.charge.state = 'defused';
    hud.banner('CHARGE DEFUSED', 'EMBER takes the round', 3000);
    audio.defuseBeep();
  },
};

function spectateNext() {
  const alive = bots.filter((b) => b.team === 'atk' && b.alive);
  player.spectateId = alive.length ? alive[Math.floor(rng() * alive.length)].id : null;
}

function transferCharge() {
  const alive = bots.filter((b) => b.team === 'atk' && b.alive);
  match.charge.carrierId = alive.length ? alive[Math.floor(rng() * alive.length)].id : null;
}

// ---- viewmodel: the gun in the player's hands ----
const viewmodel = new THREE.Group();
camera.add(viewmodel);
const vmParts = {};
function buildViewmodel() {
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3e46 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x6a6e78 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd6a43c });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.42), dark);
  receiver.position.set(0, 0, 0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), metal);
  barrel.position.set(0, 0.02, -0.36);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark);
  mag.position.set(0, -0.14, -0.02);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.18), dark);
  stock.position.set(0, -0.01, 0.28);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.1), accent);
  sight.position.set(0, 0.1, -0.05);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10), dark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.11, -0.08);
  scope.visible = false;
  viewmodel.add(receiver, barrel, mag, stock, sight, scope);
  vmParts.barrel = barrel;
  vmParts.scope = scope;
  vmParts.receiver = receiver;
  viewmodel.scale.setScalar(0.68);
  viewmodel.position.set(0.24, -0.27, -0.5);
}
buildViewmodel();

function setViewmodelWeapon(weaponId) {
  const def = WEAPONS[weaponId];
  const long = def.id === 'longshot' ? 0.62 : def.id === 'scatter' ? 0.5 : def.id === 'p9' ? 0.24 : 0.42;
  vmParts.barrel.scale.z = long / 0.34;
  vmParts.barrel.position.z = -0.2 - long / 2 + 0.17;
  vmParts.scope.visible = def.id === 'longshot';
}

// ---- spawning ----
const BOT_WEAPONS_ATK = ['vk47', 'hail', 'scatter', 'vk47'];
const BOT_WEAPONS_DEF = ['vk47', 'hail', 'vk47', 'scatter', 'longshot'];

function spawnRound() {
  // Remove last round's bots.
  for (const b of bots) {
    if (b.mesh) scene.remove(b.mesh.group);
  }
  bots = [];
  const atkNames = ['ROOK', 'FABLE', 'IRIS', 'MOSS'];
  const defNames = ['ASH', 'CINDER', 'SOOT', 'FLINT', 'GRAVEL'];
  for (let i = 0; i < 4; i++) {
    const [x, z] = MAP.spawns.atk[i];
    const mesh = buildBotMesh(TEAMS.atk.color);
    scene.add(mesh.group);
    bots.push(createBot(i, atkNames[i], 'atk', x, z, BOT_WEAPONS_ATK[i], mesh));
  }
  for (let i = 0; i < 5; i++) {
    const [x, z] = MAP.spawns.def[i];
    const mesh = buildBotMesh(TEAMS.def.color);
    scene.add(mesh.group);
    bots.push(createBot(10 + i, defNames[i], 'def', x, z, BOT_WEAPONS_DEF[i], mesh));
  }
  assignRoles(bots, rng);
  // world.bots is what bot AI perceives and shoots at — it must include the
  // player, or the bots would only ever fight each other.
  world.bots = bots.concat([player]);
  // Player: fresh health, full ammo for owned weapons, spawn at the back.
  player.hp = 100;
  player.alive = true;
  player.spectateId = null;
  player.plantProgress = 0;
  player.pos.x = MAP.spawns.atk[4][0];
  player.pos.z = MAP.spawns.atk[4][1];
  player.pos.y = 0;
  player.yaw = 0;
  player.pitch = 0;
  player.vy = 0;
  for (const slot of ['primary', 'sidearm']) {
    const w = player.loadout[slot];
    if (w) {
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      w.reloading = 0;
      w.cooldown = 0;
    }
  }
  for (const b of bots) syncMesh(b, 0, false);
}

// ---- player shooting ----
const _eye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
const _muzzle = new THREE.Vector3();

function playerFire() {
  const w = currentWeapon(player.loadout);
  if (!w) return;
  if (!canFire(w, input.state.firing)) {
    if (w.mag === 0 && w.reloading <= 0) {
      if (w.reserve > 0) { startReload(w); audio.reload(); }
      else audio.dryFire();
    }
    return;
  }
  const pellets = consumeShot(w);
  const eye = { x: player.pos.x, y: player.pos.y + eyeHeight(), z: player.pos.z };
  camera.getWorldDirection(_muzzle);
  _dir.x = _muzzle.x; _dir.y = _muzzle.y; _dir.z = _muzzle.z;
  const spread = currentSpread(w, player.isMoving, player.crouched, player.ads, player.scoped);
  const allBots = bots.concat([player]);
  for (let p = 0; p < pellets; p++) {
    const d = spreadDir(_dir, spread, rng, { x: 0, y: 0, z: 0 });
    const hit = traceShot(eye, d, w.def.range, colliders, allBots, 'player');
    const muzzleWorld = new THREE.Vector3();
    viewmodel.getWorldPosition(muzzleWorld);
    effects.tracer({ x: muzzleWorld.x, y: muzzleWorld.y, z: muzzleWorld.z }, hit.point, w.def.tracer);
    effects.muzzle(muzzleWorld);
    if (hit.kind === 'bot') {
      if (hit.bot.team === player.team) {
        effects.impact(hit.point);
        continue;
      }
      const dmg = w.def.damage * (hit.part === 'head' ? w.def.headMult : 1);
      const dealt = applyDamage(hit.bot, dmg);
      hud.hitmarker(hit.part === 'head');
      audio.hit(hit.part === 'head');
      if (!hit.bot.alive) world.onKill(player, hit.bot, hit.part === 'head');
    } else if (hit.kind === 'wall') {
      effects.impact(hit.point);
    }
  }
  // Recoil: pitch up + a little yaw, recovers in updatePlayer.
  player.recoilPitch += (w.def.recoil * Math.PI) / 180;
  player.recoilYaw += ((rng() - 0.5) * 2 * w.def.recoilYaw * Math.PI) / 180;
  audio.shot(w.def.sound, 0);
  noiseEvents.push({ x: player.pos.x, z: player.pos.z, at: worldTime });
  // Viewmodel kick.
  viewmodel.position.z = -0.5 + 0.06;
}

function eyeHeight() {
  return player.crouched ? MOVE.crouchEyeHeight : MOVE.eyeHeight;
}

function throwGrenade() {
  if (player.loadout.grenades <= 0) return;
  player.loadout.grenades -= 1;
  camera.getWorldDirection(_muzzle);
  const eye = { x: player.pos.x, y: player.pos.y + eyeHeight(), z: player.pos.z };
  const g = makeGrenade(
    { x: eye.x + _muzzle.x * 0.5, y: eye.y + _muzzle.y * 0.5, z: eye.z + _muzzle.z * 0.5 },
    { x: _muzzle.x * 15, y: _muzzle.y * 15 + 3.5, z: _muzzle.z * 15 },
  );
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x2a2d33 }),
  );
  mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
  scene.add(mesh);
  grenades.push({ g, mesh });
  audio.grenadeBounce();
}

// ---- input ----
const input = createInput(renderer.domElement, (locked) => {
  if (DEMO_SHOT) return;
  if (match.phase === 'round') {
    paused = !locked;
    document.getElementById('pause').hidden = locked;
    if (!locked) input.exitLock();
  }
});
document.getElementById('pause').addEventListener('click', () => input.requestLock());
// Clicking the game view during a round (re)locks the mouse for looking.
renderer.domElement.addEventListener('click', () => {
  if (match.phase === 'round' && !input.state.locked && !DEMO_SHOT) input.requestLock();
});
document.getElementById('deploy').addEventListener('click', () => {
  audio.unlock();
  hideTitle(hud);
  startBuyPhase(match);
  buyMenu.show(match.money);
  input.exitLock();
});
document.getElementById('start-round').addEventListener('click', () => beginRound());
document.getElementById('again').addEventListener('click', () => location.reload());

const buyMenu = initBuyMenu(hud, buyItem);

function buyItem(id) {
  if (match.phase !== 'buy') return;
  const price = id === 'armor' ? ARMOR_PRICE : id === 'grenade' ? GRENADE_PRICE : WEAPONS[id].price;
  if (match.money < price) { audio.denied(); return; }
  match.money -= price;
  if (id === 'armor') player.loadout.armor = 100;
  else if (id === 'grenade') player.loadout.grenades = Math.min(2, player.loadout.grenades + 1);
  else {
    player.loadout.primary = makeWeaponState(id);
    player.loadout.current = 'primary';
    setViewmodelWeapon(id);
  }
  audio.buy();
  buyMenu.refresh(match.money);
}

function beginRound() {
  if (match.phase !== 'buy') return;
  buyMenu.hide();
  spawnRound();
  startRound(match);
  hud.banner(`ROUND ${match.round}`, match.charge.carrierId === 'player' ? 'You carry the charge — plant it at A or B' : 'Plant the charge at A or B', 3000);
  audio.horn();
  if (!DEMO_SHOT) input.requestLock();
}

// ---- player update (fixed step) ----
function updatePlayer(dt) {
  const keys = input.state.keys;
  // Look.
  const look = input.takeLook();
  const sens = player.scoped ? 0.0011 : 0.0022;
  player.yaw -= look.x * sens;
  player.pitch -= look.y * sens;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
  // Recoil recovery.
  player.recoilPitch *= Math.pow(0.0001, dt);
  player.recoilYaw *= Math.pow(0.0001, dt);
  if (Math.abs(player.recoilPitch) < 0.0005) player.recoilPitch = 0;
  if (Math.abs(player.recoilYaw) < 0.0005) player.recoilYaw = 0;

  player.crouched = keys.has('ControlLeft') || keys.has('KeyC');
  player.ads = input.state.aiming && player.alive;
  const w = currentWeapon(player.loadout);
  player.scoped = player.ads && !!w && !!w.def.scoped;

  // Movement: accelerate toward the wish velocity, friction when idle.
  // Forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
  let f = 0, s = 0;
  if (keys.has('KeyW')) f += 1;
  if (keys.has('KeyS')) f -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('KeyA')) s -= 1;
  const il = Math.hypot(f, s) || 1;
  f /= il; s /= il;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = -sin * f + cos * s;
  const wz = -cos * f - sin * s;
  let speed = MOVE.walkSpeed;
  if (player.crouched) speed = MOVE.crouchSpeed;
  if (player.ads) speed *= MOVE.adsSpeedMult;
  if (player.scoped) speed *= MOVE.scopeSpeedMult;
  const tx = wx * speed, tz = wz * speed;
  const rate = (f !== 0 || s !== 0) ? MOVE.accel : MOVE.friction;
  player.vel.x += (tx - player.vel.x) * Math.min(1, rate * dt / Math.max(1, speed));
  player.vel.z += (tz - player.vel.z) * Math.min(1, rate * dt / Math.max(1, speed));
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  moveCircle(player.pos, MOVE.radius, colliders);
  // Keep inside the yard.
  player.pos.x = Math.max(-MAP.halfX + 0.5, Math.min(MAP.halfX - 0.5, player.pos.x));
  player.pos.z = Math.max(-MAP.halfZ + 0.5, Math.min(MAP.halfZ - 0.5, player.pos.z));
  player.isMoving = Math.hypot(player.vel.x, player.vel.z) > 0.6;

  // Jump / gravity.
  if (keys.has('Space') && player.onGround) {
    player.vy = MOVE.jumpSpeed;
    player.onGround = false;
  }
  player.vy -= MOVE.gravity * dt;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }

  // Footsteps.
  if (player.isMoving && player.onGround) {
    player.stepAcc += Math.hypot(player.vel.x, player.vel.z) * dt;
    if (player.stepAcc > 2.4) {
      player.stepAcc = 0;
      player.walkPhase += 1;
      audio.footstep(false);
    }
  }

  // Weapon timers.
  if (w) tickWeapon(w, dt);
  const pressed = input.takePressed();
  if (pressed.has('KeyR') && w) { if (startReload(w)) audio.reload(); }
  if (pressed.has('Digit1')) { switchWeapon(player.loadout, 'primary'); setViewmodelWeapon(currentWeapon(player.loadout).id); }
  if (pressed.has('Digit2')) { switchWeapon(player.loadout, 'sidearm'); setViewmodelWeapon('p9'); }
  if (pressed.has('KeyG')) throwGrenade();
  if (pressed.has('KeyB') && match.phase === 'buy') buyMenu.show(match.money);
  if (pressed.has('Enter') && match.phase === 'buy') beginRound();
  if (match.phase === 'buy') {
    for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']) {
      if (pressed.has(k)) buyMenu.buyByKey(k.slice(-1), match.money);
    }
  }

  // Firing (round only).
  if (match.phase === 'round' && player.alive && input.state.firing) playerFire();
  if (w) w.firedOnce = !input.state.firing ? false : w.firedOnce;

  // Planting: hold E inside a site while carrying the charge.
  if (match.phase === 'round' && player.alive && match.charge.carrierId === 'player' && match.charge.state === 'carried') {
    const siteKey = pointInSite(player.pos.x, player.pos.z, sites.A) ? 'A'
      : pointInSite(player.pos.x, player.pos.z, sites.B) ? 'B' : null;
    if (siteKey && keys.has('KeyE')) {
      player.plantProgress += dt;
      if (Math.floor(player.plantProgress * 10) !== Math.floor((player.plantProgress - dt) * 10)) audio.plantBeep(false);
      if (player.plantProgress >= MATCH.plantTime) {
        player.plantProgress = 0;
        world.onPlant(siteKey, player);
      }
    } else {
      player.plantProgress = 0;
    }
  } else {
    player.plantProgress = 0;
  }

  // FOV: ADS tightens, scope zooms.
  const targetFov = player.scoped ? 26 : player.ads ? 60 : 75;
  player.fov += (targetFov - player.fov) * Math.min(1, dt * 12);
  if (Math.abs(camera.fov - player.fov) > 0.05) {
    camera.fov = player.fov;
    camera.updateProjectionMatrix();
  }
  // Viewmodel: bob while walking, settle to centre while aiming.
  const bob = player.isMoving ? Math.sin(player.walkPhase * 2) * 0.012 : 0;
  const vmX = player.ads ? 0 : 0.24;
  const vmY = player.ads ? -0.185 : -0.27 + bob;
  viewmodel.position.x += (vmX - viewmodel.position.x) * Math.min(1, dt * 14);
  viewmodel.position.y += (vmY - viewmodel.position.y) * Math.min(1, dt * 14);
  viewmodel.position.z += (-0.5 - viewmodel.position.z) * Math.min(1, dt * 10);
}

// ---- grenades ----
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const entry = grenades[i];
    const res = stepGrenade(entry.g, dt, colliders);
    entry.mesh.position.set(entry.g.pos.x, entry.g.pos.y, entry.g.pos.z);
    if (res === 'bounce') audio.grenadeBounce();
    if (res === 'explode') {
      scene.remove(entry.mesh);
      grenades.splice(i, 1);
      const p = entry.g.pos;
      effects.explosion(p);
      audio.explosion();
      // Splash damage with falloff, through no walls (simple radius check).
      const all = bots.concat([player]);
      for (const c of all) {
        if (!c.alive) continue;
        const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
        if (d > 6.5) continue;
        const dmg = Math.max(12, 115 * (1 - d / 6.5));
        applyDamage(c, dmg);
        if (c.isPlayer) hud.damageFlash();
        if (!c.alive) world.onKill(player, c, false);
      }
    }
  }
}

// ---- fixed-step simulation ----
function step(dt) {
  worldTime += dt;
  // Prune old noise events.
  while (noiseEvents.length && worldTime - noiseEvents[0].at > 3) noiseEvents.shift();

  if (match.phase === 'buy') {
    match.buyTimer -= dt;
    updatePlayer(dt);
    for (const b of bots) syncMesh(b, dt, false);
    if (match.buyTimer <= 0) beginRound();
    return;
  }
  if (match.phase === 'round') {
    match.timer -= dt;
    if (match.charge.state === 'planted') {
      match.charge.plantT -= dt;
      if (match.charge.plantT <= 10 && Math.floor(match.charge.plantT) !== Math.floor(match.charge.plantT + dt)) audio.plantBeep(false);
      if (match.charge.plantT <= 0) {
        match.charge.state = 'exploded';
        const s = sites[match.charge.site];
        effects.explosion({ x: s.x, y: 0, z: s.z });
        audio.explosion();
      }
    }
    if (player.alive) updatePlayer(dt);
    else {
      // Spectate a teammate: camera follows their eyes.
      const spec = bots.find((b) => b.id === player.spectateId);
      if (!spec || !spec.alive) spectateNext();
    }
    for (const b of bots) updateBot(b, dt, world);
    updateGrenades(dt);
    const end = checkRoundEnd(match, bots, player.alive);
    if (end) {
      const won = endRound(match, end);
      audio[won ? 'roundWin' : 'roundLose']();
      showRoundEnd(hud, won, end.reason, match.score.atk, match.score.def);
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', end.reason, 3000);
      input.exitLock();
    }
    return;
  }
  if (match.phase === 'roundEnd') {
    match.roundEndTimer -= dt;
    updateGrenades(dt);
    if (match.roundEndTimer <= 0) {
      hideRoundEnd(hud);
      const next = advanceAfterRound(match);
      if (next === 'matchEnd') {
        const res = match.matchDraw
          ? 'DRAW 7 — 7'
          : match.matchWinner === 'atk' ? `VANGUARD WINS ${match.score.atk} — ${match.score.def}` : `EMBER WINS ${match.score.def} — ${match.score.atk}`;
        showMatchEnd(hud, res);
      } else {
        buyMenu.show(match.money);
        input.exitLock();
      }
    }
    return;
  }
  // title / matchEnd: idle.
}

// ---- HUD snapshot + camera sync ----
function syncCamera() {
  if (!player.alive && player.spectateId !== null) {
    const spec = bots.find((b) => b.id === player.spectateId);
    if (spec && spec.alive) {
      camera.position.set(spec.pos.x, spec.pos.y + 1.52, spec.pos.z);
      camera.rotation.set(0, spec.yaw, 0, 'YXZ');
      return;
    }
  }
  if (match.phase === 'title') {
    const t = worldTime * 0.05;
    camera.position.set(Math.cos(t) * 26, 12, Math.sin(t) * 18);
    camera.lookAt(0, 1, -4);
    return;
  }
  camera.position.set(player.pos.x, player.pos.y + eyeHeight(), player.pos.z);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0, 'YXZ');
}

function hudSnapshot() {
  const w = currentWeapon(player.loadout);
  const defusing = bots.find((b) => b.team === 'def' && b.alive && b.ai.state === 'defuse');
  const spec = bots.find((b) => b.id === player.spectateId);
  return {
    hp: player.hp,
    armor: player.loadout.armor,
    money: match.money,
    mag: w ? w.mag : 0,
    reserve: w ? w.reserve : 0,
    reloading: w ? w.reloading > 0 : false,
    scoreAtk: match.score.atk,
    scoreDef: match.score.def,
    round: match.round,
    timer: match.phase === 'buy' ? match.buyTimer : match.timer,
    phase: match.phase,
    spread: w ? currentSpread(w, player.isMoving, player.crouched, player.ads, player.scoped) : 0,
    alive: player.alive,
    scoped: player.scoped,
    chargeState: match.charge.state,
    chargeSite: match.charge.site,
    fuse: match.charge.plantT,
    carrying: match.charge.carrierId === 'player',
    progress: player.plantProgress > 0 ? player.plantProgress / MATCH.plantTime
      : defusing ? defusing.ai.defuseProgress / MATCH.defuseTime : 0,
    progressLabel: player.plantProgress > 0 ? 'PLANTING CHARGE…' : defusing ? 'ENEMY DEFUSING…' : '',
    spectating: !player.alive && !!spec,
    spectateName: spec ? spec.name : '',
  };
}

// ---- main loop ----
let lastTime = performance.now();
let accumulator = 0;
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    syncCamera();
    renderer.render(scene, camera);
    return;
  }
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
  }
  effects.update(dt);
  updateSiteBeacons(sites, match.charge);
  syncCamera();
  hud.update(hudSnapshot(), dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- deterministic demo shots (?shot=start|play|buy|end&seed=N) ----
function runShot(name) {
  hideTitle(hud);
  if (name === 'start') {
    showTitle(hud);
    worldTime = 8;
    syncCamera();
  } else if (name === 'buy') {
    match.money = 5200;
    startBuyPhase(match);
    spawnRound();
    buyMenu.show(match.money);
    player.pos.x = 0;
    player.pos.z = 16;
    player.yaw = 0;
    syncCamera();
  } else if (name === 'play') {
    match.money = 5200;
    player.loadout.primary = makeWeaponState('vk47');
    player.loadout.current = 'primary';
    setViewmodelWeapon('vk47');
    startBuyPhase(match);
    beginRound();
    // Stage the frame: player mid-map, two defenders in the lane ahead.
    player.pos.x = 0; player.pos.z = 14; player.yaw = 0; player.pitch = 0;
    const d0 = bots.find((b) => b.name === 'ASH');
    const d1 = bots.find((b) => b.name === 'CINDER');
    if (d0) { d0.pos.x = -2; d0.pos.z = -6; d0.yaw = Math.PI; d0.ai.state = 'hold'; syncMesh(d0, 0, false); }
    if (d1) { d1.pos.x = 5; d1.pos.z = -9; d1.yaw = Math.PI; d1.ai.state = 'hold'; syncMesh(d1, 0, false); }
    for (let i = 0; i < 30; i++) step(STEP);
    // Fire one burst at the defender ahead for a live tracer in the frame.
    player.yaw = Math.atan2(-(d0.pos.x - player.pos.x), -(d0.pos.z - player.pos.z));
    playerFire();
    step(STEP);
    hud.el.banner.hidden = true; // keep the frame clean for the cover
    syncCamera();
  } else if (name === 'end') {
    match.score.atk = 3;
    match.score.def = 2;
    startRound(match);
    spawnRound();
    showRoundEnd(hud, true, 'ENEMY TEAM ELIMINATED', 3, 2);
    player.pos.x = 0; player.pos.z = 14; player.yaw = 0;
    syncCamera();
  }
  // Render twice, then freeze and signal readiness.
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    effects.update(0.016);
    syncCamera();
    hud.update(hudSnapshot(), 0.016);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// ---- boot ----
showTitle(hud);
window.__game = {
  match, player,
  bots: () => bots,
  beginRound, buyItem,
  teleport(x, z, yaw) { player.pos.x = x; player.pos.z = z; if (yaw !== undefined) player.yaw = yaw; },
  fire() { playerFire(); },
};
if (DEMO_SHOT) runShot(DEMO_SHOT);
else requestAnimationFrame(frame);
