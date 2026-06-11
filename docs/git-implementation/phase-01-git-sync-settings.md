# Phase 01 - Git Sync Settings

## Goal

Add a Git Sync section to AIDD Settings so a project can be connected to GitHub or GitLab without exposing Git concepts to product owners.

This phase is only about connection settings and safe credential handling.

It does **not** implement automatic syncing, merging, conflict handling, delivery bundle publishing, branch workflows, or product-owner-facing Git operations.

## Product intent

Product owners should see a simple "Git Sync" settings area.

They should be able to:

- Choose GitHub or GitLab.
- Enter a repository URL.
- Enter the default branch.
- Enter author details.
- Enter an access token.
- Test the connection.
- Save the settings.
- Clear the token.

They should not need to understand:

- Remotes.
- Fetch.
- Pull.
- Push.
- Branch tracking.
- Merge.
- Rebase.
- Conflict resolution.
- Git credential helpers.

## User-facing fields

- Provider: `GitHub` or `GitLab`
- Repository URL
- Default branch, usually `main`
- Access token, masked after entry
- Author name
- Author email

## User-facing actions

- Test connection
- Save settings
- Clear token

## Non-goals

Do not add any of the following in this phase:

- Automatic commit.
- Automatic push.
- Automatic pull.
- Merge conflict handling.
- Branch switching.
- Repository cloning into the active project.
- Delivery bundle publishing.
- User-facing Git history.
- Product-owner-facing merge tools.
- Manual Git command UI.
- Storing credentials inside the project workspace.

## Storage rules

The access token must not be stored in:

- Project files.
- `.aidd` files.
- `.aidd-app` files.
- Delivery packages.
- Generated Markdown or MDX.
- Logs.
- Git config.
- Git remote URLs.
- Browser local storage.
- Plain JSON settings files.

Project-safe settings may store only non-secret metadata.

Example:

```json
{
  "provider": "github",
  "repoUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "authorName": "Francis",
  "authorEmail": "francis@example.com",
  "hasToken": true
}
```

The real token must never be returned to the renderer after saving.

The renderer may only receive:

```json
{
  "hasToken": true
}
```

## Recommended storage model

Store non-secret Git Sync settings outside the project workspace.

Recommended location:

```text
app.getPath("userData")/projects/<project-id>/git-sync-settings.json
```

The `<project-id>` should be derived from the active project record, not from user-entered Git data.

Store the access token separately using OS credential storage.

Recommended dependency:

```text
keytar
```

Suggested credential identity:

```text
service: aidd-git-sync
account: <project-id>:<provider>
```

If OS credential storage is unavailable, fail safely.

Do not silently fall back to storing the token in a plain text file.

## Existing code to account for

The current app already has a partial Git foundation:

- `electron/main.ts` initialises Git during project creation.
- `src/services/gitService.ts` wraps `init`, `status`, `checkpoint`, `clone`, `push`, and `pull`.
- `ProjectCreate.tsx` already lets the user initialise Git versioning.
- `Sync.tsx` currently acts as a placeholder for hidden sync workflow.
- `Settings.tsx` currently contains only basic settings and is the right place for the Git Sync section.

## Structural change

Move Node/Electron Git functionality out of the renderer source tree.

Current location:

```text
src/services/gitService.ts
```

Recommended location:

```text
electron/services/gitService.ts
```

Reason:

The Git service imports Node-only modules such as `node:fs` and `isomorphic-git/http/node`.

Keeping this service under `src/` makes it too easy to accidentally import it into React renderer code.

Renderer code should interact with Git only through preload-safe APIs exposed on `window.aidd`.

## IPC API

Add main-process IPC handlers for Git Sync settings.

Recommended API:

```ts
gitSync:readSettings(projectPathOrId)
gitSync:saveSettings(input)
gitSync:testConnection(input)
gitSync:clearToken(projectPathOrId)
```

The renderer should not know where settings are stored.

The renderer should not know how credentials are stored.

The renderer should not receive the token after save.

## Suggested TypeScript contracts

Add or update global renderer-safe types.

