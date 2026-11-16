// Bots: the other nine combatants. Each bot runs a small state machine over a
// waypoint graph: move along routes, hold a post, fight what it sees, plant
// the charge (attackers) or defuse it (defenders), and investigate gunshots it
// hears. Aiming is error-based with a reaction time and burst fire, so bots
// are dangerous but beatable — and they miss a moving target.
import * as THREE from 'three';
import { WAYPOINTS, WAY_EDGES, DEFEND_POSTS, BOT_NAMES, MOVE } from './config.js';
import { makeLoadout, currentWeapon, tickWeapon, startReload, canFire, consumeShot, currentSpread } from './weapons.js';
import { moveCircle, hasLOS, pointInSite } from './map.js';
import { traceShot, applyDamage, spreadDir } from './combat.js';

// Adjacency list for the waypoint graph (built once).
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of WAY_EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// BFS shortest path of node indices from `from` to `to`.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const n = queue.shift();
    for (const m of ADJ[n]) {
      if (prev[m] === -1) {
        prev[m] = n;
        if (m === to) {
          const path = [to];
          let c = to;
          while (c !== from) { c = prev[c]; path.unshift(c); }
          return path;
        }
        queue.push(m);
      }
    }
  }
  return [to];
}

export function buildBotMesh(teamColor) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: teamColor });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc9a06a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.32), mat);
  torso.position.y = 1.02;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.36), dark);
  vest.position.y = 1.05;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.56;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.05), dark);
  visor.position.set(0, 1.58, 0.16);
  g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.22), dark);
  legL.position.set(-0.15, 0.34, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), dark);
  gun.position.set(0.22, 1.18, 0.3);
  g.add(gun);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.5), mat);
  arm.position.set(0.22, 1.2, 0.12);
  g.add(arm);
  return { group: g, legL, legR, torso, head };
}

export function createBot(id, name, team, x, z, weaponId, mesh) {
  return {
    id, name, team, isPlayer: false,
    pos: { x, y: 0, z },
    yaw: team === 'atk' ? 0 : Math.PI, // attackers face north (-z), defenders south
    pitch: 0,
    hp: 100, alive: true,
    loadout: makeLoadout(weaponId),
    mesh,
    vel: { x: 0, z: 0 },
    walkPhase: 0,
    ai: {
      state: 'move',
      path: [], pathIdx: 0,
      target: null, aimTime: 0, reaction: 0.4,
      burstLeft: 0, burstPause: 0,
      site: null, role: 'support',
      holdNode: -1, holdYaw: 0, holdUntil: 0,
      investigate: null,
      plantProgress: 0, defuseProgress: 0,
      nextThink: 0, nextPerceive: 0,
      strafeDir: 1, strafeUntil: 0,
      lastShotHeard: 0,
    },
  };
}

// Assign round roles: attackers pick a site (carrier plants), defenders posts.
export function assignRoles(bots, rng) {
  const atks = bots.filter((b) => b.team === 'atk' && b.alive);
  const defs = bots.filter((b) => b.team === 'def' && b.alive);
  const site = rng() < 0.5 ? 'A' : 'B';
  atks.forEach((b, i) => {
    b.ai.site = i < 3 ? site : (site === 'A' ? 'B' : 'A');
    b.ai.role = i === 0 ? 'carrier' : 'support';
    b.ai.state = 'move';
    b.ai.path = [];
    b.ai.pathIdx = 0;
  });
  defs.forEach((b, i) => {
    const post = DEFEND_POSTS[i % DEFEND_POSTS.length];
    b.ai.holdNode = post.node;
    b.ai.site = post.site;
    b.ai.role = 'holder';
    b.ai.state = 'move';
    b.ai.path = [];
    b.ai.pathIdx = 0;
  });
}

// ---- perception ----
function perceive(bot, world) {
  let best = null;
  let bestD = 48;
  const eyeY = bot.pos.y + 1.52;
  for (const other of world.bots) {
    if (!other.alive || other.team === bot.team) continue;
    const dx = other.pos.x - bot.pos.x;
    const dz = other.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) continue;
    // Must be roughly in front (bots have a 200-degree view cone).
    const ang = Math.atan2(-dx, -dz); // yaw that faces the other bot
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.9 && d > 4) continue;
    if (!hasLOS(bot.pos.x, eyeY, bot.pos.z, other.pos.x, other.pos.y + 1.2, other.pos.z, world.colliders)) continue;
    best = other;
    bestD = d;
  }
  return best;
}

function faceToward(bot, tx, tz, dt, rate) {
  const want = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  bot.yaw += step;
  return Math.abs(diff) < 0.05;
}

