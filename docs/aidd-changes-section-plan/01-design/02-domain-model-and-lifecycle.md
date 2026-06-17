# Change Domain Model and Lifecycle

## Change record

A Change is the first-class planning record for intended work.

Minimum metadata:

```json
{
  "id": "CHG-001-add-ai-chat-sidecar",
  "title": "Add AI chat sidecar",
  "type": "implement-capability",
  "status": "draft",
  "priority": "normal",
  "risk": "medium",
  "linkedCapabilities": ["ai-assisted-development-context"],
  "linkedComponents": ["ai-chat-sidecar", "settings"],
  "deliveryPackageIds": [],
  "source": "manual",
  "createdAt": "2026-06-17T10:00:00.000Z",
  "updatedAt": "2026-06-17T10:00:00.000Z"
}
```

## Change statuses

Use a simple lifecycle that tracks planning, execution, and outcome without becoming Jira.

```text
Draft       - intent still being shaped.
Ready       - scope and acceptance criteria are good enough for delivery.
In delivery - included in at least one active delivery package.
In review   - delivered output is being checked against intent.
Accepted    - delivered and accepted.
Rejected    - attempted but not accepted.
Superseded  - replaced by a later change.
```

Optional later statuses:

```text
Deferred    - intentionally paused.
Blocked     - cannot proceed due to dependency.
Cancelled   - intentionally abandoned before delivery.
```

## Readiness rule

A Change can become `ready` only when it has:

- A title.
- A change type.
- Intent.
- Scope and out-of-scope notes.
- At least one linked capability or linked component.
- Acceptance criteria.
- Basic risk/unknowns.

## Delivery rule

A new delivery package can only be created from one or more `ready` Changes.

## Relationship cardinality

```text
Capability  1..n Changes
Component   1..n Changes
Change      0..n Delivery Packages
Delivery Package 1..n Changes
```

Allowing multiple Changes per Delivery Package is useful, but the initial UI should strongly encourage one Change per package to avoid scope drift.

## Decisions inside Changes

Do not make ADR the top-level section for this feature.

A Change may contain a decision log:

```text
Decision
Reason
Alternatives considered
Impact
Date
```

If a decision becomes permanent project guidance, promote it into Standards.
