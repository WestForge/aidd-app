# Test Matrix

| Area | Scenario | Expected result |
|---|---|---|
| Change domain | Create manual Change | Folder, manifest, and Markdown sections are written |
| Change domain | Read Changes | Records are sorted consistently |
| Change domain | Save Change | Metadata and section bodies update |
| Change readiness | Missing intent | Cannot mark ready; blocker shown |
| Change readiness | Missing linked context | Cannot mark ready; blocker shown |
| Capability integration | Plan change from capability | New Change links capability and opens Changes screen |
| Component integration | Plan change from component | New Change links component and opens Changes screen |
| Technical change integration | Promote technical change | New Change links component and legacy TC reference |
| Delivery | Create from draft Change | Operation is blocked |
| Delivery | Create from ready Change | New package is written with packageType `change` |
| Delivery | Existing capability package | Still opens and publishes |
| Delivery | Existing technical package | Still opens and publishes |
| Delivery page | Empty state | Tells user to create packages from ready Changes |
| Health check | Missing changes/index.md | Repair can create it |
| Health check | Bad linked component | Validation issue is shown |
| Preload | Missing API wiring | No `window.aidd.* is not a function` at runtime |
