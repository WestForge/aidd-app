# Phase 06 - CI/CD Provider Workflows

## Goal

Introduce optional GitHub Actions or GitLab CI support that helps teams automate validation and publishing around AIDD project documentation and delivery bundles.

This phase should remain optional and developer-oriented.

Product owners should not need to configure CI/CD.

## Product intent

The product-owner-facing message is:

> The shared repository can automatically check that project documents and delivery bundles are valid.

The developer-facing capability is:

> Generate provider-specific workflow files that validate AIDD structure, run tests, and optionally publish documentation.

## Depends on

- Phase 05 Delivery Bundle Integration.
- Git repository connected and synced.
- Delivery bundle metadata.
- AIDD document validation commands or scripts.
- Clear separation between product-owner workflow and developer workflow.

## Supported providers

Initial provider support:

- GitHub Actions
- GitLab CI/CD

## Non-goals

Do not implement:

- Automatic deployment to production.
- Secret management for deployments.
- Cloud hosting setup.
- Complex environment promotion.
- Release approval workflows.
- Product-owner-facing CI editing.

## Workflow templates

Add optional workflow template generation.

Suggested templates:

```text
.github/workflows/aidd-validate.yml
.gitlab-ci.yml
```

These should be generated only when the user or developer explicitly enables them.

Do not overwrite existing workflow files without confirmation.

## Recommended checks

Start with safe checks:

- Install dependencies.
- Validate AIDD document structure.
- Validate required files exist.
- Validate Markdown or MDX where applicable.
- Validate delivery bundle metadata.
- Build documentation site if configured.
- Run tests if the project has a test command.

## GitHub Actions example intent

Generated workflow should do roughly:

```text
on pull request and push:
  checkout repository
  install dependencies
  run validation
  build docs
  run tests if configured
```

## GitLab CI example intent

Generated pipeline should do roughly:

```text
stages:
  - validate
  - test
  - build

validate:
  install dependencies
  run validation
```

## UI model

Keep this out of the main product-owner sync flow.

Possible location:

- Advanced settings
- Developer tools
- Repository automation

Labels:

- `Repository automation`
- `Generate validation workflow`
- `GitHub Actions`
- `GitLab CI`

Do not show this as part of normal Sync unless already configured.

## Safety rules

- Do not write provider secrets.
- Do not create deployment tokens.
- Do not store PATs in workflow files.
- Do not assume production deployment.
- Do not overwrite existing CI files silently.
- Do not commit generated workflows automatically unless user confirms.

## Suggested IPC API

Add:

```ts
repoAutomation:detectProvider(projectPathOrId)
repoAutomation:previewWorkflow(input)
repoAutomation:writeWorkflow(input)
repoAutomation:getWorkflowStatus(projectPathOrId)
```

## Suggested TypeScript contracts

```ts
export interface AiddWorkflowTemplateInput {
  projectPath: string;
  provider: 'github' | 'gitlab';
  includeDocsBuild: boolean;
  includeTests: boolean;
  includeBundleValidation: boolean;
}

export interface AiddWorkflowPreview {
  provider: 'github' | 'gitlab';
  targetPath: string;
  content: string;
  wouldOverwrite: boolean;
}

export interface AiddWorkflowWriteResult {
  ok: boolean;
  code:
    | 'OK'
    | 'WOULD_OVERWRITE'
    | 'UNSUPPORTED_PROVIDER'
    | 'PROJECT_NOT_CONNECTED'
    | 'WRITE_FAILED';
  message: string;
  targetPath?: string;
}
```

## Suggested files changed

Likely new files:

```text
electron/services/repoAutomationService.ts
electron/services/workflowTemplateService.ts
templates/github/aidd-validate.yml
templates/gitlab/gitlab-ci.yml
```

Likely changed files:

```text
electron/main.ts
electron/preload.ts
src/components/Settings.tsx
src/vite-env.d.ts
```

## Acceptance criteria

### Workflow generation

- User can preview GitHub Actions workflow.
- User can preview GitLab CI workflow.
- User can write workflow file when no existing file conflicts.
- Existing workflow files are not overwritten silently.
- Generated workflow validates AIDD structure.
- Generated workflow can build docs if configured.
- Generated workflow can run tests if configured.

### Security

- Workflow files do not include access tokens.
- Workflow files do not include personal credentials.
- Workflow files do not include local machine paths.
- Existing secrets are not read or modified.
- Generated files are safe to commit.

### UX

- Product-owner sync remains simple.
- CI/CD options are clearly advanced or developer-oriented.
- User can understand what file will be created before it is written.

## Manual verification

Verify:

- Generate GitHub workflow preview.
- Generate GitLab workflow preview.
- Write GitHub workflow to empty repo.
- Write GitLab workflow to empty repo.
- Existing workflow conflict is detected.
- Generated workflow contains no token.
- Generated workflow does not include local absolute paths.
- Workflow can run validation commands in a clean checkout.

## Notes

This phase should help teams that already use GitHub or GitLab workflows, but it should not make CI/CD a requirement for AIDD.

The product-owner workflow remains:

> define, review, sync, deliver.

CI/CD supports that workflow in the background.
