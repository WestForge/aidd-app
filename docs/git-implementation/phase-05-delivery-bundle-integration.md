# Phase 05 - Delivery Bundle Integration

## Goal

Integrate Git-backed project state with AIDD delivery bundles so each bundle can be traced back to the exact project definition and implementation context used to create it.

This phase connects the sync workflow to delivery control.

## Product intent

The user should experience this as:

> This delivery bundle was created from this version of the project definition.

They should not need to understand commit hashes, refs, remotes, or Git internals.

## Depends on

- Phase 03 Hidden Sync Workflow.
- Phase 04 Conflict-Safe Collaboration.
- Reliable project sync status.
- Local repository state available.
- Safe checkpoint commits.

## User-facing outcomes

Delivery bundles should show:

- Project name.
- Bundle name or implementation slice.
- Creation time.
- Whether the project was synced before export.
- Source repository provider.
- Repository URL.
- Default branch.
- Safe source revision reference.
- Whether there were unsynced local changes.

## Non-goals

Do not implement:

- CI/CD automation.
- GitHub Actions or GitLab CI workflows.
- Automated deployment.
- Pull request creation.
- Release tagging.
- Full audit dashboard.

Those can come in later phases.

## Bundle metadata

Add Git-backed metadata to delivery bundles.

Suggested file:

```text
delivery-metadata.json
```

Suggested content:

```json
{
  "projectName": "Stormbane",
  "bundleName": "IMP-012-runtime-core",
  "createdAt": "2026-06-11T10:30:00.000Z",
  "git": {
    "provider": "github",
    "repoUrl": "https://github.com/org/repo.git",
    "branch": "main",
    "commit": "abc123...",
    "syncedBeforeExport": true,
    "hadUncommittedChanges": false
  }
}
```

Never include:

- Access tokens.
- Credential store keys.
- Local machine usernames unless explicitly required.
- Full local filesystem paths unless required.
- `.git` directory content.
- App-private settings.

## Export behaviour

Before creating a delivery bundle:

1. Check active project.
2. Check Git connection status.
3. Check sync status.
4. Detect uncommitted changes.
5. Offer to sync first if safe.
6. If not synced, allow export but mark bundle as unsynced.
7. Capture current commit reference if available.
8. Write safe metadata into the bundle.

## User-facing prompts

If project is synced:

```text
This bundle will include the current shared project version.
```

If local changes are not synced:

```text
This project has local changes that have not been shared yet. You can sync first or export the bundle as a local snapshot.
```

If conflicts exist:

```text
This project needs review before it can be safely shared. You can still export a local review snapshot.
```

Avoid Git-heavy prompts like:

```text
Working tree is dirty.
Branch is ahead of origin/main.
```

## Bundle traceability

Each bundle should be traceable to:

- AIDD project.
- Implementation slice.
- Source documents.
- Git provider.
- Repository URL.
- Branch.
- Commit reference, if available.
- Sync state at export time.

This gives reviewers confidence that the bundle matches a known project state.

## Local snapshot mode

Support local snapshot exports when the project is not synced.

Mark metadata clearly:

```json
{
  "syncedBeforeExport": false,
  "hadUncommittedChanges": true,
  "snapshotType": "local"
}
```

This is useful when work is in progress, but the bundle should not pretend to represent the shared repository state.

## Suggested IPC API

Add or extend delivery bundle APIs:

```ts
delivery:createBundle(input)
delivery:getBundleSourceState(projectPathOrId)
```

Or, if delivery APIs already exist, extend their input/output contracts with source state metadata.

## Suggested TypeScript contracts

```ts
export interface AiddDeliverySourceState {
  connected: boolean;
  synced: boolean;
  provider?: 'github' | 'gitlab';
  repoUrl?: string;
  branch?: string;
  commit?: string;
  hasUncommittedChanges: boolean;
  reviewNeeded: boolean;
  message: string;
}

export interface AiddDeliveryBundleMetadata {
  projectName: string;
  bundleName: string;
  createdAt: string;
  git?: {
    provider?: 'github' | 'gitlab';
    repoUrl?: string;
    branch?: string;
    commit?: string;
    syncedBeforeExport: boolean;
    hadUncommittedChanges: boolean;
    reviewNeeded: boolean;
  };
}
```

## UI location

Likely areas:

- Delivery bundle creation flow.
- Implementation slice export flow.
- Bundle review screen.

Add a source-state panel before export.

Example labels:

- `Shared project version`
- `Local snapshot`
- `Review needed before sharing`
- `Synced before export`

## Suggested files changed

Likely new files:

```text
electron/services/deliverySourceState.ts
electron/services/deliveryMetadataWriter.ts
```

Likely changed files:

```text
electron/main.ts
electron/preload.ts
electron/services/gitSyncWorkflow.ts
src/components/DeliveryBundles.tsx
src/vite-env.d.ts
```

Actual component names should follow the current app structure.

## Acceptance criteria

### Metadata

- Delivery bundle includes safe Git metadata when project is connected.
- Delivery bundle includes commit reference when available.
- Delivery bundle records whether project was synced before export.
- Delivery bundle records whether local uncommitted changes existed.
- Delivery bundle records review-needed state when conflicts exist.
- Delivery bundle does not include credentials.

### Export flow

- User can sync before export when safe.
- User can export a local snapshot when not synced.
- User is warned when exporting unsynced local changes.
- User is warned when review is needed.
- Export does not force sync.
- Export does not push automatically unless user chooses sync first.

### Security

- Token is not included in bundle metadata.
- Credential identifiers are not included in bundle metadata.
- `.git` directory is not included in bundle.
- App-private files are not included in bundle.
- Local absolute paths are avoided unless explicitly required.

### UX

- Product owner can understand whether the bundle represents shared project state or a local snapshot.
- Reviewers can trace the bundle back to source state.
- No Git command UI is exposed.

## Manual verification

Verify:

- Bundle from synced project.
- Bundle from local unsynced changes.
- Bundle from disconnected project.
- Bundle when review is needed.
- Metadata contains repository URL and branch.
- Metadata contains commit when available.
- Metadata contains no token.
- Bundle contains no `.git` directory.
- Bundle contains no `.aidd-app` secrets.
- Export does not modify Git state unexpectedly.

## Notes

This phase makes Git useful to the delivery process without making Git visible as the product.

The key value is traceability:

> What project state did this delivery bundle come from?
