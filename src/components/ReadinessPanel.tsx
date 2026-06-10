import { checkReadiness } from '../domain/readiness';
import type { DeliveryBundle } from '../domain/types';

export function ReadinessPanel({ bundle }: { bundle: DeliveryBundle }) {
  const readiness = checkReadiness(bundle);

  return (
    <aside className="readinessPanel">
      <div className="scoreCircle">{readiness.score}%</div>
      <h3>{readiness.readyForAi ? 'Approved for AI' : readiness.readyForReview ? 'Ready for review' : 'Not ready yet'}</h3>
      <p className="muted">AIDD checks whether this package is bounded, reviewable, and safe to hand to an AI agent.</p>
      <div className="issues">
        {readiness.issues.length === 0 ? (
          <div className="issue good">No readiness blockers.</div>
        ) : (
          readiness.issues.map((issue, index) => (
            <div key={index} className={`issue ${issue.level}`}>{issue.message}</div>
          ))
        )}
      </div>
      <div className="approvalGrid">
        <span>Product</span><strong>{bundle.approvals.product}</strong>
        <span>Architecture</span><strong>{bundle.approvals.architecture}</strong>
        <span>Delivery</span><strong>{bundle.approvals.delivery}</strong>
      </div>
    </aside>
  );
}
