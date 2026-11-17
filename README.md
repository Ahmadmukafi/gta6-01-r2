# NEON SHORE

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Ahmadmukafi/gta6-01-r2/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Ahmadmukafi/gta6-01-r2/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game for the make.fun **gta6-01** bounty — a sun-soaked
coastal city that turns neon at night, built from scratch in raw WebGL with no
libraries and no network requests. Everything is our own: the city, characters,
vehicles, names, story, art, sound and music.

## The city

Neon Shore is a 9×9-block coastal city: a downtown of tall towers with glowing
neon signs, a beach boulevard with palms, a pier with a turning ferris wheel,
a park, a marina with boats, and a garage that doubles as your safehouse.

## What you can do

- **Explore on foot and by car** — steal any parked or traffic car (press E) and
  drive it with arcade physics, handbrake drifts and damage smoke.
- **RUSH** — hold Shift while driving: time slows to 35%, the world goes cold blue,
  and the meter refills on drifts and near-misses.
- **Wanted system** — 0 to 5 stars. The NSPD sends patrol cars and foot cops;
  lose them by breaking line of sight, or get BUSTED. Get shot down and you are WASTED.
- **Five story missions** — Mara Voss, Ines Duarte and Dario Kane hand you jobs:
  a pier pickup, a stolen Comet GT, a hot drop, a timed Neon Run, and the downtown
  bank heist. Dialogue, objectives, a live minimap marker and autosave on completion.
- **Side work** — taxi fares (steal a taxi, pick up the waving passenger) and
  12 golden palms hidden around the city, $50 each.
- **Combat** — fists (F) and a pistol (click to shoot, R to reload).
- **HUD + live minimap** — stars, cash, health/armor, ammo, clock, radio, speed,
  RUSH meter, objective + distance, and a minimap with player, police, mission
  and fare blips.
- **Day/night cycle** — golden hour, dusk, neon night with lit windows;
  two procedural radio stations (SOL FM, NEON FM) and synthesized engine, siren
  and gunshot sounds. Start screen, pause menu, and localStorage saves.

## Controls

WASD move/drive · E enter car / talk · F punch · Click shoot · R reload ·
Space handbrake · Shift RUSH (driving) / sprint (on foot) · Q radio · M mute ·
Esc pause · drag mouse to look, scroll to zoom.

## Play it

Serve `game/` with any static HTTP server and open `game/index.html`
(`node serve.ts`, then http://localhost:8080). No build step, no network.

## License

MIT — see LICENSE.
