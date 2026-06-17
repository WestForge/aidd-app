# Feature Acceptance Criteria

## Core behaviour

- [ ] A top-level Changes section exists.
- [ ] A user can create a Change manually.
- [ ] A user can create a Change from a capability.
- [ ] A user can create a Change from a component.
- [ ] A user can create a Change from a component technical change.
- [ ] A Change can link to one or more capabilities.
- [ ] A Change can link to one or more components.
- [ ] A Change stores metadata in `change.json`.
- [ ] A Change stores editable planning content as Markdown section files.
- [ ] Change type determines useful default template content.

## Delivery separation

- [ ] Capabilities no longer create delivery packages directly.
- [ ] Components/technical changes no longer create delivery packages directly.
- [ ] Delivery no longer has blank `New Delivery Package` creation.
- [ ] New delivery packages are created from ready Changes.
- [ ] Draft Changes cannot be packaged.
- [ ] Delivery package snapshot includes linked capability/component context.
- [ ] Delivery package strategy reflects the Change type.

## Compatibility

- [ ] Existing capability delivery packages still read/open.
- [ ] Existing technical delivery packages still read/open.
- [ ] Existing component technical changes still read/open.
- [ ] Existing delivery review package flow still works.
- [ ] Existing workspace publishing still works.

## Health and repair

- [ ] New projects contain `changes/index.md`.
- [ ] Repair creates missing `changes/index.md`.
- [ ] Health check validates change records.
- [ ] Health check warns rather than fails for supported legacy packages.

## Verification

- [ ] TypeScript typecheck passes.
- [ ] Build passes.
- [ ] Focused domain tests pass.
- [ ] Existing regression tests pass.
