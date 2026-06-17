# Foundation Review

Project: StormbaneAIDD

## Summary of changes

- Replaced placeholder foundation content with a GDD-derived foundation for StormbaneAIDD.
- Defined StormbaneAIDD as the structured design and delivery context for Stormbane rather than the game itself.
- Translated the GDD vision into stable foundation pillars: tactical combat, faction conflict, emergent quests, consequence/recovery, controlled economy/logistics, merit progression, and authored-feeling procedural support.
- Added player-facing product definition, core gameplay loop, major system groups, product boundaries, and AIDD delivery expectations.
- Added audience definitions for both AIDD users and target players.
- Added product and AIDD success metrics with practical acceptance signals.
- Added follow-up guardrails for reward taxonomy, source confidence, multiplayer assumptions, delivery horizons, and the procedural-authoring versus player-housing distinction.
- Preserved the required return shape and only changed the four allowed foundation files plus this review file.

## Pros

- The GDD contains a strong central identity: brutal multiplayer RPG, tactical combat, faction war, consequence, no level treadmill, and legacy through player action.
- Several design constraints are already clear enough to become foundation rules: controlled economy, local vendors, recovery cost, faction influence, safe-zone limits, deterministic procedural generation, and designer-inspectable authoring.
- The design has useful cross-system links: faction state affects economy, services, quests, settlements, recovery, reputation, and access.
- The procedural structure rules are unusually actionable and provide a good model for future AIDD capabilities: staged workflow, deterministic seeds, diagnostics, editable assemblies, and bake/runtime handoff.
- The foundation now separates stable project context from detailed GDD content, which should make future component and capability work easier to scope.

## Follow-up implementation applied

- Added a reward and acquisition taxonomy so rare rewards in dangerous locations can be categorized without reintroducing uncontrolled random gear drops.
- Clarified that "no modular housing" is a player-facing product boundary, while deterministic designer/editor procedural structure assembly remains valid tooling.
- Added source confidence labels for canonical, provisional, and legacy/imported GDD material.
- Added delivery horizon labels for first playable, vertical slice, alpha, launch, post-launch/expansion, and research scope.
- Added multiplayer planning expectations so downstream work must declare authority, replication, persistence, PvE/PvP, session, party/group, and faction population assumptions.

## Cons

- The GDD still contains imported/draft material, placeholders, and mixed levels of certainty. For example, location conquest says full details are still to be inserted.
- Reward categories are now defined at foundation level, but concrete item tables, drop rates, authored unique rewards, vendor rules, and balance values still belong in downstream components.
- Multiplayer scope is still not final: PvE/PvP boundaries, session model, server authority, party size, faction population, persistence, and scale need separate clarification.
- Launch scope is still not final. Systems now have horizon labels, but first playable, vertical slice, alpha, launch, and roadmap contents still need owner decisions.
- Lore and race/faction material is rich, but not all of it is foundation-level. It should be moved into downstream components/capabilities when implementation needs it.

## Files changed

- `foundation/01-project-overview.md`
- `foundation/02-product-definition.md`
- `foundation/03-audience-and-users.md`
- `foundation/04-goals-and-success-metrics.md`
- `REVIEW.md`

## Assumptions made

- StormbaneAIDD is the AIDD project used to structure and deliver the Stormbane game design, not a separate player-facing product.
- The AIDD foundation should summarise stable intent and constraints, not duplicate every GDD mechanic, item, race, region, or NPC.
- The GDD's "no levels" direction means no traditional level treadmill or stat-inflation progression as the main progression model; it does not prohibit attributes, gear, skill unlocks, titles, cosmetics, or prestige.
- The GDD's economy direction means no uncontrolled random gear drops as the main reward path; gold, vendors, quest rewards, crafted/unique materials, and explicitly authored rewards still need downstream detail.
- "No modular housing" is treated as a player-facing scope boundary, not a ban on designer/editor procedural structure tools.
- Server-authoritative world state is treated as a planning assumption until a formal multiplayer architecture decision replaces it.
- First playable, vertical slice, alpha, launch, post-launch/expansion, and research are treated as scope labels; this update does not decide which systems belong in each horizon.
- Current success metrics should focus on design alignment, acceptance evidence, determinism, stated assumptions, and traceability until production telemetry targets exist.

## Questions or unresolved issues

- What is the intended first playable or vertical-slice scope?
- What is the multiplayer model: dedicated servers, listen servers, party size, PvP rules, faction population model, and persistence level?
- What is the authoritative source of truth for world state, faction state, settlement state, economy state, player reputation, and House identity?
- Which reward categories are allowed in first playable, vertical slice, alpha, and launch, and which are later roadmap scope?
- Which systems are core launch requirements and which are optional expansion hooks?
- How should AIDD components be split across current and planned modules/plugins, especially AI, world simulation, UI, settlements, structures, combat, economy, and character systems?
- Which GDD pages are canonical and which are legacy/imported drafts?
