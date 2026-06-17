---
aidd:
  type: foundation
  id: product-definition
  title: Product Definition
  status: complete
  required: true
  templateVersion: 0.8.0
  updatedAt: 2026-06-17T15:20:00.000+01:00
---

# Product Definition

## Product

Stormbane is a class-based multiplayer dark fantasy RPG focused on tactical combat, faction conflict, world-state change, controlled economy, and legacy-based progression. The player creates a House, enters the world as its first hero, and builds recognition through battles, quests, faction contribution, survival, and consequence.

StormbaneAIDD is the structured design and delivery context for that product. It exists to convert the GDD into maintainable implementation guidance for designers, programmers, tools work, AI agents, and review packages.

## Player-Facing Promise

Players should experience a harsh medieval world where preparation matters, combat is dangerous, factions remember actions, settlements can fall, services can be lost, and prestige is earned through meaningful contribution rather than level numbers.

A successful Stormbane feature should normally reinforce at least one of these outcomes:

- The player makes a tactical decision under pressure.
- The world state changes because of player, faction, or NPC action.
- Consequence persists long enough to affect future choices.
- Economy, logistics, travel, or recovery creates meaningful planning.
- The player gains legacy, reputation, title, cosmetic recognition, or social standing through merit.
- Designers can author, inspect, validate, and tune the result.

## Core Gameplay Loop

1. **Create identity**: define House, heraldry, motto, hero appearance, and starting archetype/loadout.
2. **Prepare**: choose equipment, consumables, mount access, travel route, and objective from a hub, outpost, settlement, or border camp.
3. **Enter the world**: travel through regions shaped by POIs, landmarks, danger signals, roads, rivers, choke points, weather, faction state, and settlement anchors.
4. **Act**: fight, scout, sabotage, hunt, conquer, defend, trade, recover, diagnose marks, support faction objectives, or respond to dynamic events.
5. **Resolve consequence**: world state, reputation, territory, services, economy, recovery cost, mount status, and NPC/faction response update.
6. **Return and resupply**: repair gear, buy supplies, access vendors, use item transfer points, recover at sanctuaries, and decide the next action.
7. **Build legacy**: earn prestige, titles, cosmetics, class skins, House meaning, faction standing, and narrative recognition.

## Reward and Acquisition Taxonomy

Stormbane's reward model should be explicit enough that "rare rewards in dangerous locations" does not become uncontrolled random gear drops.

Allowed reward categories include:

- **Currency and logistics**: gold, supply relief, repair access, transfer-point access, discounts, or vendor stock changes.
- **Reputation and standing**: faction contribution, settlement trust, titles, prestige, House recognition, or service eligibility.
- **Knowledge and access**: rumours, scouting intelligence, map detail, quest chains, sanctuary access, trainer access, vendor access, or faction permissions.
- **Materials and trophies**: rare materials, monster parts, relic fragments, proof items, crafting inputs, or trade goods.
- **Recipes and unlocks**: schematics, class cosmetics, heraldry options, class skins, visual prestige, or bounded ability/loadout unlocks.
- **Authored unique rewards**: hand-placed or quest-authored gear, relics, mounts, cosmetics, or narrative rewards with declared source, rarity, and balance intent.

Enemies, containers, POIs, and conquest outcomes may award gold, materials, trophies, intelligence, reputation, access, or explicitly authored unique rewards. They should not create a random equipment shower that bypasses vendors, crafters, repair loops, local scarcity, or faction-controlled supply.

Gear acquisition should primarily flow through vendors, crafters, faction access, service unlocks, authored quest rewards, hand-placed unique rewards, and deliberate trade. Any exception must name its reward category and explain how it preserves the controlled economy.

## Major System Groups

### Character, Combat, and Classes

Stormbane uses class roles, distinct combat identities, stamina-aware melee, timing data, attack modifiers, group combat principles, elemental interactions, defensive counters, finishers, and role-specific abilities.

### Faction, Reputation, and World State

Faction identity, territorial control, cultural tension, social reputation, marks, service access, pricing, settlement state, and NPC response should be world systems rather than isolated quest flags.

### Dynamic Quests and Conflict

The quest framework should support state-driven archetypes such as location conquest, scouting, hunts, fetch objectives, sabotage, civilian unrest, plague or disease pressure, economic warfare, religious consequences, faction infighting, and siege counter-operations.

