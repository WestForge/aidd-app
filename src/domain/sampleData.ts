import type { DeliveryBundle } from './types';

export const sampleBundles: DeliveryBundle[] = [
  {
    id: 'DB-001',
    title: 'Inventory Capacity Rules',
    status: 'draft',
    workstream: 'Inventory',
    capability: 'Inventory Capacity',
    owner: 'Francis',
    goal: 'Define clear inventory capacity behaviour so pickup and storage rules are predictable.',
    rationale: 'The current design does not make it clear what happens when the player inventory is full.',
    inScope: ['Define full inventory pickup behaviour', 'Define player feedback when pickup fails'],
    outOfScope: ['Inventory UI redesign', 'Item rarity balancing'],
    linkedContext: ['aidd/capabilities/inventory-capacity.md'],
    acceptanceCriteria: [
      'Given inventory is full, when the player attempts pickup, then the item is not added.',
      'Given pickup fails, the player receives clear feedback.'
    ],
    verificationPlan: ['Test full inventory pickup', 'Test normal pickup', 'Review failure feedback copy'],
    risks: ['May touch both runtime rules and UI feedback messaging.'],
    approvals: {
      product: 'pending',
      architecture: 'pending',
      delivery: 'pending'
    },
    verificationNotes: '',
    lastUpdated: '2026-06-10'
  },
  {
    id: 'DB-002',
    title: 'Save/Load Runtime Contract',
    status: 'approved-for-ai',
    workstream: 'Runtime',
    capability: 'Save System',
    owner: 'Maya',
    goal: 'Define the contract for save/load operations before implementation work begins.',
    rationale: 'Runtime behaviour must be stable before AI implementation starts.',
    inScope: ['Define save contract', 'Define load failure states'],
    outOfScope: ['Cloud saves', 'UI menu redesign'],
    linkedContext: ['aidd/architecture/runtime.md', 'aidd/capabilities/save-system.md'],
    acceptanceCriteria: ['Save payload shape is documented', 'Load failure behaviour is documented'],
    verificationPlan: ['Review against runtime architecture', 'Validate generated AI handoff'],
    risks: [],
    approvals: {
      product: 'approved',
      architecture: 'approved',
      delivery: 'approved'
    },
    verificationNotes: '',
    lastUpdated: '2026-06-09'
  }
];
