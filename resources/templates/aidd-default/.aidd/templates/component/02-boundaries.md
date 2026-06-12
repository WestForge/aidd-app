---
aidd:
  type: component-document
  id: __COMPONENT_SLUG__-02-boundaries
  title: Boundaries
  status: not-started
  required: true
  templateVersion: 0.8.0
---

# __COMPONENT_TITLE__ Boundaries

## Owns

- TODO: List responsibilities, state, assets, or services this component owns.

## Does Not Own

- TODO: List responsibilities owned by other components or systems.

## May Depend On

- TODO: List allowed component or platform dependencies.

## May Be Used By

- TODO: List expected consumers.

## Exposes

- TODO: List public interfaces, events, data contracts, services, tools, or extension points.

## Forbidden Coupling

- TODO: List things implementations must not do across this boundary.

## Boundary Change Rules

Changing this component boundary requires a decision record when:

- a new component dependency is introduced
- ownership of runtime state moves between components
- another component starts writing component-owned state
- this component starts directly controlling another component's responsibilities
- a capability requires behaviour that does not fit the existing boundary
