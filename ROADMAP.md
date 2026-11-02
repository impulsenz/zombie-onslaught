# Roadmap

This is the redesign the game is heading toward: escape from the planet in a repaired crashed ship.
It is split into phases so that each one ends with a playable build. **Done** lists what is already in
the game; each phase lists what is left.

## Done

- **Day and night.** Machines attack only at night. Survivors retreat at dawn, and about one night in
  five is a swarm night.
- **Waves.** Huge waves. Bosses smash through walls; higher-level walls take less damage.
- **Line of sight.** Machines can't see or shoot through rock, ore or unmined blocks.
- **Colony dome.** The dome blocks walkers, flyers and shots at its shell. Its colour shows charge:
  blue, amber below 40% and red below 10%, and it flickers out below 1%. Impacts flash on the shell.
  Buildings decompress after the dome fails. You can only build inside it.
- **Power.** The power panel graphs generation against actual draw. Turrets idle on a trickle and pay
  per shot.
- **Mining.** The mining laser is aimed and cuts whatever is in front of you. A tractor beam reels in
  salvage. Warehouses add storage.
- **Lift shaft.** A level picker, paying to bore deeper, a ride animation and oxygen refill at every lift.
- **Character menu (C).** Suit upgrades: mining laser, oxygen tank, backpack, armour and boots.
- **Lighting.** Sun shadows move through the day, and solar panels track the sun on swivels.
- **Interface and tools.** Fog of war on the minimap. A crew panel with ping. Developer tools for
  admins (F9): god mode, unlimited resources, game speed, jump to a wave, skip day or night, bosses,
  research.
- **Map size.** The map is about twice as big again: 448x336 surface, 272x204 per depth. Up to 5
  players.

## Phase 1 - Crashed ship and the escape goal (replaces the HQ and terraforming)
- Replace the HQ with a modular crashed spaceship. The modules are:
  - generator;
  - shield emitter;
  - hull;
  - life support;
  - ion engines;
  - navigation, which needs the AI core;
  - fuel tanks.

  Each module has damaged and repaired art, plus upgrade levels for efficiency and output.
- Opening crash cutscene, in-engine. The ship flies in intact, crashes and breaks apart, and the
  colonist climbs out.
- New win condition: repair every module, then take off. Requirements:
  - refined uranium or plutonium fuel for the ion engines;
  - the machine AI core, guarded at the bottom of Depth 4.
- Click the ship to open its module panel. It holds the shield module and a mounted heavy turret that
  a player can climb into and fire.

## Phase 2 - Shield and power rework
- Shield size slider. A bigger bubble draws more power. Upgrades make the shield more efficient (less
  power per tile) and give it more capacity, but no bigger radius. When power runs low, the bubble
  shrinks back to cover just the ship.
- Shield emitter buildings that can be built and upgraded, each with its own slider.
- Electrified walls: they use energy to stay up, are much stronger than plain walls and heal
  themselves.
- Battery assignment. Tick the roles a battery serves:
  - shield;
  - weapons;
  - refining;
  - research;
  - weapon development;
  - emergency reserve.

  Batteries with every role ticked are drained evenly first; after that, each system uses its own
  batteries. Each role gets a low-charge warning slider.
- Rebuild the power panel around the battery roles: production, demand by system, stored energy by
  role, and a graph.
- Research costs energy over time, not just resources.
- Dirty solar panels. Dust lowers their output; clean them yourself or with a repair robot.

## Phase 3 - Survival resources and logistics
- Oxygen and water from ice.
  - Mine ice and process it into oxygen for the base and suits; without it you suffocate.
  - Refining minerals also uses water.
- Warehouse-centred logistics. Raw ore goes to a warehouse. Robots carry it to a refinery and bring
  the refined goods back. Construction pulls its materials from warehouses.
- Building takes presence. A colonist must stay at the site, or a construction robot builds it while
  you do something else.
- Robot overhaul. Types: hauler, mining, combat, flying combat, construction and repair. Robots run on
  charge and recharge at the Robot Factory dock or at charger buildings.

## Phase 4 - Enemy escalation
- Enemy tiers that grow with the wave number:
  - shielded units;
  - long-range snipers;
  - artillery;
  - flamethrowers;
  - drones that grow into gunships.

  A battleship boss joins them.
- Horde behaviour: packs pick one section of the base and concentrate on it.
- From wave 10, enemy outposts appear on the map. They spawn machines even during the day until you
  destroy them.

## Phase 5 - Classes, skills, mechs and weapons
- Four classes:
  - combat;
  - mining;
  - robotics;
  - research.

  Each class gets bonuses in its area, but every class can still do everything.
- Use-based skills. Shooting, mining and carrying each level up and improve the more you do them.
- Weapon upgrades for magazine size, reload time, fire rate and damage, costing resources plus
  research.
- Mechs you climb into, with module slots:
  - a combat mech;
  - a mining mech with several auto-drills that clears rock around you underground.
- New turret types and tactical roles: anti-air rocket launchers, artillery, flamethrowers and
  rapid-fire lasers. Every building can be upgraded.

## Phase 6 - World depth and atmosphere
- Lighting overhaul: real shadow casting from your torch and from lights, not just tinted pools.
- More to find on the surface: wrecks, caches, anomalies and weather events.
- Deep levels: lava lakes, geothermal hazards, crystal caverns, and machine factories guarding the AI
  core.
