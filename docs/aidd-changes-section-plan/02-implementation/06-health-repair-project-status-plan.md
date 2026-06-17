# Health, Repair, and Project Status Plan

## Files to update

```text
electron/main/domain/projectValidation.ts
electron/main/domain/projectMaintenance.ts
electron/main/domain/projectStatus.ts
scripts/aidd-repair.mjs
```

## Required structure

Add `changes/` to project structure.

Minimum required files:

```text
changes/
changes/index.md
```

`changes/index.md` content:

```md
# Changes

Changes describe intended product, component, technical, documentation, or investigation work before it is scheduled for delivery.

## Active changes

No changes yet.
```

## Validation rules

Add checks for:

```text
changes directory exists
changes/index.md exists
each change folder has change.json
change.json can be parsed
change id matches folder name
linked capabilities exist
linked components exist
deliveryPackageIds refer to existing delivery packages when present
section files exist
status/type values are valid
```

## Repair rules

Add repair support for:

```text
create missing changes/index.md
rebuild missing change.json from Markdown frontmatter/headings when possible
create missing section files for a valid change folder
normalise invalid linked capability/component arrays
remove duplicate delivery package ids
```

Do not auto-delete legacy component technical changes.

## Project status

Add counts:

```text
changeCount
readyChangeCount
changesInDeliveryCount
changesInReviewCount
acceptedChangeCount
```

Home can use these counts to show progress.

## Backward compatibility

Validation should not error because existing delivery packages were created from capabilities/technical changes.

Instead, old packages should be recognised as legacy package types:

```text
packageType: capability
packageType: technical
```

New package type:

```text
packageType: change
```
