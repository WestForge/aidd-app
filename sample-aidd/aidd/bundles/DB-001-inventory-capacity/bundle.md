---
id: DB-001
title: Inventory Capacity Rules
status: draft
workstream: Inventory
capability: Inventory Capacity
owner: Francis
approvals:
  product: pending
  architecture: pending
  delivery: pending
lastUpdated: 2026-06-10
---

# Goal

Define clear inventory capacity behaviour so pickup and storage rules are predictable.

# Rationale

The current design does not make it clear what happens when the player inventory is full.

# In Scope

- Define full inventory pickup behaviour
- Define player feedback when pickup fails

# Out of Scope

- Inventory UI redesign
- Item rarity balancing

# Linked Context

- aidd/capabilities/inventory-capacity.md

# Acceptance Criteria

- Given inventory is full, when the player attempts pickup, then the item is not added.
- Given pickup fails, the player receives clear feedback.

# Verification Plan

- Test full inventory pickup
- Test normal pickup
- Review failure feedback copy
