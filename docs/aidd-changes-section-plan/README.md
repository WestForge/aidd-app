# AIDD Changes Section - Design and Implementation Plan

This bundle captures the proposed design and implementation plan for introducing a first-class **Changes** section into AIDD.

The core design decision is:

> Capabilities and components describe the system. Changes describe intended work. Delivery packages execute approved changes.

## Contents

- `01-design/` - domain design, navigation, lifecycle, delivery separation, and change type templates.
- `02-implementation/` - source-specific implementation plan based on the uploaded AIDD source tree.
- `03-change-templates/` - Markdown templates for each change type.
- `04-reference/` - draft JSON schema, TypeScript interfaces, IPC contract sketch, filesystem layout, and agent handoff prompt.
- `05-migration/` - migration and compatibility notes for existing delivery packages and component technical changes.
- `06-checklists/` - implementation checklist, acceptance criteria, and test matrix.

## Recommended implementation strategy

Implement this as a controlled refactor, not a large rewrite:

1. Add the new `changes/` domain and read/write APIs.
2. Add the Changes page and navigation.
3. Add change templates and linking to capabilities/components.
4. Replace direct delivery creation buttons with `Plan Change` / `Create Change` actions.
5. Add `createDeliveryPackageFromChanges`.
6. Keep old delivery packages and component technical changes readable.
7. Update health check, repair, project status, and tests.

## Target rule

No new delivery package should be created unless it is generated from one or more ready Changes.