```ts
export type GitProvider = 'github' | 'gitlab';

export interface AiddGitSyncSettings {
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  hasToken: boolean;
}

export interface AiddSaveGitSyncSettingsInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
  token?: string;
}

export interface AiddGitSyncTestInput {
  projectPath: string;
  provider: GitProvider;
  repoUrl: string;
  branch: string;
  token?: string;
}

export interface AiddGitSyncTestResult {
  ok: boolean;
  code:
    | 'OK'
    | 'MISSING_PROJECT'
    | 'INVALID_REPO_URL'
    | 'INVALID_PROVIDER'
    | 'MISSING_TOKEN'
    | 'AUTH_FAILED'
    | 'BRANCH_NOT_FOUND'
    | 'NETWORK_ERROR'
    | 'UNKNOWN_ERROR';
  message: string;
}
```

## Preload API

Expose safe functions through the existing preload bridge.

Example shape:

```ts
window.aidd.gitSync = {
  readSettings(projectPath),
  saveSettings(input),
  testConnection(input),
  clearToken(projectPath)
}
```

Do not expose generic IPC invoke/send methods to the renderer.

## Settings UI

Add a new Git Sync card to `Settings.tsx`.

The card should include:

- Provider select.
- Repository URL input.
- Default branch input.
- Author name input.
- Author email input.
- Token password input.
- Saved token status.
- Test connection button.
- Save settings button.
- Clear token button.

Recommended UI behaviour:

- Token field is blank on load even if a token exists.
- Show `Token saved` if `hasToken` is true.
- Entering a new token replaces the saved token only when settings are saved.
- Clear token removes the token but keeps non-secret settings.
- Test connection can use the newly entered token before it is saved.
- If no new token is entered, test connection should use the saved token when available.

## Repository URL validation

For Phase 01, only support HTTPS repository URLs.

Allowed examples:

```text
https://github.com/org/repo.git
https://gitlab.com/group/repo.git
```

Reject or defer:

```text
git@github.com:org/repo.git
ssh://git@gitlab.com/group/repo.git
```

Reason:

SSH introduces key management and a different authentication model that should be handled in a later phase.

## Token handling rules

The token may exist only in these places:

- The masked token input before saving.
- The IPC payload during save or test.
- Main-process memory during the operation.
- OS credential storage after save.

The token must never be:

- Logged.
- Written to disk as JSON.
- Written to project files.
- Written into Git remotes.
- Returned to the renderer.
- Included in thrown error messages.
- Included in generated documents.
- Included in delivery bundles.

## Test connection behaviour

`Test connection` should be non-destructive.

It should not:

- Clone the repository.
- Initialise a repository.
- Change the active project.
- Write Git config.
- Write project files.
- Push or pull.

Recommended behaviour:

- Validate provider.
- Validate HTTPS repository URL.
- Resolve token from entered token or saved token.
- Call a remote read operation such as listing remote refs.
- Check that the requested branch exists.
- Return a sanitised success or failure result.

Example success:

```json
{
  "ok": true,
  "code": "OK",
  "message": "Connected to GitHub and found branch main."
}
```

Example failure:

```json
{
  "ok": false,
  "code": "AUTH_FAILED",
  "message": "The token was rejected. Check repo access and token permissions."
}
```

## Provider authentication adapters

Hide provider-specific authentication details behind an adapter.

Example:

```ts
function createAuth(provider: GitProvider, token: string) {
  if (provider === 'github') {
    return () => ({ username: token, password: '' });
  }

  if (provider === 'gitlab') {
    return () => ({ username: 'oauth2', password: token });
  }

  throw new Error('Unsupported provider');
}
```

The exact auth shape should be verified during implementation against `isomorphic-git` and the providers being supported.

The UI should not expose these details.

## Error sanitisation

All errors returned to the renderer must be safe.

Do not return:

- Raw thrown errors.
- Full stack traces.
- Full remote URLs containing credentials.
- Provider SDK/internal error payloads.
- Environment details.

Return mapped codes and human-readable messages instead.

## Acceptance criteria

### UI

- Settings UI includes a Git Sync configuration card.
- Provider can be selected as GitHub or GitLab.
- Repository URL can be entered.
- Default branch can be entered.
- Author name and author email can be entered.
- Token input is masked.
- Token field is not repopulated with the saved token.
- UI shows whether a token is already saved.
- User can test the connection.
- User can save settings.
- User can clear the saved token.

