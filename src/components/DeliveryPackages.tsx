import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';

interface DeliveryPackagesProps {
  packages: DeliveryBundle[];
  selectedId: string;
  onSelectPackage: (id: string) => void;
  onCreatePackage: () => void;
}

const statusCopy: Record<string, string> = {
  draft: 'Draft',
  'needs-review': 'Needs human review',
  'changes-requested': 'Changes requested',
  'approved-for-ai': 'Approved for AI',
  'in-ai-execution': 'In AI execution',
  'needs-verification': 'Needs verification',
  accepted: 'Accepted',
  superseded: 'Superseded'
};

export function DeliveryPackages({ packages, selectedId, onSelectPackage, onCreatePackage }: DeliveryPackagesProps) {
  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Delivery Packages</p>
          <h1>Package approved work for delivery</h1>
          <p className="muted">A delivery package is the controlled technical package that AI or humans execute and then verify.</p>
        </div>
        <button className="primaryButton" onClick={onCreatePackage}>New Delivery Package</button>
      </header>

      <section className="kanbanGrid">
        {Object.entries(statusCopy).map(([status, label]) => {
          const items = packages.filter((item) => item.status === status);
          return (
            <div key={status} className="kanbanColumn">
              <div className="kanbanHeader"><strong>{label}</strong><span>{items.length}</span></div>
              {items.map((item) => {
                const readiness = checkReadiness(item);
                return (
                  <button key={item.id} className={item.id === selectedId ? 'bundleCard selected' : 'bundleCard'} onClick={() => onSelectPackage(item.id)}>
                    <strong>{item.id} · {item.title}</strong>
                    <span>{item.capability}</span>
                    <small>{readiness.score}% ready</small>
                  </button>
                );
              })}
            </div>
          );
        })}
      </section>
    </main>
  );
}
