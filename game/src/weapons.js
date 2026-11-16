// Weapons: per-combatant weapon state and the firing model.
// Accuracy is the game: spread grows with movement and sustained fire
// (bloom), recoil kicks the aim up and recovers, ADS tightens the cone,
// headshots multiply damage. All angles in degrees, converted at the edge.
import { WEAPONS } from './config.js';

export function makeWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    id: weaponId,
    def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: 0, // seconds left, 0 = not reloading
    cooldown: 0, // seconds until the next shot may fire
    bloom: 0, // extra spread in degrees from sustained fire
    triggerHeld: false,
    firedOnce: false, // for semi-auto edge detection
  };
}

export function makeLoadout(primaryId) {
  return {
    primary: primaryId ? makeWeaponState(primaryId) : null,
    sidearm: makeWeaponState('p9'),
    grenades: 0,
    armor: 0, // 0..100 vest points
    current: primaryId ? 'primary' : 'sidearm',
  };
}

export function currentWeapon(loadout) {
  return loadout.current === 'primary' ? loadout.primary : loadout.sidearm;
}

export function switchWeapon(loadout, slot) {
  if (slot === 'primary' && loadout.primary) loadout.current = 'primary';
  if (slot === 'sidearm') loadout.current = 'sidearm';
}

// Current spread cone (half-angle, degrees) for this shooter.
export function currentSpread(w, moving, crouched, aiming, scoped) {
  const def = w.def;
  let s = def.spread + w.bloom;
  if (moving) s += def.moveSpread;
  if (crouched) s *= 0.7;
  if (aiming) s *= def.adsSpreadMult;
  if (scoped) s *= 0.5;
  return s;
}

// Tick timers. Returns true when a reload just finished.
export function tickWeapon(w, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.bloom > 0) w.bloom = Math.max(0, w.bloom - dt * 7);
  if (w.reloading > 0) {
    w.reloading -= dt;
    if (w.reloading <= 0) {
      w.reloading = 0;
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      return true;
    }
  }
  return false;
}

export function startReload(w) {
  if (w.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloading = w.def.reloadTime;
  return true;
}

// Can this weapon fire right now? (auto weapons fire while held; semi-auto
// fires once per press — the caller tracks triggerHeld.)
export function canFire(w, nowHeld) {
  if (w.reloading > 0 || w.cooldown > 0 || w.mag <= 0) return false;
  if (!w.def.auto && nowHeld && w.firedOnce) return false;
  return true;
}

// Consume one shot: ammo, cooldown, bloom. Returns pellets to simulate.
export function consumeShot(w) {
  w.mag -= 1;
  w.cooldown = 60 / w.def.fireRate;
  w.bloom = Math.min(6, w.bloom + w.def.recoil * 0.9);
  w.firedOnce = true;
  return w.def.pellets;
}

// ---- grenades ----
export function makeGrenade(pos, vel) {
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: vel.x, y: vel.y, z: vel.z },
    fuse: 2.2,
    bounced: 0,
  };
}

// Step a grenade: gravity, bounce off colliders and the ground. Returns
// 'explode' when the fuse runs out, 'bounce' on a bounce, null otherwise.
export function stepGrenade(g, dt, colliders) {
  g.fuse -= dt;
  g.vel.y -= 12.5 * dt;
  g.pos.x += g.vel.x * dt;
  g.pos.y += g.vel.y * dt;
  g.pos.z += g.vel.z * dt;
  let bounced = false;
  if (g.pos.y < 0.12) {
    g.pos.y = 0.12;
    if (Math.abs(g.vel.y) > 1.2) bounced = true;
    g.vel.y = Math.abs(g.vel.y) * 0.45;
    g.vel.x *= 0.7;
    g.vel.z *= 0.7;
  }
  for (const b of colliders) {
    if (g.pos.y > b.h) continue;
    if (g.pos.x > b.minX - 0.12 && g.pos.x < b.maxX + 0.12 &&
        g.pos.z > b.minZ - 0.12 && g.pos.z < b.maxZ + 0.12) {
      // Push out along the smallest penetration and reflect that axis.
      const pl = g.pos.x - (b.minX - 0.12), pr = (b.maxX + 0.12) - g.pos.x;
      const pt = g.pos.z - (b.minZ - 0.12), pb = (b.maxZ + 0.12) - g.pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) { g.pos.x = b.minX - 0.12; g.vel.x = -Math.abs(g.vel.x) * 0.5; }
      else if (m === pr) { g.pos.x = b.maxX + 0.12; g.vel.x = Math.abs(g.vel.x) * 0.5; }
      else if (m === pt) { g.pos.z = b.minZ - 0.12; g.vel.z = -Math.abs(g.vel.z) * 0.5; }
      else { g.pos.z = b.maxZ + 0.12; g.vel.z = Math.abs(g.vel.z) * 0.5; }
      bounced = true;
    }
  }
  if (bounced) g.bounced += 1;
  if (g.fuse <= 0) return 'explode';
  return bounced ? 'bounce' : null;
}
