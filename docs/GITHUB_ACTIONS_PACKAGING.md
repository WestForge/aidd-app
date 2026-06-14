# GitHub Actions packaging

This update adds a Windows packaging workflow that does two things:

- Pull requests, pushes to `main`, and manual workflow runs build a downloadable Actions artifact only.
- Version tags such as `v0.8.0` build the NSIS installer and publish it to GitHub Releases using the built-in `GITHUB_TOKEN` mapped to `GH_TOKEN` for Electron Builder.

No personal access token is needed for publishing to the same repository unless repository or organization policy blocks the built-in token.

## Publish a release

```powershell
git tag v0.8.0
git push origin v0.8.0
```

## Normal package build

```powershell
npm run dist:win:clean
```

## Release package build

```powershell
npm run dist:win:publish:clean
```
