# Implementation Checklist

## Phase 1 - Domain

- [ ] Add `electron/main/domain/changes.ts`.
- [ ] Add Change types to `electron/main/domain/types.ts`.
- [ ] Add `changes/index.md` creation support.
- [ ] Implement read/create/save/status/delete functions.
- [ ] Implement create from capability/component/technical change helpers.
- [ ] Implement readiness evaluation.

## Phase 2 - IPC and preload

- [ ] Add IPC handlers in `electron/main/ipc/projectDomainIpc.ts`.
- [ ] Add preload methods in `electron/preload.ts`.
- [ ] Add renderer types in `src/vite-env.d.ts`.
- [ ] Export domain methods from service aggregation if required.

## Phase 3 - Changes UI

- [ ] Create `src/components/Changes.tsx`.
- [ ] Add list/status grouping.
- [ ] Add create/edit form.
- [ ] Add linked capability/component pickers.
- [ ] Add markdown section editor.
- [ ] Add readiness panel.
- [ ] Add create delivery package from ready Change.

## Phase 4 - Navigation

- [ ] Add `changes` to `Screen` union in `src/main.tsx`.
- [ ] Render `Changes` screen.
- [ ] Add Changes to `src/components/Sidebar.tsx`.
- [ ] Add PageHelp entry.

## Phase 5 - Remove direct delivery creation

- [ ] Replace capability `Create delivery package` with `Plan change`.
- [ ] Replace component technical change `Create delivery package` with `Create global Change`.
- [ ] Remove blank `New Delivery Package` from Delivery page.
- [ ] Update Home if it exposes direct package creation.

## Phase 6 - Delivery from Changes

- [ ] Add `createDeliveryPackageFromChanges` to `delivery.ts`.
- [ ] Add `packageType: 'change'` support.
- [ ] Generate snapshot from Changes + linked context.
- [ ] Generate strategy based on Change type.
- [ ] Append delivery package IDs to Changes.
- [ ] Mark Changes as `in-delivery`.

## Phase 7 - Health/repair/status

- [ ] Update project validation.
- [ ] Update project repair.
- [ ] Update project status counts.
- [ ] Update repair script if needed.

## Phase 8 - Tests and verification

- [ ] Add domain tests.
- [ ] Add delivery-from-change tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run existing regression tests.