### Economy, Vendors, Items, and Logistics

The economy should use gold, vendors, repair, durability, limited stock, faction pricing, wartime scarcity, nomadic traders, direct trading, regional item transfer points, and intentional acquisition.

### World, Environment, and Travel

Regions should support map hierarchy, POI cadence, safe and contested zones, settlement anchors, district capture, rally points, roads, river crossings, sightlines, landmarks, day/night behaviour, weather, temperature hooks, and clear danger signalling.

### Onboarding, House, and Legacy

The first player choices should establish identity, tone, House legacy, archetype, starting loadout, and personal investment. Titles and prestige should reinforce achievement and world recognition.

### Structures and Procedural Authoring

Procedural structures should be generated through a deterministic, designer-facing workflow. Kit classification, rule profiles, seeds, footprints, rooms, openings, features, diagnostics, manual overrides, and baking should remain inspectable and reproducible.

This does not imply a primary player-facing modular housing system. The current foundation boundary is:

- Designer/editor tools may assemble settlements, buildings, interiors, POIs, and encounter spaces through procedural or semi-procedural workflows.
- Runtime systems may place or stream baked generated structures when they are deterministic and reviewable.
- Players should not receive unrestricted modular construction or housing placement as a core product promise unless a later scoped capability explicitly adds it.

## AIDD Deliverables

AIDD should produce and maintain:

- Foundation documents for stable project context.
- Components for major design and implementation domains.
- Capabilities that express reusable, implementation-ready behaviours or workflows.
- Delivery packages with clear scope, intent, acceptance checks, and evidence.
- Review outputs that identify drift between GDD, implementation, and design intent.

## Product Boundaries

The foundation should not become the full GDD. It should define stable product direction and context. Detailed content belongs in downstream documents.

Current product boundaries from the GDD:

- Multiplayer RPG, not a single-player-only adventure.
- Class-based combat, not unrestricted classless simulation.
- Merit, title, and legacy progression, not level-grind progression.
- Controlled local economy, not global auction-house economy.
- Consequence-driven recovery, not free instant reset.
- Authored-feeling procedural tools, not opaque generation.
- Bespoke class/archetype presentation and focused scope, not unrestricted modular housing as a primary player system.
- Lore, race, faction, region, NPC, and item catalogues as source material for downstream work, not foundation-level commitments by default.

## Planning Baselines

### Multiplayer Scope

Stormbane is multiplayer-first, but several multiplayer implementation decisions remain open. Until a formal architecture decision exists, downstream work should treat server-authoritative world state as the planning assumption and explicitly declare:

- Session model and expected persistence.
- PvE, PvP, faction, and safe-zone boundaries.
- Party, group, and faction population assumptions.
- Authority over combat, movement, inventory, economy, quests, settlements, recovery, reputation, and House identity.
- Replication, rollback, anti-exploit, and conflict-resolution expectations where relevant.

These declarations are planning assumptions, not final networking architecture.

### Delivery Horizon

Capabilities and delivery packages should mark their intended horizon:

- **First playable**: smallest coherent slice proving the loop.
- **Vertical slice**: representative production-quality slice across key systems.
- **Alpha**: broader playable system coverage with incomplete content and balancing.
- **Launch**: required player-facing and operational scope.
- **Post-launch / expansion**: explicitly deferred scope.
- **Research**: investigation needed before commitment.

Expansion hooks should be recorded as hooks, not treated as acceptance criteria for earlier horizons.

### Source Confidence

Work derived from the GDD should identify whether its source is canonical, provisional, or legacy/imported. Provisional or legacy material may inform exploration, but it should not become an implementation requirement until accepted by a design decision.

## Quality Bar

A Stormbane feature is not ready for implementation unless it has:

- A clear design intent.
- An owning module, plugin, component, or system boundary.
- Runtime/editor separation where relevant.
- Data ownership and persistence expectations.
- Multiplayer or authority assumptions where relevant.
- Reward category and acquisition path where rewards are involved.
- Delivery horizon and source confidence where the scope depends on GDD material.
- Deterministic behaviour where generation or simulation depends on seeds.
- Acceptance checks that prove the feature supports the intended game experience.
