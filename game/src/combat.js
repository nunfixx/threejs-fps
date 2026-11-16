// Combat: hitscan resolution and damage. Hit math is analytic (ray vs body
// capsule and head sphere, ray vs map AABBs) so a shot is decided by geometry,
// not by three.js raycasting. Visual effects (tracers, sparks, blasts) live
// here too, pooled so the hot loop allocates nothing per frame.
import * as THREE from 'three';
import { raycastWalls } from './map.js';

const _dir = { x: 0, y: 0, z: 0 };

// Closest approach between a ray (o + t*d, t >= 0) and a segment (a->b).
// Returns the ray parameter t at closest approach, or -1 if farther than r.
function raySegmentT(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = dx * dx + dy * dy + dz * dz; // 1 for a unit dir
  const b = dx * ux + dy * uy + dz * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const den = a * c - b * b;
  let sc = 0;
  let tc = 0;
  if (den > 1e-9) {
    sc = (b * e - c * d) / den;
    tc = (a * e - b * d) / den;
  } else {
    tc = 0;
  }
  if (sc < 0) sc = 0;
  if (tc < 0) tc = 0;
  else if (tc > 1) tc = 1;
  // Recompute sc with tc clamped.
  sc = b * tc - d;
  if (sc < 0) sc = 0;
  const px = ox + dx * sc - (ax + ux * tc);
  const py = oy + dy * sc - (ay + uy * tc);
  const pz = oz + dz * sc - (az + uz * tc);
  const dist2 = px * px + py * py + pz * pz;
  return dist2 <= r * r ? sc : -1;
}

// Ray vs sphere. Returns t or -1.
function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 ? t : -1;
}

// One pellet from eye (o) along unit dir (d). Returns the first thing hit:
// { kind: 'bot', bot, part: 'head'|'body', t, point } or
// { kind: 'wall', t, point } or { kind: 'none', t: maxDist, point }.
export function traceShot(o, d, maxDist, colliders, bots, selfId) {
  const tWall = raycastWalls(o.x, o.y, o.z, d.x, d.y, d.z, maxDist, colliders);
  let bestT = tWall;
  let best = null;
  for (const bot of bots) {
    if (!bot.alive || bot.id === selfId) continue;
    const p = bot.pos;
    // Head sphere first (it beats the body capsule on overlap).
    const th = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 1.52, p.z, 0.24);
    if (th >= 0 && th < bestT && th <= maxDist) {
      bestT = th;
      best = { kind: 'bot', bot, part: 'head', t: th };
    }
    const tb = raySegmentT(o.x, o.y, o.z, d.x, d.y, d.z,
      p.x, p.y + 0.15, p.z, p.x, p.y + 1.35, p.z, 0.38);
    if (tb >= 0 && tb < bestT && tb <= maxDist) {
      bestT = tb;
      best = { kind: 'bot', bot, part: 'body', t: tb };
    }
  }
  // Clamp the impact point: with no hit in range the ray ends at maxDist,
  // never at Infinity (an infinite point would poison the tracer geometry).
  const t = Math.min(bestT, maxDist);
  const point = {
    x: o.x + d.x * t,
    y: o.y + d.y * t,
    z: o.z + d.z * t,
  };
  if (best) {
    best.point = point;
    return best;
  }
  if (tWall <= maxDist) return { kind: 'wall', t: tWall, point };
  return { kind: 'none', t: maxDist, point };
}

