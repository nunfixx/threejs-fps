// YARD 9: turns the layout in config.js into three.js meshes, and owns all
// collision. Walls, crates and containers are axis-aligned boxes; movement and
// line-of-sight use the same AABB list, so what you see is what blocks you.
// Textures are drawn on a canvas at runtime — no image files, no network.
import * as THREE from 'three';
import { MAP } from './config.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 352;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d40';
  g.fillRect(0, 0, 512, 352);
  // asphalt speckle
  for (let i = 0; i < 5200; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgb(${v | 0},${(v + 3) | 0},${(v + 6) | 0})`;
    g.fillRect(Math.random() * 512, Math.random() * 352, 2, 2);
  }
  // painted lane guides (amber, worn)
  g.strokeStyle = 'rgba(214,164,60,0.55)';
  g.lineWidth = 3;
  g.setLineDash([18, 12]);
  g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 352); g.stroke();
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 352); g.stroke();
  g.beginPath(); g.moveTo(384, 0); g.lineTo(384, 352); g.stroke();
  g.setLineDash([]);
  // hazard border around each site
  g.strokeStyle = 'rgba(214,164,60,0.8)';
  g.lineWidth = 4;
  g.strokeRect(18, 18, 76, 76);
  g.strokeRect(418, 18, 76, 76);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function containerTexture(base) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 64);
  // corrugation ribs
  for (let x = 0; x < 128; x += 12) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x, 0, 4, 64);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x + 4, 0, 3, 64);
  }
  // rust streaks
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(60,30,10,${0.08 + Math.random() * 0.16})`;
    const x = Math.random() * 128;
    g.fillRect(x, Math.random() * 20, 2, 18 + Math.random() * 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelTexture(letter) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,22,26,0.72)';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#f0a830';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#f0a830';
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ray vs AABB (slab method), origin/dir as plain {x,y,z}. Returns t or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, 0, b.h],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (let i = 0; i < 3; i++) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Segment vs AABB: does the segment p->q pass through the box?
function segmentHitsAABB(ax, ay, az, bx, by, bz, b) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1;
  const axes = [
    [ax, dx, b.minX, b.maxX],
    [ay, dy, 0, b.h],
    [az, dz, b.minZ, b.maxZ],
  ];
  for (let i = 0; i < 3; i++) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function buildMap(scene) {
  const colliders = [];
  const box = (x, z, w, d, h, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    scene.add(mesh);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    return mesh;
  };

  // Sky, fog and light: late-afternoon yard, warm sun, cool fill.
  scene.background = new THREE.Color(0x9fb4c4);
  scene.fog = new THREE.Fog(0x9fb4c4, 55, 130);
  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x3a332a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
  sun.position.set(-30, 42, 18);
  scene.add(sun);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2 + 2, MAP.halfZ * 2 + 2),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Walls: concrete with a painted top stripe.
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8d9296 });
  const wallTopMat = new THREE.MeshLambertMaterial({ color: 0xd6a43c });
  for (const w of MAP.walls) {
    box(w.x, w.z, w.w, w.d, w.h, wallMat);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.18, w.d + 0.04), wallTopMat);
    stripe.position.set(w.x, w.h + 0.09, w.z);
    scene.add(stripe);
  }

  // Crates: wood tones.
  for (const c of MAP.crates) {
    box(c.x, c.z, c.w, c.d, c.h, new THREE.MeshLambertMaterial({ color: c.color }));
  }
  // Containers: corrugated, brighter, with a roof lip.
  for (const c of MAP.containers) {
    const mat = new THREE.MeshLambertMaterial({ map: containerTexture('#' + c.color.toString(16).padStart(6, '0')) });
    box(c.x, c.z, c.w, c.d, c.h, mat);
  }

  // Site markers: painted ring on the ground, a floating letter board, and a
  // beacon pillar whose colour shows the charge state (set by updateSites).
  const sites = {};
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.35, s.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xf0a830, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: labelTexture(key), transparent: true, side: THREE.DoubleSide }),
    );
    board.position.set(s.x, 4.6, s.z);
    scene.add(board);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 4.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.55 }),
    );
    beacon.position.set(s.x, 2.2, s.z);
    scene.add(beacon);
    sites[key] = { ...s, ring, board, beacon };
  }

  // Distant skyline silhouettes so the yard does not end in fog.
  const skyMat = new THREE.MeshLambertMaterial({ color: 0x6e7d8c });
  for (let i = 0; i < 14; i++) {
    const h = 8 + Math.random() * 18;
    const m = new THREE.Mesh(new THREE.BoxGeometry(6 + Math.random() * 8, h, 6), skyMat);
    const ang = (i / 14) * Math.PI * 2;
    m.position.set(Math.cos(ang) * 78, h / 2, Math.sin(ang) * 68);
    scene.add(m);
  }
  // Gantry crane over mid: two legs and a beam, the map's landmark.
  const craneMat = new THREE.MeshLambertMaterial({ color: 0xb3542e });
  for (const x of [-4, 4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.9), craneMat);
    leg.position.set(x, 6, 0);
    scene.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(14, 1.1, 1.4), craneMat);
  beam.position.set(0, 12, 0);
  scene.add(beam);

  return { colliders, sites };
}

// ---- collision & line of sight (pure math on the collider list) ----

// Move a circle (x, z, radius) against all colliders; mutates and returns pos.
export function moveCircle(pos, radius, colliders) {
  for (const b of colliders) {
    const nx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = pos.x - b.minX, pr = b.maxX - pos.x;
        const pt = pos.z - b.minZ, pb = b.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = b.minX - radius;
        else if (m === pr) pos.x = b.maxX + radius;
        else if (m === pt) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
  }
  return pos;
}

// Nearest wall hit along a ray, or Infinity. Origin/dir are {x,y,z}.
export function raycastWalls(ox, oy, oz, dx, dy, dz, maxDist, colliders) {
  let best = Infinity;
  for (const b of colliders) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b);
    if (t < best && t <= maxDist) best = t;
  }
  return best;
}

// True when the segment between two eye-level points is not blocked.
export function hasLOS(ax, ay, az, bx, by, bz, colliders) {
  for (const b of colliders) {
    if (segmentHitsAABB(ax, ay, az, bx, by, bz, b)) return false;
  }
  return true;
}

export function pointInSite(x, z, site) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz <= site.r * site.r;
}

// Beacon colours: idle amber, planted flashing red, defused green.
export function updateSiteBeacons(sites, charge) {
  for (const key of ['A', 'B']) {
    const s = sites[key];
    let color = 0xf0a830;
    let opacity = 0.55;
    if (charge.state === 'planted' && charge.site === key) {
      color = 0xff2a1a;
      opacity = 0.5 + 0.4 * Math.sin(performance.now() * 0.012);
    } else if (charge.state === 'defused' && charge.site === key) {
      color = 0x2aff66;
    }
    s.beacon.material.color.setHex(color);
    s.beacon.material.opacity = opacity;
    s.ring.material.color.setHex(color);
  }
}
