# Renderer Plan

## New component

Create:

```text
src/components/Changes.tsx
```

## Main app wiring

Update:

```text
src/main.tsx
```

Add:

```ts
import { Changes } from './components/Changes';
```

Update `Screen`:

```ts
export type Screen =
  | 'projects'
  | 'project-create'
  | 'home'
  | 'foundation'
  | 'standards'
  | 'capabilities'
  | 'components'
  | 'changes'
  | 'delivery-packages'
  | 'bundle-editor'
  | 'reviews'
  | 'validation'
  | 'settings';
```

Add renderer branch:

```tsx
{screen === 'changes' && (
  <Changes
    activeProject={activeProject}
    initialChangeId={changeToOpen}
    onDeliveryPackageCreated={openCreatedDeliveryPackage}
  />
)}
```

Add routing helper:

```ts
const openCreatedChange = (id: string) => {
  setChangeToOpen(id);
  setScreen('changes');
};
```

## Sidebar

Update:

```text
src/components/Sidebar.tsx
```

Add a Changes item between Components and Delivery:

```ts
{ id: 'changes', label: 'Changes', icon: GitPullRequestArrow }
```

## Changes page behaviour

The first iteration should include:

```text
List all changes
Create a change manually
Open a change
Edit title/type/status/priority/risk
Link capabilities
Link components
Edit Markdown sections
Show readiness blockers
Create delivery package when ready
Open latest delivery package after creation
Delete/supersede change
```

## Minimal UI structure

```tsx
<main>
  <header>
    <h1>Changes</h1>
    <button>New Change</button>
  </header>

  <section className="grid">
    <aside>
      <StatusGroup status="draft" />
      <StatusGroup status="ready" />
      <StatusGroup status="in-delivery" />
      <StatusGroup status="in-review" />
      <StatusGroup status="accepted" />
    </aside>

    <article>
      <ChangeMetadataForm />
      <LinkedContextPickers />
      <ReadinessPanel />
      <MarkdownSectionEditor />
      <DeliveryHistory />
    </article>
  </section>
</main>
```

## Capability page change

Update:

```text
src/components/Capabilities.tsx
```

Remove or stop using:

```text
onDeliveryPackageCreated
canCreateDeliveryPackage
createDeliveryPackage
window.aidd.createDeliveryPackageFromCapability
```

Add:

```text
onChangeCreated?: (id: string) => void
createChangeFromCapability()
Related changes panel
```

Button copy:

```text
Plan change
```

## Component page change

Update:

```text
src/components/Components.tsx
```

Remove direct delivery creation buttons from technical change surfaces.

Replace with:

```text
Create global Change
Open linked Change
```

For legacy technical changes, show delivery package IDs as historical data only.

## Delivery page change

Update:

```text
src/components/DeliveryPackages.tsx
```

Remove:

```text
onCreatePackage
New Delivery Package
```

Add explanatory empty state:

```text
No delivery packages yet. Mark a Change as Ready, then create a delivery package from the Changes page.
```

Optional later:

```text
Ready changes drawer
```

## Page help

Update:

```text
src/components/PageHelp.tsx
```

Add help for the Changes screen.

Help copy:

> Changes describe the intended work before it is packaged for delivery. Link a change to capabilities and components, define scope and acceptance criteria, then create a delivery package only when the change is ready.