// Apply damage with armor (vest absorbs half, eating vest points first).
// Returns the damage actually dealt to health.
export function applyDamage(target, raw) {
  let dmg = raw;
  if (target.loadout.armor > 0) {
    const absorbed = Math.min(target.loadout.armor, dmg * 0.5);
    target.loadout.armor -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return dmg;
}

// Random direction inside a cone of half-angle `spreadDeg` around dir.
export function spreadDir(dir, spreadDeg, rng, out) {
  const spread = (spreadDeg * Math.PI) / 180;
  const a = rng() * Math.PI * 2;
  const r = Math.tan(spread) * Math.sqrt(rng());
  // Orthonormal basis around dir.
  const ux = Math.abs(dir.y) < 0.99 ? 0 : 1;
  const uy = Math.abs(dir.y) < 0.99 ? 1 : 0;
  const uz = 0;
  let bx = dir.y * uz - dir.z * uy;
  let by = dir.z * ux - dir.x * uz;
  let bz = dir.x * uy - dir.y * ux;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  const cx = dir.y * bz - dir.z * by;
  const cy = dir.z * bx - dir.x * bz;
  const cz = dir.x * by - dir.y * bx;
  const ox = dir.x + (bx * Math.cos(a) + cx * Math.sin(a)) * r;
  const oy = dir.y + (by * Math.cos(a) + cy * Math.sin(a)) * r;
  const oz = dir.z + (bz * Math.cos(a) + cz * Math.sin(a)) * r;
  const ol = Math.hypot(ox, oy, oz) || 1;
  out.x = ox / ol; out.y = oy / ol; out.z = oz / ol;
  return out;
}

// ---- pooled visual effects: tracers, impact sparks, explosions ----
// A fixed pool of line/point objects is reused; nothing is allocated per shot.
export function createEffects(scene) {
  const TRACERS = 24;
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  const SPARKS = 12;
  const sparks = [];
  for (let i = 0; i < SPARKS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.14, transparent: true, opacity: 0 });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    sparks.push({ pts, life: 0, vel: new Float32Array(30) });
  }
  let sparkIdx = 0;

  // One reusable blast sphere + light for grenade explosions.
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xff7733, transparent: true, opacity: 0 });
  const blast = new THREE.Mesh(blastGeo, blastMat);
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(0xff8844, 0, 18, 1.6);
  scene.add(blastLight);
  let blastLife = 0;

  // Muzzle flash light reused by the player's viewmodel.
  const flash = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  scene.add(flash);
  let flashLife = 0;

  return {
    tracer(from, to, color) {
      const t = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % TRACERS;
      const pos = t.line.geometry.attributes.position.array;
      pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
      pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.color.setHex(color);
      t.line.material.opacity = 0.9;
      t.line.visible = true;
      t.life = 0.07;
    },
    impact(point) {
      const s = sparks[sparkIdx];
      sparkIdx = (sparkIdx + 1) % SPARKS;
      const pos = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < 10; i++) {
        pos[i * 3] = point.x;
        pos[i * 3 + 1] = point.y;
        pos[i * 3 + 2] = point.z;
        const a = Math.random() * Math.PI * 2;
        const b = Math.random() * Math.PI - Math.PI / 2;
        const sp = 2 + Math.random() * 3;
        s.vel[i * 3] = Math.cos(a) * Math.cos(b) * sp;
        s.vel[i * 3 + 1] = Math.sin(b) * sp + 1.5;
        s.vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * sp;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = 1;
      s.pts.visible = true;
      s.life = 0.35;
    },
    explosion(point) {
      blast.position.set(point.x, point.y + 0.4, point.z);
      blast.visible = true;
      blastLife = 0.5;
      blastLight.position.copy(blast.position);
      blastLight.intensity = 60;
    },
    muzzle(point) {
      flash.position.set(point.x, point.y, point.z);
      flash.intensity = 14;
      flashLife = 0.05;
    },
    update(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (const s of sparks) {
        if (s.life > 0) {
          s.life -= dt;
          const pos = s.pts.geometry.attributes.position.array;
          for (let i = 0; i < 10; i++) {
            pos[i * 3] += s.vel[i * 3] * dt;
            pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
            pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
            s.vel[i * 3 + 1] -= 9 * dt;
          }
          s.pts.geometry.attributes.position.needsUpdate = true;
          s.pts.material.opacity = Math.max(0, s.life / 0.35);
          if (s.life <= 0) s.pts.visible = false;
        }
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const k = 1 - blastLife / 0.5;
        const r = 0.6 + k * 4.4;
        blast.scale.set(r, r, r);
        blastMat.opacity = Math.max(0, 0.85 * (1 - k));
        blastLight.intensity = Math.max(0, 60 * (1 - k));
        if (blastLife <= 0) { blast.visible = false; blastLight.intensity = 0; }
      }
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) flash.intensity = 0;
      }
    },
  };
}
