import type { DeliveryBundle } from '../domain/types';

interface VerificationProps {
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
}

export function Verification({ bundle, onChange }: VerificationProps) {
  const updateNotes = (verificationNotes: string) => {
    onChange({ ...bundle, verificationNotes, lastUpdated: new Date().toISOString().slice(0, 10) });
  };

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">Verification</p>
          <h1>{bundle.title}</h1>
          <p className="muted">Record whether the AI result satisfied the approved bundle.</p>
        </div>
        <div className="buttonGroup">
          <button className="smallButton" onClick={() => onChange({ ...bundle, status: 'changes-requested' })}>Request Rework</button>
          <button className="primaryButton" disabled={!bundle.verificationNotes.trim()} onClick={() => onChange({ ...bundle, status: 'accepted' })}>Accept Bundle</button>
        </div>
      </header>

      {bundle.status !== 'in-ai-execution' && bundle.status !== 'needs-verification' && bundle.status !== 'accepted' && (
        <div className="warningBanner">This package has not been marked as in AI execution yet. You can still draft notes, but acceptance should happen after implementation review.</div>
      )}

      <section className="panel formPanel">
        <h2>Verification evidence</h2>
        <div className="checklistPreview">
          {bundle.acceptanceCriteria.map((criterion, index) => (
            <label key={criterion} className="checkboxRow"><input type="checkbox" /> <span>AC{index + 1}: {criterion}</span></label>
          ))}
        </div>
        <label>Verification notes<textarea value={bundle.verificationNotes} onChange={(event) => updateNotes(event.target.value)} placeholder="What changed? What was tested? Any out-of-scope changes?" /></label>
      </section>
    </main>
  );
}
