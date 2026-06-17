# Delivery Generation from Changes

## New backend function

Add to:

```text
electron/main/domain/delivery.ts
```

```ts
export async function createDeliveryPackageFromChanges(input: CreateDeliveryPackageFromChangesInput) {
  // validate project context
  // read selected changes
  // ensure all are ready
  // read linked capabilities/components
  // build snapshot and strategy
  // write delivery package
  // mark changes as in-delivery and append package id
}
```

## Validation

Rules:

```text
Project foundation must be ready enough for product-facing changes.
Project standards must be ready for all change types.
All selected Changes must exist.
All selected Changes must be ready.
A Change already accepted should not be packaged again unless explicitly duplicated/superseded.
A Change already in delivery should warn or block depending on desired strictness.
```

## Change-type-aware context

Use the Change type to shape the generated `implementation-strategy.md`.

### implement-capability

Include:

```text
Capability slice
Linked components
Explicit not-in-scope items
Acceptance criteria
```

Guardrail:

```text
Do not implement the whole capability unless the Change scope says so.
```

### technical-refactor

Include:

```text
Component constraints
Source mapping
Behaviour preservation rule
Verification requirements
```

Guardrail:

```text
No product behaviour changes unless listed in the Change.
```

### bug-fix

Include:

```text
Observed behaviour
Expected behaviour
Reproduction steps
Regression checks
```

### spike-investigation

Include:

```text
Question to answer
Constraints
Expected output
Follow-up decision/change requirement
```

Guardrail:

```text
Do not make production changes unless explicitly authorised.
```

## Package files

Write the same core files as current packages:

```text
delivery/packages/<DP-id>/package.json
delivery/packages/<DP-id>/snapshot.md
delivery/packages/<DP-id>/implementation-strategy.md
```

Add optional:

```text
delivery/packages/<DP-id>/changes.md
delivery/packages/<DP-id>/linked-context.md
```

But avoid duplicating too much. The existing package reader expects snapshot/strategy/phase files.

## Updating Changes after package creation

After package creation:

```text
Change.status = in-delivery
Change.deliveryPackageIds += package id
Change.updatedAt = now
```

If one package includes multiple Changes, update all selected Changes.

## Delivery summary update

Update `DeliveryPackageType`:

```ts
export type DeliveryPackageType = 'capability' | 'technical' | 'change';
```

Update `DeliveryPackageSummary`:

```ts
changeIds?: string[];
sourceCapabilities?: string[];
```

Keep existing fields for compatibility:

```ts
sourceCapability?: string;
sourceTechnicalChange?: {...};
technicalChanges?: DeliveryPackageTechnicalChangeSummary[];
```
