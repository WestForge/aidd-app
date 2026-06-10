import type { DeliveryBundle } from '../domain/types';
import { generateAiHandoff } from '../domain/handoff';
import { checkReadiness } from '../domain/readiness';

interface HandoffProps {
  bundle: DeliveryBundle;
  onMarkInExecution: () => void;
}

export function Handoff({ bundle, onMarkInExecution }: HandoffProps) {
  const handoff = generateAiHandoff(bundle);
  const readiness = checkReadiness(bundle);

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">AI Handoff</p>
          <h1>{bundle.title}</h1>
          <p className="muted">Generate the approved execution pack for an AI agent.</p>
        </div>
        <div className="buttonGroup">
          <button className="smallButton" disabled={!readiness.readyForAi} onClick={() => navigator.clipboard.writeText(handoff)}>Copy Prompt</button>
          <button className="primaryButton" disabled={!readiness.readyForAi} onClick={onMarkInExecution}>Mark In Execution</button>
        </div>
      </header>
      {!readiness.readyForAi && <div className="warningBanner">This bundle is not approved for AI yet. Complete readiness and approvals first.</div>}
      <pre className="handoffPreview">{handoff}</pre>
    </main>
  );
}