// One bot shot: spread by aim error, trace, damage, effects via world hooks.
function botFire(bot, world) {
  const w = currentWeapon(bot.loadout);
  if (!canFire(w, true)) return;
  if (w.mag <= 0) { startReload(w); return; }
  consumeShot(w);
  const target = bot.ai.target;
  const eye = { x: bot.pos.x, y: bot.pos.y + 1.52, z: bot.pos.z };
  // Aim point: chest with error that shrinks as the bot settles on target.
  const aimErr = Math.max(1.5, 5.2 - bot.ai.aimTime * 2.2) + (target && target.isMoving ? 0.8 : 0);
  const tx = target ? target.pos.x : bot.pos.x - Math.sin(bot.yaw) * 10;
  const ty = target ? target.pos.y + 1.15 + (world.rng() - 0.5) * 0.5 : eye.y;
  const tz = target ? target.pos.z : bot.pos.z - Math.cos(bot.yaw) * 10;
  const base = { x: tx - eye.x, y: ty - eye.y, z: tz - eye.z };
  const bl = Math.hypot(base.x, base.y, base.z) || 1;
  base.x /= bl; base.y /= bl; base.z /= bl;
  const dir = spreadDir(base, aimErr, world.rng, { x: 0, y: 0, z: 0 });
  const hit = traceShot(eye, dir, w.def.range, world.colliders, world.bots, bot.id);
  const dist = hit.t;
  world.onShotFired(bot, eye, hit.point, w.def.tracer, dist);
  if (hit.kind === 'bot') {
    if (hit.bot.team === bot.team) {
      world.onImpact(hit.point);
      return; // no friendly fire
    }
    const dmg = w.def.damage * (hit.part === 'head' ? w.def.headMult : 1);
    const dealt = applyDamage(hit.bot, dmg);
    world.onDamage(hit.bot, dealt, bot, hit.part === 'head');
    if (!hit.bot.alive) world.onKill(bot, hit.bot, hit.part === 'head');
  } else if (hit.kind === 'wall') {
    world.onImpact(hit.point);
  }
}

