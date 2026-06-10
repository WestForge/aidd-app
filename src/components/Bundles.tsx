import type { DeliveryBundle } from '../domain/types';
import { checkReadiness } from '../domain/readiness';
import type { Screen } from '../main';

interface BundlesProps {
  bundles: DeliveryBundle[];
  selectedId: string;
  onSelectBundle: (id: string, target?: Screen) => void;
  onCreateBundle: () => void;
}

const groups = ['draft', 'needs-review', 'changes-requested', 'approved-for-ai', 'in-ai-execution', 'needs-verification', 'accepted'] as const;

export function Bundles({ bundles, selectedId, onSelectBundle, onCreateBundle }: BundlesProps) {
  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Bundles</p>
          <h1>Delivery Bundles</h1>
          <p className="muted">Create, review, approve, and hand off bounded AI execution work.</p>
        </div>
        <button className="primaryButton" onClick={onCreateBundle}>New Bundle</button>
      </header>

      <section className="kanbanGrid">
        {groups.map((status) => {
          const statusBundles = bundles.filter((bundle) => bundle.status === status);
          return (
            <div key={status} className="kanbanColumn">
              <h2>{status.split('-').join(' ')}</h2>
              {statusBundles.length === 0 && <p className="emptyState">No bundles</p>}
              {statusBundles.map((bundle) => {
                const readiness = checkReadiness(bundle);
                return (
                  <button key={bundle.id} className={bundle.id === selectedId ? 'bundleCard compact selected' : 'bundleCard compact'} onClick={() => onSelectBundle(bundle.id)}>
                    <span className={`pill ${bundle.status}`}>{bundle.status}</span>
                    <h3>{bundle.title}</h3>
                    <p>{bundle.goal || 'No goal written yet.'}</p>
                    <div className="cardFooter">
                      <span>{bundle.id}</span>
                      <span>{readiness.score}% ready</span>
                    </div>
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
