# Delivery Refactor

## Current issue

Delivery is currently being used as both planning and execution. That makes it too heavy and causes scope to be invented too late.

## Target responsibility

Delivery should consume ready Changes.

```text
Changes define intent and scope.
Delivery packages freeze context and support implementation/review.
```

## New delivery package source

Replace UI usage of:

```ts
createDeliveryPackageFromCapability(input)
createDeliveryPackageFromTechnicalChange(input)
```

with:

```ts
createDeliveryPackageFromChanges({
  projectPath,
  changeIds: string[]
})
```

## Package manifest

Update `delivery/packages/<id>/package.json` to support `packageType: "change"`.

Example:

```json
{
  "id": "DP-001-add-ai-chat-sidecar",
  "title": "Add AI chat sidecar",
  "packageType": "change",
  "status": "draft",
  "changeIds": ["CHG-001-add-ai-chat-sidecar"],
  "sourceCapabilities": ["ai-assisted-development-context"],
  "components": ["ai-chat-sidecar", "settings"],
  "technicalChanges": [],
  "createdAt": "2026-06-17T10:00:00.000Z"
}
```

## Snapshot contents

A change-based package snapshot should include:

```text
Project foundation summary
Relevant project standards
Selected Change record(s)
Linked capabilities
Linked components and source mappings
Linked technical review artefacts, if any
Change-type-specific implementation guidance
Explicit out-of-scope constraints
Acceptance criteria
Verification expectations
```

## Strategy document

The implementation strategy should be generated from the Change type.

For a technical refactor, the strategy must emphasise:

```text
No product behaviour drift.
No unrelated cleanup.
Verification must prove behaviour stayed stable.
```

For an implement capability Change, the strategy must emphasise:

```text
Implement only the stated capability slice.
Do not complete the whole capability unless it is explicitly in scope.
```

## Existing delivery packages

Existing packages should remain readable.

Existing `packageType` values:

```text
capability
technical
```

New package type:

```text
change
```

The display code should tolerate all three.
