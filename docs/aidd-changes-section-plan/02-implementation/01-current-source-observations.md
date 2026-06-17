# Current Source Observations

These notes are based on the uploaded `aidd-app.zip` source tree.

## Existing direct delivery creation surfaces

### Capabilities

File:

```text
src/components/Capabilities.tsx
```

Observed responsibilities:

- Receives `onDeliveryPackageCreated` prop.
- Calculates readiness through `canCreateDeliveryPackage`.
- Calls `window.aidd.createDeliveryPackageFromCapability`.
- Shows a `Create delivery package` button.

Recommended change:

- Replace direct delivery package creation with `createChangeFromCapability`.
- Show related Changes for the selected capability.
- Keep capability review packaging separate from delivery packaging.

### Components

File:

```text
src/components/Components.tsx
```

Observed responsibilities:

- Receives `onDeliveryPackageCreated` prop.
- Contains managed component technical changes.
- Calls `window.aidd.createDeliveryPackageFromTechnicalChange`.
- Shows `Create delivery package` for approved technical changes.
- Tracks `deliveryPackageIds` on component technical changes.

Recommended change:

- Replace `Create delivery package` with `Create/Promote global Change`.
- Keep component technical reviews and technical change import working.
- Treat component technical changes as inputs to global Changes, not final delivery sources.

### Delivery packages

File:

```text
src/components/DeliveryPackages.tsx
```

Observed responsibilities:

- Has `onCreatePackage` prop.
- Shows `New Delivery Package`.
- Reads delivery packages from disk through `window.aidd.readDeliveryPackages`.

Recommended change:

- Remove blank package creation.
- Delivery page should list/manage existing delivery packages.
- Creation should happen from ready Changes.

### Main app routing

File:

```text
src/main.tsx
```

Observed responsibilities:

- Defines `Screen` union without `changes`.
- Imports and renders Capabilities, Components, DeliveryPackages, BundleEditor.
- Maintains older in-memory `packages` state for legacy/sample bundles.
- Wires direct package creation into Home and Delivery.

Recommended change:

- Add `changes` to `Screen`.
- Import and render `Changes`.
- Add `openCreatedChange` routing helper.
- Remove or isolate old `createPackage` from real disk-backed delivery flow.

### Sidebar

File:

```text
src/components/Sidebar.tsx
```

Observed responsibilities:

- Sidebar items include Foundation, Standards, Capabilities, Components, Delivery.
- No Changes item.

Recommended change:

- Add Changes between Components and Delivery.
- Use an icon such as `GitPullRequestArrow`, `Route`, `ListTodo`, or `FilePenLine` from lucide-react.

## Existing backend delivery functions

File:

```text
electron/main/domain/delivery.ts
```

Observed functions:

```ts
createDeliveryPackageFromCapability(input)
createDeliveryPackageFromTechnicalChange(input)
readDeliveryPackages(projectPath)
readDeliveryPackage(input)
saveDeliveryPackage(input)
createDeliveryPackagePhase(input)
assembleDeliveryPackage(input)
publishDeliveryPackageToWorkspace(input)
createDeliveryPackageReviewBundle(input)
importDeliveryReviewPackage(input)
```

Recommended change:

- Add `createDeliveryPackageFromChanges(input)`.
- Keep old functions initially for compatibility, but remove UI usage.
- Update package type handling to include `change`.

## Existing IPC/preload/types

Files:

```text
electron/main/ipc/projectDomainIpc.ts
electron/preload.ts
src/vite-env.d.ts
electron/main/domain/types.ts
```

Observed API methods:

```ts
createDeliveryPackageFromCapability
createDeliveryPackageFromTechnicalChange
readDeliveryPackages
readDeliveryPackage
saveDeliveryPackage
createDeliveryPackagePhase
assembleDeliveryPackage
publishDeliveryPackageToWorkspace
packageDeliveryPackageForReview
importDeliveryReviewPackage
readDecisions
createDecision
```

Recommended change:

- Add Change APIs across all these files.
- Add `createDeliveryPackageFromChanges`.
- Leave existing delivery APIs in place until compatibility migration is complete.

## Existing Decisions component

Files:

```text
src/components/Decisions.tsx
electron/main/domain/sourceDecisionsGit.ts
```

Observed state:

- There is a Decisions UI and backend record support.
- It is not wired into the main sidebar/routing in the observed source.
- It is narrower than the desired Change concept.

Recommendation:

- Do not make Decisions the new top-level section.
- Reuse design ideas only if useful.
- Put a decision log inside each Change.
