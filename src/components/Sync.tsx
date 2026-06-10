import type { DeliveryBundle } from '../domain/types';

export function Sync({ bundles, activeProject }: { bundles: DeliveryBundle[]; activeProject?: AiddTrackedProject | null }) {
  const localChanges = bundles.filter((bundle) => bundle.status !== 'accepted').length;

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Sync</p>
          <h1>Project Sync</h1>
          <p className="muted">Git stays hidden behind workflow-friendly actions.</p>
        </div>
        <button className="primaryButton">Sync Now</button>
      </header>
      <section className="panel">
        <h2>Current status</h2>
        <div className="syncStatus">
          <div><strong>Workspace</strong><span>{activeProject?.path ?? 'No project selected'}</span></div>
          <div><strong>Git engine</strong><span>isomorphic-git initialises local repositories during project creation</span></div>
          <div><strong>Remote</strong><span>Not connected</span></div>
          <div><strong>Local workflow changes</strong><span>{localChanges}</span></div>
          <div><strong>Product owner view</strong><span>No Git commands exposed</span></div>
        </div>
      </section>
      <section className="panel summaryPanel">
        <h2>What this will become</h2>
        <p>Sync will clone, pull, commit, and push AIDD text files through a hidden Git layer. Conflicts should be escalated to maintainer mode rather than shown to product owners.</p>
      </section>
    </main>
  );
}
