# Migration Strategy

## Principle

Do not force old projects into the new model immediately.

The first release should:

- Add Changes for new work.
- Keep existing delivery packages readable.
- Keep existing component technical changes readable.
- Stop new direct delivery package creation from capabilities/components in the UI.

## Existing delivery packages

Existing packages under:

```text
delivery/packages/
```

should remain valid.

Legacy package types:

```text
capability
technical
```

New package type:

```text
change
```

## Existing component technical changes

Existing records under:

```text
components/<component>/technical-changes/
```

remain readable.

Short-term behaviour:

```text
Component technical change -> Create global Change -> Delivery package from global Change
```

Long-term optional migration:

```text
Component technical change becomes supporting artefact attached to a global Change.
```

## Automatic migration options

### Conservative migration

Do not create Changes automatically. Only create `changes/index.md`.

Pros:

- Low risk.
- Avoids inventing intent.

Cons:

- Old work remains split across delivery/technical-change areas.

### Assisted migration

Offer a button:

```text
Create Changes from legacy technical changes
```

Pros:

- User controls conversion.

Cons:

- Requires UI and careful mapping.

### Aggressive migration

Automatically create a Change for each approved/unpackaged component technical change.

Not recommended initially.

## Recommended approach

Use conservative migration in the first implementation.

Add assisted migration later if needed.
