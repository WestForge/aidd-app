# Agent Implementation Prompt

Use this prompt when handing the work to an AI coding agent.

```text
You are working on the AIDD Electron/React/TypeScript app.

Implement a new first-class Changes section.

Intent:
- Capabilities and components describe the system.
- Changes describe intended work.
- Delivery packages should be created from ready Changes, not directly from capabilities/components.

Source observations:
- Capability direct delivery creation currently lives in src/components/Capabilities.tsx and uses window.aidd.createDeliveryPackageFromCapability.
- Component technical change delivery creation currently lives in src/components/Components.tsx and uses window.aidd.createDeliveryPackageFromTechnicalChange.
- Delivery package backend logic currently lives in electron/main/domain/delivery.ts.
- IPC is in electron/main/ipc/projectDomainIpc.ts.
- Preload API is in electron/preload.ts.
- Renderer API types are in src/vite-env.d.ts.
- Domain types are in electron/main/domain/types.ts.
- Main routing is in src/main.tsx.
- Sidebar navigation is in src/components/Sidebar.tsx.

Required outcome:
1. Add a new top-level changes/ project folder with changes/index.md.
2. Add electron/main/domain/changes.ts with read/create/save/status/delete functions.
3. Add Change types to electron/main/domain/types.ts and src/vite-env.d.ts.
4. Add IPC and preload methods for Changes.
5. Add src/components/Changes.tsx.
6. Add Changes to the sidebar and renderer routing.
7. Replace direct capability/component delivery creation buttons with Change creation actions.
8. Add createDeliveryPackageFromChanges and make new delivery packages use packageType "change".
9. Keep legacy capability/technical delivery packages readable.
10. Update health check/repair/project status.
11. Run typecheck/build and relevant tests.

Guardrails:
- Do not break existing projects with delivery/packages created before this feature.
- Do not remove component technical review import.
- Do not delete legacy component technical changes.
- Do not make ADR/Decisions the top-level replacement for Changes.
- Keep Delivery as execution/scheduling, not planning.
```
