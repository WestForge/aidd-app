# Phase 02 - Project Repository Connection

## Goal

Connect the active AIDD project workspace to the configured remote repository in a safe, hidden way.

This phase turns the saved Git Sync settings from Phase 01 into a usable project repository connection.

It should still avoid exposing Git concepts to product owners.

## Product intent

The user should experience this as:

> This project is connected to the shared repository.

They should not need to understand remotes, branches, upstream tracking, fetch, pull, or push.

## Depends on

- Phase 01 Git Sync Settings.
- Secure token storage.
- Non-secret repository metadata.
- Test connection working against GitHub and GitLab.
- Main-process Git service isolated from renderer code.

## User-facing actions

Add or enable one project-level action:

- Connect project to repository

Optional supporting actions:

- Check connection
- Disconnect project from repository

## Non-goals

Do not implement:

- Automatic sync.
- Automatic pull.
- Automatic push.
- Merge conflict handling.
- Branch creation.
- Branch switching.
- Delivery bundle publishing.
- Manual Git command UI.
- SSH support.

## Behaviour

When the user connects the project:

1. Verify there is an active project.
2. Load saved Git Sync settings.
3. Resolve the saved token from secure credential storage.
4. Validate the repository URL.
5. Validate the configured default branch exists remotely.
6. Ensure the local project has a Git repository.
7. Add or update the `origin` remote without embedding the token.
8. Configure local author name and email.
9. Record safe connection metadata.
10. Return a friendly status.

## Important security rule

The Git remote URL must not contain credentials.

Allowed:

```text
https://github.com/org/repo.git
```

Forbidden:

```text
https://TOKEN@github.com/org/repo.git
https://user:TOKEN@gitlab.com/group/repo.git
```

Authentication must happen through the Git library auth callback, not through the remote URL.

## Local repository handling

If the active project is not already a Git repository:

- Initialise Git locally.
- Keep existing AIDD ignore behaviour.
- Do not commit automatically in this phase unless the existing app already does so during project creation.

If the active project is already a Git repository:

- Preserve it.
- Do not destroy local history.
- Do not force reset.
- Do not overwrite existing remotes without a safe check.

## Remote handling

If `origin` does not exist:

- Add `origin` using the configured repository URL.

If `origin` exists and matches the configured URL:

- Keep it.

If `origin` exists and differs:

- Return a safe warning.
- Do not overwrite it automatically unless the user confirms through a product-friendly message.

Suggested product message:

```text
This project is already connected to a different repository. Review the repository URL before changing it.
```

Avoid showing Git jargon like "remote origin mismatch" in the main UI.

## Branch handling

For Phase 02, use only the configured default branch.

Recommended default:

```text
main
```

Do not expose branch switching to product owners.

Do not auto-create branches in this phase.

If the configured branch does not exist remotely:

- Return a friendly failure.
- Suggest checking the repository settings.

## Author handling

Configure local Git author details from Phase 01 settings.

Use:

- Author name
- Author email

Store them in local Git config for the project repository.

Do not use global Git config.

## Suggested IPC API

Add main-process IPC handlers:

```ts
gitSync:connectProject(projectPathOrId)
gitSync:disconnectProject(projectPathOrId)
gitSync:getProjectConnectionStatus(projectPathOrId)
```

The renderer should call these through `window.aidd.gitSync`.

## Suggested TypeScript contracts

```ts
export interface AiddGitProjectConnectionStatus {
  connected: boolean;
  provider?: 'github' | 'gitlab';
  repoUrl?: string;
  branch?: string;
  lastCheckedAt?: string;
  message: string;
}

export interface AiddGitProjectConnectionResult {
  ok: boolean;
  code:
    | 'OK'
    | 'MISSING_PROJECT'
    | 'MISSING_SETTINGS'
    | 'MISSING_TOKEN'
    | 'INVALID_REPO_URL'
    | 'AUTH_FAILED'
    | 'BRANCH_NOT_FOUND'
    | 'REMOTE_MISMATCH'
    | 'LOCAL_REPO_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
  status?: AiddGitProjectConnectionStatus;
}
```

## Suggested files changed

Likely new files:

```text
electron/services/gitProjectConnector.ts
electron/services/gitProjectConnectionStore.ts
```

Likely changed files:

```text
electron/main.ts
electron/preload.ts
electron/services/gitService.ts
src/components/Sync.tsx
src/vite-env.d.ts
```

## UI location

The primary UI likely belongs in `Sync.tsx`.

Settings remains responsible for configuration.

Sync becomes responsible for showing project connection state.

Recommended `Sync.tsx` sections:

- Repository connection status.
- Connected repository URL.
- Default branch.
- Last checked time.
- Connect project button.
- Check connection button.
- Disconnect button.

Keep the wording product-friendly.

Use labels like:

```text
Connected
Not connected
Connection needs attention
```

Avoid labels like:

```text
origin
upstream
fetch
tracking branch
```

## Acceptance criteria

### Connection

- User can connect the active project to the configured repository.
- Local Git repository is initialised if missing.
- Existing local Git repository is preserved.
- `origin` remote is added without credentials.
- Existing matching `origin` remote is reused.
- Existing conflicting `origin` remote is not overwritten silently.
- Default branch is validated remotely.
- Local author name and email are configured for the project.

### Security

- Token is never written to remote URLs.
- Token is never written to Git config.
- Token is never written to project files.
- Token is never logged.
- Token is never returned to the renderer.
- Connection errors are sanitised.

### UX

- Product owner sees a simple connection status.
- Product owner can check connection without understanding Git.
- Product owner is warned if the project is already connected to a different repository.
- No Git command UI is exposed.

## Manual verification

Verify:

- Connect new project to GitHub repository.
- Connect new project to GitLab repository.
- Reopen app and connection status remains.
- Remote URL does not include token.
- Local `.git/config` does not include token.
- Existing repository is not overwritten.
- Existing mismatched remote returns a safe warning.
- Missing token returns a useful message.
- Invalid branch returns a useful message.

## Notes

This phase should make the project repository-aware, but not yet sync automatically.

The safest mental model is:

> Phase 01 stores the cloud connection.
> Phase 02 attaches the project to that cloud connection.
