---
aidd:
  type: foundation
  id: project-overview
  title: Project Overview
  status: complete
  required: true
  templateVersion: 0.8.0
  updatedAt: 2026-06-17T15:20:00.000+01:00
---

# Project Overview

## Project

StormbaneAIDD is the AIDD knowledge base for **Stormbane**. Its role is to translate the Stormbane GDD into stable project context, component boundaries, capabilities, delivery packages, and reviewable implementation intent.

Stormbane is a **class-based multiplayer RPG** set in a grounded dark fantasy medieval world shaped by war, politics, survival, and player action. Players create a noble House, step into the world as the first hero of that lineage, fight brutal tactical battles, join faction conflicts, and build legacy through consequence rather than traditional level progression.

## Core Vision

Stormbane should feel like a harsh, living world where every major action has weight. The game is not built around power-level grinding or random loot showers. It is built around skill, preparation, faction pressure, attrition, reputation, territory, and the visible aftermath of player decisions.

The foundation vision can be summarised as:

> A brutal multiplayer RPG where steel clashes, factions war, and every battle reshapes the world; players forge a legacy through tactical mastery, consequence, and world-state change.

## Design Pillars

### Tactical, Visceral Combat

Combat should be weighty, readable, stamina-aware, and unforgiving. Success comes from timing, positioning, spacing, target selection, and team coordination rather than gear score alone.

### Faction-Driven World Conflict

The world should evolve through faction ownership, territory pressure, settlement conflict, domination quests, dynamic events, and strategic control of locations such as villages, castles, border hubs, roads, and POIs.

### Emergent, Combat-Focused Quests

Quests should be driven by world state, faction needs, NPC pressure, player action, and regional events. Quest archetypes should support conquest, scouting, hunts, sabotage, unrest, economic warfare, religious or mythic consequences, and counter-operations.

### Consequence, Attrition, and Recovery

Healing, death, marks, respawn, service access, mount loss, reputation, and recovery should reinforce the setting. Recovery is not a free reset; it is a world-facing, social, moral, and logistical decision.

### Controlled Economy and Logistics

The economy should favour intentional acquisition, limited supply, repair, durability, local vendors, faction influence, item transfer points, caravans, direct trade, and return-to-civilisation loops. Combat rewards should not collapse into random equipment drops.

### Merit-Based Progression and Legacy

Stormbane should avoid traditional levels and stat-inflation progression as the primary measure of achievement. Rank, titles, prestige, cosmetics, class skins, House identity, and world recognition should reflect what the player has done.

### Authored-Feeling Procedural Support

Procedural content should be inspectable, deterministic, and designer-editable. Generation should feel like an authoring workflow, not a black box: kit setup, rules, editable assembly, validation, bake, and runtime placement.

## Non-Negotiable Foundation Constraints

- No traditional level treadmill as the main progression model.
- No random gear-loot dependency as the main reward model.
- Reward design must use an explicit taxonomy: currency, service access, reputation, prestige, titles, cosmetics, recipes, rare materials, trophies, authored unique rewards, or other declared reward types.
- No global market replacing local vendors, caravans, direct trade, and faction-controlled supply.
- Healing and recovery must carry cost, risk, scarcity, or world dependency.
- Faction state, territory ownership, reputation, and settlement state should affect services, prices, access, quests, spawns, and conflict.
- Border hubs are the only permanently safe world locations; settlements may become contested.
- Travel, POIs, landmarks, roads, rivers, choke points, and region boundaries should communicate danger, discovery, and direction.
- "No modular housing" is a player-facing scope boundary, not a ban on designer/editor procedural structure assembly.
- Generated structures and world content must be deterministic from the same seed, rule profile, kit catalogue version, and intent.
- Runtime game systems and editor/build-time authoring systems must remain clearly separated.
- Multiplayer-facing work must state its authority, replication, persistence, PvE/PvP, party/group, faction population, and session assumptions before implementation.
- Delivery work must declare whether it targets first playable, vertical slice, alpha, launch, post-launch, or research/roadmap scope.
- Imported, draft, placeholder, or legacy GDD material must be labelled before it becomes an implementation requirement.
- AIDD output should preserve design intent before implementation details.

## AIDD Role in the Project

AIDD should help Stormbane move from broad GDD intent to implementation-ready design assets. Each AIDD component, capability, and delivery package should answer:

- Which GDD intent or pillar does this serve?
- Which module, plugin, or system owns it?
- What runtime state does it require or change?
- What editor-time or authoring workflow does it require?
- What data assets, tags, rules, or deterministic seeds drive it?
- What acceptance checks prove the work is aligned?
- What should not be built yet?

The foundation should therefore remain high-level and stable. Detailed mechanics, lore catalogues, faction descriptions, item tables, and implementation plans should live in components, capabilities, or design documents, not in the foundation itself.

## Source Confidence and Canonicality

StormbaneAIDD should distinguish stable direction from draft material. Downstream work should tag source material as one of:

- **Canonical**: accepted GDD direction, foundation rule, or recorded design decision.
- **Provisional**: plausible direction from draft GDD material that needs owner confirmation before implementation.
- **Legacy / imported**: material retained for reference but not valid as a requirement until promoted by a decision.

When a GDD section contains placeholders, mixed certainty, or imported notes, AIDD should preserve the useful intent, record the uncertainty, and avoid turning the draft text into hidden scope.
