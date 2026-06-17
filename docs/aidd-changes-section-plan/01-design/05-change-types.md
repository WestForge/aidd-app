# Change Types

Keep change types plain and product-owner friendly.

## Recommended initial types

```text
implement-capability
update-capability
component-change
technical-refactor
bug-fix
ux-improvement
documentation-standards-change
spike-investigation
```

## Type descriptions

### Implement capability

Used when a capability exists and this Change implements a defined slice of it.

### Update capability

Used when an existing behaviour, capability description, or product expectation changes.

### Component change

Used when a component boundary, responsibility, contract, source mapping, or internal structure changes.

### Technical refactor

Used when the implementation changes but product behaviour should not.

### Bug fix

Used when observed behaviour differs from expected behaviour.

### UX improvement

Used when the user experience changes without necessarily changing core capability scope.

### Documentation / standards change

Used when project documentation, standards, templates, or process rules change.

### Spike / investigation

Used to answer a question before committing to implementation.

## Why type templates matter

The change type should shape the bundle that gets sent to an AI agent.

For example:

- A technical refactor bundle should be strict about behaviour preservation.
- A bug fix bundle should include reproduction steps.
- A capability implementation bundle should include the capability slice and out-of-scope guardrails.
- A spike should forbid production implementation unless explicitly approved.
