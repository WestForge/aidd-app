# Information Architecture and UI

## Sidebar

Add `Changes` between Components and Delivery.

Recommended order:

```text
Projects
Home
Foundation
Standards
Capabilities
Components
Changes
Delivery
Health Check
Settings
```

## Changes page layout

Use a two-pane or board/editor layout.

Left area:

```text
Draft
Ready
In delivery
In review
Accepted
Superseded
```

Main editor:

```text
Title
Type
Status
Priority
Risk
Linked capabilities
Linked components
Markdown section tabs
Delivery history
Review history
```

## Change editor sections

Recommended default tabs:

```text
Intent
Scope
Acceptance criteria
Linked context
Implementation notes
Decisions
Review
```

These should be Markdown-backed, like existing capability/component sections.

## Capability page changes

Remove direct delivery creation from capability editing.

Replace:

```text
Create delivery package
```

with:

```text
Plan change
```

or:

```text
Create change from capability
```

Also add a `Related changes` panel.

## Component page changes

Remove direct delivery creation from component technical changes.

Replace:

```text
Create delivery package
```

with:

```text
Promote to Change
```

or:

```text
Create change from this technical change
```

Imported technical reviews should feed global Changes. The current managed technical changes can remain as legacy/component-local records during migration.

## Delivery page changes

Delivery should no longer have a blank `New Delivery Package` button.

Replace it with either:

```text
Create package from ready changes
```

or keep creation only on the Changes page in phase 1.

Recommended phase 1 behaviour:

> The Delivery page lists existing packages only. New packages are created from the Changes page.

## Home page changes

Home should surface:

```text
Changes needing shaping
Ready changes
Delivery packages in progress
Reviews needing action
```

Do not make Home a second creation surface initially.
