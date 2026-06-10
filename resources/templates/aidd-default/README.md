# StormUI

StormUI uses AIDD as a Markdown-based delivery control workspace for AI-assisted software work.

AIDD is not just documentation. It defines the project context, component boundaries, capability outcomes, delivery packages, standards, and agent-ready implementation exports used to control how work is planned and implemented.

## Core Workflow

```text
1. Define project foundation context
2. Apply project standards
3. Create components for system boundaries
4. Create capabilities for outcomes
5. Create delivery packages for planned work
6. Complete the bundle phases
7. Mark the bundle ready
8. Export an agent-ready implementation file
9. Implement and review against the bundle
```

## Project Structure

```text
.aidd/
  Internal AIDD tooling and reusable templates.
  Agents should ignore this unless modifying AIDD itself.

foundation/
  Shared project context, decisions, delivery rules, and standards.

components/
  System boundaries and implementation ownership areas.

capabilities/
  Product or technical outcomes that may reference one or more components.

delivery/
  Roadmap and phased delivery packages.
```

## Quick Start

Check the workspace:

```bash
npm run aidd:check
```

List available standards profiles:

```bash
npm run aidd:standards:list
```

Apply standards for this project:

```bash
npm run aidd:standards:apply -- unreal-plugin
```

Create a component:

```bash
npm run aidd:component:create -- runtime --title "Runtime"
```

Create a capability that references one or more components:

```bash
npm run aidd:capability:create -- hud-framework --title "HUD Framework" --components runtime
```

Create a delivery package:

```bash
npm run aidd:bundle:create -- HUD-001 --title "HUD Framework Phase 1" --capability hud-framework
```

Update the delivery roadmap:

```bash
npm run aidd:delivery:roadmap
```

## AIDD Concepts

### Common

`foundation/` contains project-wide context and rules.

Use it for:

- project overview
- product definition
- audience and users
- decisions
- delivery rules
- standards

### Components

`components/` contains system boundaries.

A component answers:

- what this area owns
- what it does not own
- what it may depend on
- what may depend on it
- what interfaces it exposes
- what coupling is forbidden

Example:

```bash
npm run aidd:component:create -- styling --title "Styling"
```

### Capabilities

`capabilities/` contains outcomes the project must support.

A capability may reference one or more components.

Example:

```bash
npm run aidd:capability:create -- common-style-assets --title "Common Style Assets" --components styling,runtime
```

### Delivery Packages

`delivery/packages/` contains planned packages of work.

A delivery package is the unit that gets planned, reviewed, marked ready, and exported for implementation.

Each bundle contains phases:

```text
01-context.md
02-scope.md
03-design.md
04-implementation-plan.md
05-tasks.md
06-acceptance.md
07-review.md
08-validation.md
09-handoff.md
```

### Agent Exports

An agent export is a single Markdown file generated from a ready bundle.

It is the file you give to an AI agent or developer for implementation.

```bash
npm run aidd:bundle:export -- HUD-001
```

The export is written to:

```text
delivery/packages/HUD-001/exports/HUD-001.agent.md
```

## Standards Workflow

AIDD supports reusable standards profiles.

List available profiles and presets:

```bash
npm run aidd:standards:list
```

Apply a preset:

```bash
npm run aidd:standards:apply -- unreal-plugin
```

Apply individual profiles:

```bash
npm run aidd:standards:apply -- solid cpp unreal documentation testing ai-agent
```

Show applied standards:

```bash
npm run aidd:standards:show
```

Remove applied standards:

```bash
npm run aidd:standards:remove -- unreal
```

Applied standards are copied into:

```text
foundation/standards/
```

Once applied, they become project-owned and can be edited.

## Delivery Package Workflow

Create a bundle:

```bash
npm run aidd:bundle:create -- HUD-001 --title "HUD Framework Phase 1" --capability hud-framework
```

Complete the bundle phase files:

```text
delivery/packages/HUD-001/
  01-context.md
  02-scope.md
  03-design.md
  04-implementation-plan.md
  05-tasks.md
  06-acceptance.md
  07-review.md
  08-validation.md
  09-handoff.md
```

Mark it ready:

```bash
npm run aidd:bundle:ready -- HUD-001
```

AIDD will refuse to mark a bundle ready while `TODO` markers remain.

Export the implementation file:

```bash
npm run aidd:bundle:export -- HUD-001
```

Give the generated `.agent.md` file to the AI agent or developer.

## Command Reference

### Check workspace

```bash
npm run aidd:check
```

Validates the AIDD workspace structure.

### List everything

```bash
npm run aidd:list
```

Lists components, capabilities, and delivery packages.

### Standards

```bash
npm run aidd:standards:list
npm run aidd:standards:apply -- unreal-plugin
npm run aidd:standards:show
npm run aidd:standards:remove -- unreal
```

Manages project standards profiles.

### Components

```bash
npm run aidd:component:create -- runtime --title "Runtime"
npm run aidd:component:list
```

Creates and lists component boundaries.

### Capabilities

```bash
npm run aidd:capability:create -- hud-framework --title "HUD Framework" --components runtime
npm run aidd:capability:list
npm run aidd:capability -- hud-framework
```

Creates, lists, and exports capability packs.

### Delivery Packages

```bash
npm run aidd:bundle:create -- HUD-001 --title "HUD Framework Phase 1" --capability hud-framework
npm run aidd:bundle:ready -- HUD-001
npm run aidd:bundle:export -- HUD-001
npm run aidd:bundle:list
```

Creates, prepares, exports, and lists delivery packages.

### Delivery Roadmap

```bash
npm run aidd:delivery:roadmap
```

Regenerates the delivery roadmap from bundle metadata.

### Clean generated exports

```bash
npm run aidd:clean
```

Removes generated bundle exports while preserving bundle source files.

## Agent Guidance

AI agents should not implement directly from source files or broad capability documents.

Implementation should start from a ready delivery package export:

```text
delivery/packages/<bundle-id>/exports/<bundle-id>.agent.md
```

Agents should:

1. read the assigned agent export
2. follow the context loading order
3. respect component boundaries
4. obey applied standards
5. modify only allowed source paths
6. stop if the work exceeds the bundle scope

Agents should ignore `.aidd/` unless explicitly asked to modify AIDD tooling.
