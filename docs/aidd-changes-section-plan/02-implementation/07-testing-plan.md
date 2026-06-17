# Testing Plan

## Unit tests

Add tests for:

```text
nextChangeId creates sequential CHG IDs
createChange writes change.json and section files
readChanges sorts by status and id
readChange returns sections and readiness
saveChange updates metadata and section bodies
updateChangeStatus enforces readiness when moving to ready
deleteChange removes a change folder safely
createChangeFromCapability links the source capability
createChangeFromComponent links the source component
createChangeFromTechnicalChange preserves legacy technical change reference
createDeliveryPackageFromChanges blocks draft changes
createDeliveryPackageFromChanges writes package.json/snapshot/strategy
createDeliveryPackageFromChanges appends deliveryPackageIds to each Change
```

## Renderer tests/manual checks

Manual checks:

```text
Changes appears in sidebar
New Change can be created
Change type templates populate useful sections
Capabilities page has Plan Change, not Create delivery package
Components page has Create/Promote Change, not Create delivery package
Delivery page no longer offers blank New Delivery Package
Ready Change can create delivery package
Created delivery package opens in existing delivery editor
Legacy delivery packages still display
Legacy component technical changes still display
Health check recognises changes/index.md
Repair creates missing changes/index.md
```

## Regression checks

Run:

```bash
npm run typecheck
npm run build
```

Then run any existing focused tests for:

```text
project validation/repair
capability flows
component flows
delivery package read/save/publish/review
Git save sync
```

## Risk areas

Highest risk areas:

```text
Changing src/main.tsx routing while legacy in-memory package state still exists.
Delivery package reader assuming packageType is only capability/technical.
Component technical change UI having many direct package creation references.
Project validation/repair producing false errors for existing projects.
Preload/vite-env mismatch causing runtime `window.aidd.* is not a function` errors.
```
