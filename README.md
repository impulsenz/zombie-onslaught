# Onslaught: Terraform

Real-time co-op base defense on an airless planet: hold the colony HQ against a rogue machine
civilization, mine down through four underground layers, and run the terraformer to 100%.
Players keep a persistent profile, and admins manage access from a dashboard.

## Quick start

```bash
npm install
cp .env.example .env      # set GOOGLE_CLIENT_ID, ADMIN_EMAILS, JWT_SECRET
npm start                 # builds Tailwind CSS, then serves http://localhost:3000
npm test                  # simulation + end-to-end tests
```

With no `DATABASE_URL`, data is stored in `data/db.json`. With `DEV_LOGIN=true` (ignored when
`NODE_ENV=production`) the login screen also has a name/email form, so you can test without Google.
Sign in with an email listed in `ADMIN_EMAILS` to become an admin.

## Architecture

```
shared/            Imported by server AND browser (ES modules)
  defs.js          All balance data: resources, weapons, enemies, structures, turrets, tech, robots, scaling
  geometry.js      Tile/circle collision used by server sim and client prediction
server/
  index.js         Express + Socket.io bootstrap, static hosting, error handling
  config.js        Env configuration (.env)
  auth.js          Google ID-token verification, JWT cookie sessions, RBAC middleware
  progression.js   Per-user serialized XP/points/level updates
  routes/          /api/auth/*, /api/me/*, /api/admin/* (admin-only)
  db/              Adapter facade: PostgreSQL (schema.sql) or JSON file store
  game/
    RoomManager.js Socket auth, rooms, quick-join, kicks banned users live
    GameRoom.js    Authoritative 30 Hz simulation + 15 Hz snapshots
    world.js       Surface + 4 underground layers, caves, ruins, flow-field pathfinding, spatial hash
    power.js       Wired power networks, batteries, priority load-shedding, turret energy
    sim/           enemies.js, structures.js, robots.js (mixed into GameRoom)
client/
  public/index.html, js/menu.js       Login, approval gate, profile, skills, armory, rooms
  public/game.html, js/game/*         Canvas renderer, HUD, input, prediction, audio
  views/admin.html, public/js/admin.js  Admin Control Panel (served only to admins)
```

**Networking model.** The server runs the whole game. Clients send only intent (`input`: move
vector, aim angle and fire/sprint/interact flags; `act`: build, upgrade, throw, and so on). The
server validates every action: range, cost, phase and whether the player is alive. Snapshots are
compact flat arrays. The client predicts its own movement with the shared collision code and
blends it toward the server position. Remote entities are smoothed between snapshots, so the game
renders at a steady 60 fps.

**Pathfinding.** A flow field is computed with Dijkstra from the HQ and rebuilt only when walls
change. A blocking structure costs `3 + hp/60` to path through, so machines route to the weakest
part of your defenses and attack it. Underground layers use the same collision; robots path with BFS.

**Auth and access.**
- **Sign-in:** Google Identity Services gives the browser an ID token. The server checks it with
  `google-auth-library` and then sets an httpOnly, SameSite=Lax JWT cookie.
- **Access modes:** in **whitelist** mode new accounts start as `pending` and need an admin's
  approval. In **blacklist** mode new accounts are approved automatically and admins can ban them.
  Admins can switch the mode from the dashboard.
- **Protections:** every admin action is written to `admin_logs`. A user who is banned or has
  access revoked is disconnected from their game immediately. The last admin cannot be demoted.

## Gameplay summary

