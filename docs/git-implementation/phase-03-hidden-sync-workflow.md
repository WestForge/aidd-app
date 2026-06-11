# Phase 03 - Hidden Sync Workflow

## Goal

Add a product-owner-safe sync workflow that keeps the project workspace in sync with the configured GitHub or GitLab repository without exposing Git operations.

This phase introduces the first real synchronisation flow.

## Product intent

The user should experience this as:

> Save and share my project updates.
> Get the latest shared project updates.

They should not need to understand commit, pull, push, fetch, merge, rebase, staging, or remotes.

## Depends on

- Phase 01 Git Sync Settings.
- Phase 02 Project Repository Connection.
- Secure credential storage.
- Connected local repository.
- Configured default branch.
- Sanitised Git operation errors.

## User-facing actions

Add a primary action:

- Sync project

Optional supporting actions:

- Check for updates
- Save project snapshot
- View last sync status

## Non-goals

Do not implement:

- Conflict resolution UI.
- AI-assisted merge summaries.
- Branch workflows.
- Manual commit UI.
- Manual push or pull UI.
- Delivery bundle publishing.

Conflicts should be detected and safely blocked, then handled in Phase 04.

## Sync model

Use a simple hidden sync sequence:

1. Validate active project.
2. Validate Git Sync settings.
3. Validate saved token.
4. Validate local repository connection.
5. Detect local changes.
6. Create a safe local checkpoint commit if needed.
7. Fetch remote updates.
8. Determine whether the remote branch has new changes.
9. Pull or merge only when safe.
10. Push local checkpoint if safe.
11. Return product-friendly status.

## Suggested product wording

Use:

```text
Sync project
Project is up to date
Your changes were shared
New shared updates were received
Sync needs review
```

Avoid:

```text
commit
pull
push
merge
rebase
fast-forward
origin/main
```

## Checkpoint commits

When there are local changes, create an automatic checkpoint commit.

Suggested commit format:

```text
AIDD sync checkpoint: <project name> <timestamp>
```

Example:

```text
AIDD sync checkpoint: Stormbane 2026-06-11 10:30
```

Do not ask product owners to write commit messages.

Do not expose commit hashes in the main UI unless required for diagnostics.

## What to include in checkpoint commits

Include project-owned documents and safe app-generated files.

Usually include:

```text
*.md
*.mdx
docs/**
implementation/**
decisions/**
architecture/**
product/**
```

Do not include:

```text
node_modules/**
dist/**
build/**
.env
.aidd-app/**
delivery packages containing secrets
temporary files
OS metadata files
```

Respect `.gitignore`.

## Pull strategy

Only perform automatic remote integration when safe.

Safe cases:

- No local changes and remote has updates.
- Local checkpoint exists and remote can fast-forward or merge cleanly.
- Local ahead only and remote has no new changes.

Unsafe cases:

- Local and remote both changed the same files.
- Merge produces conflicts.
- Repository is in an unexpected state.
- Untracked files would be overwritten.
- Remote history was rewritten.

When unsafe, stop and return a review-needed state.

Do not overwrite local changes.

Do not force push.

Do not reset hard.

## Push strategy

Push only when:

- Local branch is connected to the configured default branch.
- Remote has been checked.
- No conflict or unsafe divergence exists.
- Local checkpoint commit exists or local commits are ready to share.

Never force push.

Never push credentials in remote URLs.

## Suggested IPC API

Add:

```ts
gitSync:syncProject(projectPathOrId)
gitSync:checkForUpdates(projectPathOrId)
gitSync:getSyncStatus(projectPathOrId)
```

## Suggested TypeScript contracts

```ts
export interface AiddGitSyncStatus {
  state:
    | 'not_connected'
    | 'up_to_date'
    | 'local_changes'
    | 'remote_updates_available'
    | 'syncing'
    | 'synced'
    | 'review_needed'
    | 'error';
  message: string;
  lastSyncAt?: string;
  lastCheckpointLabel?: string;
}

export interface AiddGitSyncResult {
  ok: boolean;
  code:
    | 'OK'
    | 'NOT_CONNECTED'
    | 'MISSING_TOKEN'
    | 'LOCAL_CHECKPOINT_FAILED'
    | 'REMOTE_CHECK_FAILED'
    | 'PULL_FAILED'
    | 'PUSH_FAILED'
    | 'CONFLICT_DETECTED'
    | 'UNSAFE_REPOSITORY_STATE'
    | 'UNKNOWN_ERROR';
  message: string;
  status: AiddGitSyncStatus;
}
```

## UI location

Use `Sync.tsx`.

Recommended layout:

- Current sync state.
- Repository provider and URL.
- Default branch.
- Last sync time.
- Primary `Sync project` button.
- Secondary `Check for updates` button.
- Friendly result message.

## Error handling

Return product-friendly messages.

Examples:

```text
Your project has changes that need review before they can be shared.
```

```text
The repository could not be reached. Check your connection and Git Sync settings.
```

```text
Your saved token no longer has access to this repository.
```

Do not show raw Git errors by default.

Optionally allow a developer diagnostics drawer later, but do not include credentials.

## Suggested files changed

Likely new files:

```text
electron/services/gitSyncWorkflow.ts
electron/services/gitStatusMapper.ts
```

Likely changed files:

```text
electron/main.ts
electron/preload.ts
electron/services/gitService.ts
src/components/Sync.tsx
src/vite-env.d.ts
```

## Acceptance criteria

### Sync behaviour

- User can run `Sync project`.
- Local changes are checkpointed automatically.
- Remote updates are checked before push.
- Local-only changes can be shared.
- Remote-only updates can be received.
- Up-to-date projects report as up to date.
- Unsafe conflict states stop the sync.
- No destructive Git operation is performed.

### Security

- Token is read only from secure credential storage.
- Token is not written to Git config.
- Token is not written to remote URLs.
- Token is not logged.
- Token is not returned to renderer.
- Errors are sanitised.

### UX

- UI uses product-friendly language.
- Product owner does not need to write commit messages.
- Product owner does not see Git commands.
- Product owner gets a clear success, up-to-date, or review-needed result.

## Manual verification

Verify:

- Sync with no local or remote changes.
- Sync with local-only document change.
- Sync with remote-only document change.
- Sync with both local and remote non-conflicting changes.
- Sync with conflicting changes.
- Sync with missing token.
- Sync with expired/revoked token.
- Sync with no network.
- Sync does not force push.
- Sync does not reset local work.
- Token never appears in logs or config.

## Notes

This phase is where the hidden Git workflow becomes valuable.

The product-owner-facing concept is not Git.

The product-owner-facing concept is:

> Keep my project definition safely in sync with the team.