// ---- main bot step (called at the fixed 60 Hz step) ----
export function updateBot(bot, dt, world) {
  if (!bot.alive) { syncMesh(bot, dt, false); return; } // fall over and stay down
  const ai = bot.ai;
  const w = currentWeapon(bot.loadout);
  tickWeapon(w, dt);
  if (w.mag === 0 && w.reloading <= 0) startReload(w);

  // Perception (10 Hz): find the nearest visible enemy.
  ai.nextPerceive -= dt;
  if (ai.nextPerceive <= 0) {
    ai.nextPerceive = 0.15;
    const seen = perceive(bot, world);
    if (seen && !ai.target) {
      ai.reaction = 0.5 + world.rng() * 0.35;
      ai.aimTime = 0;
      ai.burstLeft = 0;
      ai.burstPause = 0;
    }
    if (seen) {
      ai.target = seen;
      ai.target.lastSeen = world.time;
    } else if (ai.target && world.time - (ai.target.lastSeen || 0) > 0.6) {
      ai.target = null;
    }
  }
  const inCombat = !!ai.target;

  // Hearing: a recent gunshot nearby pulls idle bots to investigate.
  ai.nextThink -= dt;
  if (ai.nextThink <= 0) {
    ai.nextThink = 0.25;
    if (!inCombat && ai.state !== 'plant' && ai.state !== 'defuse') {
      for (let i = world.noise.length - 1; i >= 0; i--) {
        const n = world.noise[i];
        if (world.time - n.at > 2) continue;
        const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
        if (d < 26 && d > 6) {
          const node = nearestNode(n.x, n.z);
          ai.path = findPath(nearestNode(bot.pos.x, bot.pos.z), node);
          ai.pathIdx = 0;
          ai.state = 'investigate';
          ai.holdUntil = world.time + 3;
          break;
        }
      }
    }
  }

  // ---- plant / defuse ----
  const charge = world.charge;
  if (bot.team === 'atk' && charge.carrierId === bot.id && charge.state === 'carried' && !inCombat) {
    const site = world.sites[ai.site];
    if (site && pointInSite(bot.pos.x, bot.pos.z, site)) {
      ai.state = 'plant';
      ai.plantProgress += dt;
      world.onPlantProgress(bot, ai.plantProgress);
      if (ai.plantProgress >= 3.5) {
        ai.plantProgress = 0;
        ai.state = 'move';
        world.onPlant(ai.site, bot);
      }
      syncMesh(bot, dt, false);
      return;
    }
  } else {
    ai.plantProgress = 0;
  }
  if (bot.team === 'def' && charge.state === 'planted' && !inCombat) {
    const site = world.sites[charge.site];
    if (site && pointInSite(bot.pos.x, bot.pos.z, site)) {
      ai.state = 'defuse';
      ai.defuseProgress += dt;
      world.onDefuseProgress(bot, ai.defuseProgress);
      if (ai.defuseProgress >= 5) {
        ai.defuseProgress = 0;
        ai.state = 'move';
        world.onDefuse(bot);
      }
      syncMesh(bot, dt, false);
      return;
    }
  } else {
    ai.defuseProgress = 0;
  }

  // ---- combat ----
  if (inCombat) {
    const t = ai.target;
    faceToward(bot, t.pos.x, t.pos.z, dt, 7);
    ai.aimTime += dt;
    // Strafe sideways while fighting.
    if (world.time > ai.strafeUntil) {
      ai.strafeDir = world.rng() < 0.5 ? -1 : 1;
      ai.strafeUntil = world.time + 0.5 + world.rng() * 0.7;
    }
    const moving = ai.aimTime > 0.3;
    if (moving) {
      const sx = Math.cos(bot.yaw) * ai.strafeDir;
      const sz = -Math.sin(bot.yaw) * ai.strafeDir;
      bot.pos.x += sx * 2.1 * dt;
      bot.pos.z += sz * 2.1 * dt;
      moveCircle(bot.pos, MOVE.radius, world.colliders);
    }
    bot.isMoving = moving;
    if (ai.aimTime >= ai.reaction) {
      if (ai.burstLeft > 0) {
        botFire(bot, world);
        ai.burstLeft -= 1;
        if (ai.burstLeft === 0) ai.burstPause = 0.6 + world.rng() * 0.7;
      } else {
        ai.burstPause -= dt;
        if (ai.burstPause <= 0) {
          ai.burstLeft = w.def.auto ? 3 + Math.floor(world.rng() * 3) : 1;
        }
      }
    }
    syncMesh(bot, dt, moving);
    return;
  }
  bot.isMoving = false;

  // ---- navigation ----
  if (ai.state === 'hold') {
    // Scan the lane slowly; re-check for a post change on plant.
    bot.yaw += Math.sin(world.time * 0.5 + bot.id) * 0.25 * dt;
    if (charge.state === 'planted' && bot.team === 'def') {
      const node = nearestNode(world.sites[charge.site].x, world.sites[charge.site].z);
      ai.path = findPath(nearestNode(bot.pos.x, bot.pos.z), node);
      ai.pathIdx = 0;
      ai.state = 'move';
    }
    syncMesh(bot, dt, false);
    return;
  }
  if (ai.state === 'investigate' && ai.pathIdx >= ai.path.length) {
    bot.yaw += dt * 1.2; // look around
    if (world.time > ai.holdUntil) {
      ai.state = bot.team === 'def' ? 'move' : 'move';
      ai.path = findPath(nearestNode(bot.pos.x, bot.pos.z), bot.team === 'def' ? ai.holdNode : nearestNode(world.sites[ai.site].x, world.sites[ai.site].z));
      ai.pathIdx = 0;
    }
    syncMesh(bot, dt, false);
    return;
  }
  // Pick a destination when there is no path.
  if (ai.pathIdx >= ai.path.length) {
    let dest;
    if (bot.team === 'atk') {
      if (charge.state === 'planted') {
        // Attackers fall back to guard the planted charge.
        dest = nearestNode(world.sites[charge.site].x, world.sites[charge.site].z);
      } else {
        dest = nearestNode(world.sites[ai.site].x, world.sites[ai.site].z);
      }
    } else if (charge.state === 'planted') {
      dest = nearestNode(world.sites[charge.site].x, world.sites[charge.site].z);
    } else {
      dest = ai.holdNode;
    }
    ai.path = findPath(nearestNode(bot.pos.x, bot.pos.z), dest);
    ai.pathIdx = 0;
    if (ai.path.length <= 1) {
      ai.state = 'hold';
      syncMesh(bot, dt, false);
      return;
    }
  }
  // Walk to the next waypoint.
  const node = WAYPOINTS[ai.path[ai.pathIdx]];
  const dx = node.x - bot.pos.x;
  const dz = node.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) {
    ai.pathIdx += 1;
  } else {
    faceToward(bot, node.x, node.z, dt, 6);
    const sp = 3.4;
    bot.pos.x += (dx / d) * sp * dt;
    bot.pos.z += (dz / d) * sp * dt;
    moveCircle(bot.pos, MOVE.radius, world.colliders);
    bot.isMoving = true;
  }
  syncMesh(bot, dt, bot.isMoving);
}

// Keep the three.js mesh on the bot: position, facing, walk cycle, death pose.
export function syncMesh(bot, dt, moving) {
  const m = bot.mesh;
  if (!m) return;
  m.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
  if (!bot.alive) {
    m.group.rotation.set(0, bot.yaw, Math.PI / 2);
    m.group.position.y = 0.25;
    return;
  }
  m.group.rotation.set(0, bot.yaw, 0);
  if (moving) {
    bot.walkPhase += dt * 9;
    const s = Math.sin(bot.walkPhase) * 0.45;
    m.legL.rotation.x = s;
    m.legR.rotation.x = -s;
  } else {
    m.legL.rotation.x *= 0.8;
    m.legR.rotation.x *= 0.8;
  }
}
