# Packaging AIDD for Windows

AIDD uses `electron-builder` with the NSIS target to create a Windows `.exe` installer.

## Prerequisites

- Windows build machine.
- Node.js and npm installed.
- Project dependencies installed with `npm install` or `npm ci`.

## Build a Windows installer

```powershell
npm ci
npm run dist:win
```

The installer is written to `release/` and follows this naming pattern:

```text
AIDD-Setup-0.8.0.exe
```

## Build an unpacked Windows app for smoke testing

```powershell
npm run package:win
```

This creates an unpacked app directory in `release/` without producing the installer.

## Clean and rebuild the installer

```powershell
npm run dist:win:clean
```

This removes `dist/` and `release/`, then rebuilds the app and the NSIS installer.

## Installer behaviour

The NSIS installer is configured to:

- install per user by default;
- allow the user to change the install directory;
- create Start Menu and desktop shortcuts;
- preserve AIDD user data and project tracking data on uninstall.

## Signing

The current config does not require a code-signing certificate. For a public release, add a Windows code-signing certificate through `electron-builder` environment variables or CI secrets before publishing the installer.

## Runtime dependency packaging

The Electron main process is bundled before packaging. This keeps the installed app from depending on a large tree of transitive JavaScript packages inside `app.asar` and avoids startup errors caused by partially copied production dependencies.

`keytar` is intentionally left external because it is a native module. Electron Builder rebuilds it for the target Electron version and unpacks it from the ASAR archive.

## Troubleshooting

### `Cannot find module 'call-bind-apply-helpers'` on app startup

This means the installed app is loading an incomplete transitive `node_modules` tree from `resources/app.asar`. Rebuild with the bundled main-process build step included in this update:

```powershell
npm ci
npm run dist:win:clean
```

Then uninstall the previous AIDD build before installing the new installer, or install the new build over the top and confirm this file has changed:

```text
resources/app.asar/dist/main/main.js
```
