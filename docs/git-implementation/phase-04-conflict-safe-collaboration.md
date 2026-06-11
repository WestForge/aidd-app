# Phase 04 - Conflict-Safe Collaboration

## Goal

Handle concurrent project changes safely when two people or agents edit the same AIDD project content.

This phase prevents destructive overwrites and introduces a product-owner-friendly review flow for conflicts.

## Product intent

The user should experience this as:

> Some shared project updates need review before they can be combined.

They should not need to understand Git merge conflicts.

## Depends on

- Phase 03 Hidden Sync Workflow.
- Conflict detection during sync.
- Safe stopping behaviour when automatic sync cannot complete.
- Non-destructive local checkpoint commits.

## User-facing states

Add clear sync states:

- Synced
- Review needed
- Local changes saved
- Shared updates available
- Unable to combine automatically

## Non-goals

Do not implement:

- Full developer merge tooling.
- Manual Git conflict marker editing.
- Branch visualisation.
- Rebase UI.
- Force push.
- Automatic conflict resolution without user review.

## Conflict detection

Detect and stop safely when:

- Git reports merge conflicts.
- Untracked files would be overwritten.
- Local and remote changed the same tracked file.
- The repository is in the middle of an unexpected Git operation.
- The active branch is not the configured default branch.
- Remote history has changed in an unsafe way.

## Conflict handling model

When a conflict is detected:

1. Stop the sync.
2. Preserve local changes.
3. Preserve remote changes where possible.
4. Generate a review package.
5. Show a product-friendly review-needed status.
6. Do not overwrite either side.
7. Do not force push.
8. Do not auto-resolve.

## Review package

Create a review package outside the normal project docs, or in a clearly marked app-managed location.

Recommended location:

```text
.aidd-app/reviews/<timestamp>-sync-review/
```

Important:

- Do not include secrets.
- Do not include tokens.
- Do not include hidden credentials.
- Do not package `.git`.

Suggested files:

```text
summary.md
local-version/<path>
remote-version/<path>
base-version/<path>
changed-files.json
review-state.json
```

If `.aidd-app` is inside the workspace, ensure it remains ignored by Git.

## Review summary

Generate a human-readable summary.

Example:

```md
# Sync Review Needed

AIDD could not safely combine local and shared updates.

## Files needing review

- product/audience.md
- implementation/IMP-012/index.mdx

## What happened

Your local project and the shared repository both changed the same files.

## Recommended action

Review the differences and choose which changes to keep.
```

## AI-assisted summary

This phase may introduce AI-assisted summaries, but not AI auto-resolution.

AI can help explain:

- Which files changed.
- What appears different.
- Which sections may need human attention.
- Whether the conflict looks structural or content-based.

AI must not silently choose a winner.

## User-facing resolution options

For each conflicted file, provide product-friendly choices:

- Keep my version
- Use shared version
- Open both versions for manual review
- Create a combined draft for review

The combined draft must be reviewable before it replaces the project file.

## Safe resolution flow

When user chooses a resolution:

1. Apply the selected version or approved combined draft.
2. Remove conflict markers if any were created.
3. Validate that the file remains readable.
4. Create a new checkpoint commit.
5. Resume sync only if the repository is safe.
6. Push only after remote state is rechecked.

## Avoid raw conflict markers in primary UI

Do not show this as the main product-owner experience:

```text
<<<<<<< HEAD
local content
=======
remote content
>>>>>>> origin/main
```

Raw conflict markers may be available in a developer diagnostics view, but not as the main review workflow.

## Suggested IPC API

Add:

```ts
gitSync:getReviewState(projectPathOrId)
gitSync:listReviewFiles(projectPathOrId)
gitSync:readReviewFile(input)
gitSync:resolveReviewFile(input)
gitSync:completeReview(projectPathOrId)
gitSync:cancelReview(projectPathOrId)
```

## Suggested TypeScript contracts

```ts
export interface AiddGitReviewState {
  active: boolean;
  reviewId?: string;
  createdAt?: string;
  status: 'none' | 'pending' | 'partially_resolved' | 'ready_to_complete' | 'completed';
  message: string;
  files: AiddGitReviewFile[];
}

export interface AiddGitReviewFile {
  path: string;
  status: 'unresolved' | 'resolved';
  options: Array<'keep_local' | 'use_shared' | 'manual_review' | 'combined_draft'>;
}

export interface AiddGitResolveReviewFileInput {
  projectPath: string;
  reviewId: string;
  filePath: string;
  resolution: 'keep_local' | 'use_shared' | 'use_combined_draft';
  combinedContent?: string;
}
```

## UI location

Use `Sync.tsx`, with a review-needed panel.

Possible layout:

- Status banner: `Review needed`
- Short explanation.
- List of files needing review.
- Per-file review actions.
- Complete review button.
- Cancel review button.

Do not expose Git terminology unless in an optional diagnostics section.

## Suggested files changed

Likely new files:

```text
electron/services/gitConflictDetector.ts
electron/services/gitReviewPackageStore.ts
electron/services/gitReviewResolver.ts
```

Likely changed files:

```text
electron/services/gitSyncWorkflow.ts
electron/main.ts
electron/preload.ts
src/components/Sync.tsx
src/vite-env.d.ts
```

## Acceptance criteria

### Conflict safety

- Conflicting local and remote changes stop sync.
- Local changes are preserved.
- Remote changes are preserved where possible.
- No destructive overwrite occurs.
- No force push occurs.
- No hard reset occurs.
- Review package is generated.
- Review package contains no secrets.

### Review flow

- User sees a clear review-needed state.
- User can inspect conflicted files.
- User can keep local version.
- User can use shared version.
- User can create or approve a combined draft.
- User can complete review after resolving all files.
- Sync can resume after review is complete.

### Security

- Token is not included in review packages.
- `.git` data is not included in review packages.
- App logs do not include token.
- Raw errors are sanitised.

### UX

- Product owner does not see raw Git commands.
- Product owner does not need to understand merge conflict markers.
- Product owner gets clear choices.

## Manual verification

Verify:

- Conflict on one Markdown file.
- Conflict on multiple files.
- Non-conflicting concurrent changes.
- Untracked file overwrite risk.
- Review package creation.
- Keep local resolution.
- Use shared resolution.
- Combined draft resolution.
- Resume sync after review.
- Cancel review does not destroy local work.

## Notes

This phase is critical because hidden Git only works if it is safe.

The product-owner experience should be:

> AIDD found overlapping changes and is helping you choose what to keep.

Not:

> Git merge failed.
