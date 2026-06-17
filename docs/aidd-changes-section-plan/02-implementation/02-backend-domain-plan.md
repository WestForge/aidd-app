# Backend Domain Plan

## New file

Create:

```text
electron/main/domain/changes.ts
```

## Responsibilities

The domain should own:

```text
changesRoot(projectPath)
readChanges(projectPath)
readChange(input)
createChange(input)
saveChange(input)
updateChangeStatus(input)
deleteChange(input)
createChangeFromCapability(input)
createChangeFromComponent(input)
createChangeFromTechnicalChange(input)
readChangesForCapability(input)
readChangesForComponent(input)
```

## Filesystem helpers

Follow the style already used in `componentTechnicalChanges.ts` and `delivery.ts`:

- `exists`
- `readJson`
- `writeJson`
- `slugify`
- `readEntities`
- `matter.stringify`
- `normaliseRelativePath`
- safe path resolution checks

## Proposed project structure

```text
changes/
  index.md
  CHG-001-add-ai-chat-sidecar/
    change.json
    intent.md
    scope.md
    acceptance-criteria.md
    linked-context.md
    implementation-notes.md
    decisions.md
    review.md
```

## Change section definitions

Use a constant similar to `COMPONENT_TECHNICAL_CHANGE_SECTIONS`:

```ts
export const CHANGE_SECTIONS = [
  { key: 'intent', fileName: 'intent.md', title: 'Intent', editable: true },
  { key: 'scope', fileName: 'scope.md', title: 'Scope', editable: true },
  { key: 'acceptance-criteria', fileName: 'acceptance-criteria.md', title: 'Acceptance criteria', editable: true },
  { key: 'linked-context', fileName: 'linked-context.md', title: 'Linked context', editable: true },
  { key: 'implementation-notes', fileName: 'implementation-notes.md', title: 'Implementation notes', editable: true },
  { key: 'decisions', fileName: 'decisions.md', title: 'Decisions', editable: true },
  { key: 'review', fileName: 'review.md', title: 'Review', editable: true }
] as const;
```

## ID generation

Use project-wide sequential IDs:

```text
CHG-001-add-ai-chat-sidecar
CHG-002-refactor-delivery-creation
```

Implementation sketch:

```ts
export async function nextChangeId(projectPath: string, title: string) {
  const root = changesRoot(projectPath);
  let nextNumber = 1;
  if (await exists(root)) {
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^CHG-(\d{1,5})-/i);
      if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
    }
  }
  return uniqueChangeId(root, `CHG-${String(nextNumber).padStart(3, '0')}-${slugify(title || 'change')}`);
}
```

## Creating from capability

`createChangeFromCapability` should:

1. Read the capability.
2. Create a Change with `linkedCapabilities: [capability.slug]`.
3. Copy capability-linked components into `linkedComponents` as suggestions, not mandatory scope.
4. Seed the change type as `implement-capability` or `update-capability` depending on user input.
5. Seed markdown with the capability title/outcome/context.

## Creating from component

`createChangeFromComponent` should:

1. Read the component.
2. Create a Change with `linkedComponents: [component.slug]`.
3. Optionally link supported capabilities.
4. Seed type as `component-change` or `technical-refactor`.

## Creating from component technical change

`createChangeFromTechnicalChange` should:

1. Read the component technical change.
2. Create a global Change.
3. Link the component.
4. Add legacy metadata:

```json
{
  "source": "component-technical-change",
  "legacyTechnicalChange": {
    "componentSlug": "settings",
    "technicalChangeId": "TC-001-refactor-settings"
  }
}
```

5. Copy or reference technical-change sections into the global Change linked context.

## Readiness validation

Add helper:

```ts
export function evaluateChangeReadiness(change: ChangeDetail): ChangeReadiness
```

Rules:

- has title
- has type
- has intent body not TODO-only
- has scope body not TODO-only
- has acceptance criteria body not TODO-only
- has at least one linked capability or component

The UI can show blockers before allowing status `ready`.
