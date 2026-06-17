---
aidd:
  type: foundation
  id: goals-and-success-metrics
  title: Goals & Success Metrics
  status: complete
  required: true
  templateVersion: 0.8.0
  updatedAt: 2026-06-17T15:20:00.000+01:00
---

# Goals & Success Metrics

## Foundation Goal

StormbaneAIDD should make it easy to turn the Stormbane GDD into focused, reviewable, implementation-ready work without losing the game's design intent.

The foundation succeeds when future components, capabilities, and delivery packages consistently preserve the same product direction: tactical combat, faction-driven world conflict, consequence, controlled economy, merit progression, and deterministic designer-facing authoring tools.

## Product Goals

### 1. Tactical Mastery Over Gear Score

Combat should reward skill, timing, positioning, stamina management, class role understanding, group coordination, and decision-making.

Success signals:

- Combat features define readability, timing, commitment, recovery, counterplay, and stamina implications.
- Class and ability work reinforces distinct battlefield roles.
- Encounter design supports solo, small-group, and group-combat decisions.
- Gear supports strategy without replacing player mastery.

### 2. World State That Reacts

Faction control, settlement state, reputation, POIs, quests, vendors, services, and events should respond to player and faction activity.

Success signals:

- New world features identify which state they read and which state they mutate.
- Dynamic quests are generated or selected from current world, NPC, faction, or regional conditions.
- Settlement and region state affects spawns, safety, prices, access, conflict, and objectives.
- Player action leaves consequences visible beyond a single encounter.

### 3. Consequence and Recovery With Cost

Healing, death, marks, respawn, service access, mount loss, reputation, and recovery should create meaningful decisions.

Success signals:

- Recovery features define cost, scarcity, location dependency, faction dependency, or long-term side effects.
- Death and respawn rules avoid spawn camping while preserving consequence.
- Hidden or indirect afflictions provide learnable symptoms and diagnosis paths.
- Mount systems treat mounts as physical, vulnerable, and memorable world entities.

### 4. Controlled Economy and Logistics

The economy should promote preparation, return-to-civilisation loops, vendor interaction, repair, scarcity, faction influence, and direct player decisions.

Success signals:

- Combat rewards and item acquisition avoid uncontrolled random gear drops.
- Reward-bearing features declare their reward category: currency, service access, reputation, prestige, title, cosmetic, recipe, rare material, trophy, authored unique reward, or another approved category.
- Rare dangerous-location rewards preserve vendor, crafting, repair, scarcity, faction, and logistics loops.
- Vendor stock, prices, repair, and scarcity can react to faction control and wartime state.
- Item transfer points support logistics without removing geographic risk.
- Trading, vendors, and inventory systems preserve loadout decisions.

### 5. Merit, Prestige, and Legacy

Progression should express achievement through prestige, titles, House identity, reputation, cosmetics, class skins, and world recognition rather than traditional level inflation.

Success signals:

- Progression work identifies what achievement it recognises and how it is displayed.
- Title and prestige systems connect to faction contribution, quests, combat, support, and exploration.
- Onboarding choices establish House, heraldry, motto, hero identity, and tone.
- Recognition does not undermine combat readability or balance.

### 6. Designer-Controlled Procedural Output

Procedural structures and generated content should be deterministic, inspectable, editable, and diagnosable.

Success signals:

- The same seed, rule profile, kit catalogue version, and intent produce the same result.
- Generators emit structured plans and diagnostics before materialisation.
- Designers can lock, replace, regenerate, validate, and bake generated assemblies.
- Missing kit pieces or invalid intent produce clear validation issues.
- Runtime actors receive baked, intentional data rather than editor-only planning state.

## AIDD Operating Goals

### 1. Traceability

Every component, capability, and delivery package should clearly trace back to a foundation pillar, GDD section, or accepted design decision.

Metric:

- 100% of new AIDD capabilities include a source intent, owner, scope boundary, acceptance criteria, and exclusions.

### 2. Alignment Before Code

Design intent should be clarified before implementation work starts, especially for new systems, actors, subsystems, plugins, planners, and data assets.

Metric:

- Delivery packages include the intended player/design outcome before implementation tasks.
- Architecture or ownership questions are captured as assumptions or unresolved issues rather than buried in code.

### 3. Reviewable Output

AIDD output should be small enough to review and precise enough to implement.

Metric:

- Delivery packages define changed files or expected file ownership where practical.
- Acceptance criteria describe observable behaviour, tests, logs, editor validation, or manual verification.
- Unknowns are listed explicitly.

### 4. Module and Plugin Boundary Discipline

Runtime, editor, world-simulation, UI, AI, structures, settlements, and tooling concerns should not collapse into one undifferentiated module.

Metric:

- New work identifies the owning module/plugin and avoids mixing runtime game code with editor/build-time planning.
- Shared data contracts are explicit where systems cross module boundaries.
- Player-facing modular housing remains out of core scope unless a later accepted capability explicitly adds it; editor procedural structure authoring remains valid scoped tooling.

### 5. Determinism and Diagnostics

Systems that generate, simulate, or plan content should favour deterministic outputs and structured diagnostics.

Metric:

- Generation/simulation features identify seed inputs, stable data inputs, mutable state, and diagnostic output.
- Re-running the same inputs does not produce unrelated changes unless intended.

### 6. Source Confidence and Scope Horizon

AIDD should keep draft GDD material, accepted direction, and roadmap hooks visibly distinct.

Metric:

- New capabilities and delivery packages identify source confidence: canonical, provisional, or legacy/imported.
- New capabilities and delivery packages identify delivery horizon: first playable, vertical slice, alpha, launch, post-launch/expansion, or research.
- Provisional or legacy/imported material is not treated as required launch scope without an accepted design decision.
- Expansion hooks are captured separately from acceptance criteria for earlier horizons.

### 7. Multiplayer Assumption Discipline

Multiplayer features should not hide authority, persistence, or session assumptions.

Metric:

- Multiplayer-facing work declares assumptions for authority, replication, persistence, PvE/PvP boundaries, party/group scale, faction population, and session model where relevant.
- Features that mutate world, faction, settlement, economy, reputation, inventory, recovery, or House identity identify the authoritative owner of that state.

## Foundation Completion Metrics

The foundation update is complete when:

- The four required foundation files no longer contain placeholder TODO content.
- Product vision, player audience, project users, product boundaries, and success metrics are defined.
- Major GDD domains are represented at foundation level without duplicating the full GDD.
- Known conflicts, applied clarifications, or open questions are recorded in `REVIEW.md`.
- Future AIDD component and capability work can be evaluated against the foundation.

## Current Open Measurement Gaps

The GDD does not yet define final measurable production targets for launch scope, retention, session size, concurrency, combat telemetry, economy telemetry, or QA thresholds. It also does not yet finalize multiplayer architecture, party size, faction population model, PvP/PvE rules, or authoritative state ownership. Until those exist, AIDD metrics should focus on design traceability, implementation alignment, deterministic output, declared scope horizon, stated authority assumptions, acceptance evidence, and explicit unresolved questions.
