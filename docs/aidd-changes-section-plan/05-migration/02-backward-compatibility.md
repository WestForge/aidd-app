# Backward Compatibility

## Must remain working

- Reading existing delivery packages.
- Opening existing delivery package details.
- Publishing existing delivery packages to workspace.
- Packaging existing delivery packages for review.
- Importing delivery review packages.
- Reading component technical reviews.
- Reading component technical changes.

## Compatibility fields

Keep these fields in delivery summaries/details:

```ts
packageType?: 'capability' | 'technical' | 'change';
sourceCapability?: string;
sourceTechnicalChange?: {
  componentSlug: string;
  technicalChangeId: string;
  title: string;
};
technicalChanges?: DeliveryPackageTechnicalChangeSummary[];
excludedTechnicalChanges?: DeliveryPackageTechnicalChangeSummary[];
```

Add:

```ts
changeIds?: string[];
sourceCapabilities?: string[];
```

## UI display rules

Delivery package cards should label source as:

```text
Change package       if packageType === 'change'
Capability package   if packageType === 'capability'
Technical package    if packageType === 'technical'
Legacy package       if packageType missing but older metadata exists
```

## Validation rules

Health check should warn, not fail, for legacy structures that are still supported.

Examples:

```text
Warning: Legacy technical package has no changeIds. This package remains supported but new packages should be created from Changes.
```

Avoid blocking users with historical data they cannot reasonably fix.
