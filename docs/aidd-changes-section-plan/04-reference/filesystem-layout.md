# Filesystem Layout

## New top-level folder

```text
changes/
```

## Index

```text
changes/index.md
```

Purpose:

- Human-readable overview.
- Health check anchor.
- Future summary of active/ready changes.

## Change folder

```text
changes/CHG-001-add-ai-chat-sidecar/
  change.json
  intent.md
  scope.md
  acceptance-criteria.md
  linked-context.md
  implementation-notes.md
  decisions.md
  review.md
```

## Manifest

```text
change.json
```

Source of truth for metadata, links, status, risk, and delivery package references.

## Markdown section files

Keep editable planning context in Markdown so it remains useful for drag/drop review and AI handoff.

## Legacy technical changes

Existing folders remain:

```text
components/<component>/technical-changes/<TC-id>/
```

They can be referenced by new Changes through `legacyTechnicalChange`, but should not be the primary delivery planning unit after migration.
