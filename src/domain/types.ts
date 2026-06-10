export type BundleStatus =
  | 'draft'
  | 'needs-review'
  | 'changes-requested'
  | 'approved-for-ai'
  | 'in-ai-execution'
  | 'needs-verification'
  | 'accepted'
  | 'superseded';

export type ApprovalStatus = 'pending' | 'approved' | 'changes-requested';

export interface ApprovalState {
  product: ApprovalStatus;
  architecture: ApprovalStatus;
  delivery: ApprovalStatus;
}

export interface DeliveryBundle {
  id: string;
  title: string;
  status: BundleStatus;
  workstream: string;
  capability: string;
  owner: string;
  goal: string;
  rationale: string;
  inScope: string[];
  outOfScope: string[];
  linkedContext: string[];
  acceptanceCriteria: string[];
  verificationPlan: string[];
  risks: string[];
  approvals: ApprovalState;
  verificationNotes: string;
  lastUpdated: string;
}

export interface ReadinessIssue {
  level: 'blocker' | 'warning';
  message: string;
}

export interface ReadinessResult {
  readyForReview: boolean;
  readyForAi: boolean;
  issues: ReadinessIssue[];
  score: number;
}
