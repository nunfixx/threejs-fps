# SCRAPLINE — a three.js tactical FPS

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/nunfixx/threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/nunfixx/threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A round-based tactical FPS that runs entirely in the browser on three.js 0.187.0 — no build step, no network requests, single-player against bots.

## The game

You are **VANGUARD**, attacking a container yard called **YARD 9** against **EMBER**. Five versus five, first to 8 rounds takes the match.

- **Objective:** plant the breach charge at Crane Bay (A) or Furnace (B) — hold E inside a site — then defend it until it detonates. Or eliminate the whole enemy team. Defenders win by stopping the plant, defusing a planted charge, or running the 100-second clock out.
- **Economy:** start with $800, earn $300 per kill and $300 for the plant, $3,250 for a round win and $1,900+ for a loss. Spend it in the buy menu between rounds.
- **Arsenal:** P9 sidearm (free), HAIL SMG ($1,500), SCATTER-12 shotgun ($1,700), VK-47 rifle ($2,700), LONGSHOT scoped marksman rifle ($4,750), plus a vest ($650) and POPPER fragmentation grenades ($300).
- **Gunplay where accuracy counts:** recoil and bloom punish spraying, movement widens the cone, crouching and aiming tighten it, headshots multiply damage (up to 4x on the VK-47). The LONGSHOT zooms with a real scope overlay.
- **Bots with real AI:** they follow waypoint routes through three lanes, hold posts, rotate on the sound of gunfire, investigate noise, fight in bursts with reaction time and aim error, plant the charge when they carry it and defuse when it is planted. If you die, you spectate a teammate while the round plays out.
- **The map:** an original container yard — gantry crane over mid, two bomb sites, crates and containers for cover, painted lane guides, a skyline beyond the fence.
- **Sound:** every sound is synthesized with WebAudio — per-weapon gunshots, footsteps, reload clicks, plant beeps, the detonation, round horns.

## Controls

WASD move · Mouse aim · Click fire · Right-click aim / scope · R reload · 1/2 switch weapon · G throw grenade · E (hold) plant · B buy menu · Ctrl crouch · Space jump

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

Static files under `game/` — serve them with any static file server. `main.ts` hands the game in: it copies `game/` and `screenshots/` to the output and writes `dossier.json` with the vendored make.fun library.

## Layout

- `game/index.html` — the page, HUD DOM and import map (`three` → vendored three.module.min.js)
- `game/src/main.js` — boot, fixed 60 Hz simulation loop, player controller, viewmodel, round flow
- `game/src/config.js` — weapons, economy, teams, map layout, waypoint graph
- `game/src/map.js` — the yard: meshes, canvas textures, collision and line of sight
- `game/src/bots.js` — bot AI: routes, perception, burst fire, plant/defuse, hearing
- `game/src/combat.js` — hitscan resolution (ray vs capsule/sphere), damage, pooled effects
- `game/src/weapons.js` — spread/recoil/bloom model, reloads, grenade physics
- `game/src/state.js` — match state machine, score, economy
- `game/src/hud.js` — HUD, kill feed, buy menu, overlays
- `game/src/audio.js` — procedural WebAudio sounds
- `game/src/input.js` — keyboard, mouse, pointer lock

Screenshots in `screenshots/` are real renders of the game's own code: `1-start.jpg` (title), `2-play.jpg` (mid-round combat), `3-buy.jpg` (buy menu), `4-end.jpg` (round won). They can be retaken with `?shot=start|play|buy|end&seed=N`.

## License

MIT — see [LICENSE](LICENSE).