| System | Details |
|---|---|
| Goal | Build Terraformers and keep them powered. Terraforming reaches 100% for a victory. The surface has no air: suits drain oxygen, refilled at the HQ or O2 Stations |
| Colony dome | The HQ projects a shield bubble with breathable air. It starts small (Mk1, 8.5 tiles) and nearly empty, and recharges slowly while the HQ has power. Machines and their shots can't cross the shell while it stands; they batter it until it breaks. Its colour shows charge: blue, amber below 40%, red below 10%, flickering out below 1%. You can only build inside it. Upgrade it at the HQ |
| Tractor Beam | Reels in salvage from destroyed machines across a wide radius |
| Character menu (C) | Suit upgrades bought with colony resources: mining laser, oxygen tank, backpack, armour and boots. Also explains how to play |
| Line of sight | Machines only chase and shoot colonists they can see; rock and unmined ore block the view and the shots. Bosses smash through walls (higher-level walls resist) |
| Developer tools | Admins press F9 in game: god mode, unlimited resources, game speed x1-x8, jump to a wave, skip to night or morning, spawn a boss, unlock research, max suit, finish construction |
| Day and night | Machines attack only at night. Each wave starts at dusk, and survivors retreat at dawn. About one night in five (from wave 2) is a swarm night: twice the machines, arriving in packs of 30-45. Pressing Ready skips ahead to dusk |
| Lift shaft | Press F at any lift to choose a level. The shaft starts at Depth 1; pay resources at a lift to bore it one level deeper. Lifts you build are extra stops Riding shows the cage dropping or rising. Every powered lift stop refills oxygen |
| Mining laser | Hold right mouse to fire straight ahead: it cuts the first rock in its path (raised rock on the surface, any rock underground) and burns machines. Upgrade it in the character menu |
| Storage | The HQ stores 2,000 of each resource. Each Warehouse adds 1,500 (more per level). Refining stops for a resource that is full |
| Map | Surface 448x336, underground 272x204 per depth. The minimap only shows ground the crew has explored. Machines march in from a ring about 70 tiles out. Up to 5 players; the crew panel shows everyone's ping |
| Mining | Hold right mouse to dig rock with the mining laser. Ore goes into your backpack and is unloaded automatically at the HQ or a powered elevator, then refined into resources. Deeper layers have better ore (copper/silicon → titanium → crystal → xenium) and harder rock |
| Underground | Build an elevator (F to ride, Shift+F to go up) to dig a shaft to the next depth. Natural caves and ruins hold dormant sentinels and constructs that wake up when you get close, plus caches with Ancient Data and turret modules |
| Logistics | Drills and borers fill buffers. Hauler bots carry ore to elevators and digger bots tunnel for you. Everything is refined at the surface |
| Enemies | A rogue AI civilization: crawlers, skitters, juggernauts, gunners that shoot back, cloaked phantoms and flying wasps. Bosses (Warden, Hive, Colossus) every 5th wave. Waves are about 10x the old size |
| Scaling | `S = 1 + 0.25 × (players − 1)` applied to HP, count and damage. 3 lives per wave, then spectate |
| Power | Start with 2 solar panels and a battery wired to the HQ. Solar follows the day/night cycle. Later sources: solar arrays, geothermal on vents, fusion. Wires (V) connect buildings within 9 tiles. Each network sheds load by priority (life support → turrets → logistics → industry): low batteries cause flicker, empty ones a blackout. Turrets also spend stored energy per shot Turrets draw only a trickle while idle and pay per shot; the colony base load scales with the dome level. The power panel graphs generation against actual draw for the last 60s Shadows move with the sun and solar panels swivel to follow it |
| Turrets | Lasers, arc coils, flak (AA), missile arrays (AA), plasma mortars and rail guns in S/M/L sizes. They look more elaborate at every level. The inspector (U or click) shows current stats and the gain from upgrading, kills, power and module slots (S1/M2/L3) |
| Walls | Alloy and titanium walls get a fence on outward-facing edges. Stairwells rotate with R and let you walk on walls, and S/M turrets mount on top |
| Research | The research lab spends resources and Ancient Data on 15 techs: large turrets, borers, robots, dig speed, terraformers and more |
| Robots | Salvage (collects wreck parts from destroyed machines), hauler, digger, repair and combat drones |
| Weather | Clear, dust (lower visibility and solar) and solar storms that hit unshielded buildings. Shield projectors protect what is inside the dome |
| Audio | Procedural WebAudio with separate master/effects/music/ambience volumes (Esc menu) and adaptive music for building, battle, bosses and underground |
| Starting stockpile | 1,500 Iron, 300 Copper, 120 Silicon. Four 2x2 solar panels and three batteries (`START_RESOURCES` in `shared/defs.js`) |
| RPG | XP and points from kills, waves and building. Skill points go into five stats; points unlock weapons permanently |

## Roadmap

The planned redesign (crashed-ship HQ, escape goal, battery roles, classes, mechs and more) is laid out in phases in [ROADMAP.md](ROADMAP.md).

## Production notes

- Set `NODE_ENV=production`, a strong `JWT_SECRET`, `DATABASE_URL`, and `PUBLIC_URL` (https) behind a TLS proxy.
- Add `PUBLIC_URL` to the OAuth client's *Authorized JavaScript origins* in Google Cloud Console.
- Rooms live in memory on one Node process. To run more than one instance, use sticky sessions and
  the Socket.io Redis adapter, and pin each room to one instance.
