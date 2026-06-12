param(
  [string]$Root = "C:\tmp\aiddtest",
  [string]$RepoName = "phase-03-local-sync",
  [string]$RepoUrl = "https://arcforge.westforge.net/legacy/test-aidd.git",
  [string]$Provider = "gitlab",
  [string]$AuthorName = "Francis West",
  [string]$AuthorEmail = "francis@westforge.net",
  [switch]$Reset
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoName) -or $RepoName.Contains("\") -or $RepoName.Contains("/")) {
  throw "RepoName must be a single directory name, not a path."
}

$ProjectPath = Join-Path $Root $RepoName

$env:AIDD_TEST_ALLOW_WRITE = "1"
$env:AIDD_TEST_ROOT = $Root
$env:AIDD_TEST_REPO_NAME = $RepoName
$env:AIDD_TEST_REPO_URL = $RepoUrl
$env:AIDD_TEST_PROVIDER = $Provider
$env:AIDD_TEST_AUTHOR_NAME = $AuthorName
$env:AIDD_TEST_AUTHOR_EMAIL = $AuthorEmail
$env:AIDD_TEST_RESET = if ($Reset) { "1" } else { "0" }
$env:AIDD_TEST_RESET_CONFIRM_PATH = if ($Reset) { $ProjectPath } else { "" }

Write-Host ""
Write-Host "Running Phase 03 sync workflow tests..."
Write-Host ""

npm run test:git-sync-workflow
