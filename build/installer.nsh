; AIDD NSIS customisation hooks.
; electron-builder includes this file when creating the Windows installer.
;
; Keep this file intentionally small. The main installer behaviour is configured
; in package.json under the "build.nsis" section.

!macro customInstall
  DetailPrint "AIDD installer: creating shortcuts and installing user-scoped app files."
!macroend

!macro customUnInstall
  DetailPrint "AIDD uninstaller: removing application files. User project data is preserved."
!macroend