### Persistence

- Non-secret settings survive app restart.
- Non-secret settings are stored outside project-controlled files.
- Token survives app restart when OS credential storage is available.
- Token is not written to the project workspace.
- Token is not written to `.aidd` or `.aidd-app`.
- Token is not written to Git remote URLs.
- Token is not returned from `readSettings`.

### Connection test

- Test connection reports success for a valid provider, URL, branch, and token.
- Test connection reports useful failure for invalid URL.
- Test connection reports useful failure for missing token.
- Test connection reports useful failure for rejected token.
- Test connection reports useful failure when the branch cannot be found.
- Test connection does not modify the active project.
- Test connection does not clone, push, pull, or commit.

### Security

- Token does not appear in console logs.
- Token does not appear in app logs.
- Token does not appear in generated files.
- Token does not appear in delivery packages.
- Token does not appear in Git config.
- Token does not appear in errors shown to the user.
- Token clear removes the OS credential entry.
- If secure credential storage is unavailable, the app fails safely and explains that the token could not be saved.

## Implementation order

### Step 1 - Move Git service to Electron side

Move:

```text
src/services/gitService.ts
```

To:

```text
electron/services/gitService.ts
```

Update imports accordingly.

Ensure renderer code does not import this service directly.

### Step 2 - Add settings persistence module

Create:

```text
electron/services/gitSyncSettingsStore.ts
```

Responsibilities:

- Resolve settings path from active project id/path.
- Read non-secret settings.
- Save non-secret settings.
- Preserve `hasToken` as derived state.
- Avoid writing into the project workspace.

### Step 3 - Add credential storage module

Create:

```text
electron/services/gitCredentialStore.ts
```

Responsibilities:

- Save token.
- Read token.
- Clear token.
- Return whether token exists.
- Fail safely if secure storage is unavailable.

### Step 4 - Add remote connection test

Create:

```text
electron/services/gitRemoteTester.ts
```

Responsibilities:

- Validate input.
- Resolve token.
- Create provider-specific auth.
- Query remote refs.
- Check branch.
- Return sanitised result.

### Step 5 - Add IPC handlers

Update `electron/main.ts`.

Add handlers for:

```text
gitSync:readSettings
gitSync:saveSettings
gitSync:testConnection
gitSync:clearToken
```

Handlers should validate payloads before acting.

### Step 6 - Add preload bridge

Update `electron/preload.ts`.

Expose:

```ts
gitSync: {
  readSettings,
  saveSettings,
  testConnection,
  clearToken
}
```

### Step 7 - Update renderer types

Update:

```text
src/vite-env.d.ts
```

Add the Git Sync settings and result contracts.

### Step 8 - Update Settings UI

Update:

```text
src/components/Settings.tsx
```

Add the Git Sync section.

Keep the UI simple and product-owner friendly.

Suggested labels:

- `Provider`
- `Repository URL`
- `Default branch`
- `Author name`
- `Author email`
- `Access token`
- `Test connection`
- `Save settings`
- `Clear token`

### Step 9 - Manual verification

Manually verify:

- Settings save and reload.
- App restart keeps non-secret settings.
- App restart keeps token only through secure credential storage.
- Token clear works.
- Test connection works for GitHub.
- Test connection works for GitLab.
- Invalid token returns safe failure.
- Invalid branch returns safe failure.
- Token is absent from project files.
- Token is absent from `.aidd-app`.
- Token is absent from Git config.
- Token is absent from logs.

## Suggested files changed

Likely new files:

```text
electron/services/gitSyncSettingsStore.ts
electron/services/gitCredentialStore.ts
electron/services/gitRemoteTester.ts
```

Likely changed files:

```text
electron/main.ts
electron/preload.ts
electron/services/gitService.ts
src/components/Settings.tsx
src/vite-env.d.ts
package.json
package-lock.json
```

Potential dependency:

```json
{
  "keytar": "^7.9.0"
}
```

Confirm Electron packaging compatibility before finalising this dependency.

## Notes

This phase should feel like connecting a cloud sync provider, not configuring Git.

The implementation should keep Git powerful for developers while making the product-owner workflow simple, safe, and difficult to misuse.
