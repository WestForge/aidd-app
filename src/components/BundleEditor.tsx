import type { DeliveryBundle } from '../domain/types';
import { bundleToMarkdown } from '../domain/markdown';
import { checkReadiness } from '../domain/readiness';
import { ReadinessPanel } from './ReadinessPanel';

interface BundleEditorProps {
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
  onSubmitForReview: () => void;
}

function updateList(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function listValue(items: string[]) {
  return items.join('\n');
}

export function BundleEditor({ bundle, onChange, onSubmitForReview }: BundleEditorProps) {
  const readiness = checkReadiness(bundle);
  const update = <K extends keyof DeliveryBundle>(key: K, value: DeliveryBundle[K]) => onChange({ ...bundle, [key]: value, lastUpdated: new Date().toISOString().slice(0, 10) });

  return (
    <main className="screen editorScreen">
      <section className="editorMain">
        <header className="screenHeader compact">
          <div>
            <p className="eyebrow">Package Editor</p>
            <h1>{bundle.id} · {bundle.title}</h1>
            <p className="muted">Guided editing for non-technical users. Clean Markdown is generated underneath.</p>
          </div>
          <div className="buttonGroup">
            <button className="smallButton" onClick={() => update('status', 'draft')}>Save Draft</button>
            <button className="primaryButton" disabled={!readiness.readyForReview} onClick={onSubmitForReview}>Submit for Review</button>
          </div>
        </header>

        <section className="panel formPanel">
          <h2>Definition</h2>
          <div className="formGrid">
            <label>Title<input value={bundle.title} onChange={(event) => update('title', event.target.value)} /></label>
            <label>Workstream<input value={bundle.workstream} onChange={(event) => update('workstream', event.target.value)} /></label>
            <label>Capability<input value={bundle.capability} onChange={(event) => update('capability', event.target.value)} /></label>
            <label>Owner<input value={bundle.owner} onChange={(event) => update('owner', event.target.value)} /></label>
          </div>

          <label>What are we trying to change?<textarea value={bundle.goal} onChange={(event) => update('goal', event.target.value)} /></label>
          <label>Why does this matter?<textarea value={bundle.rationale} onChange={(event) => update('rationale', event.target.value)} /></label>
        </section>

        <section className="panel formPanel">
          <h2>Scope and context</h2>
          <label>In scope <span className="fieldHint">One item per line</span><textarea value={listValue(bundle.inScope)} onChange={(event) => update('inScope', updateList(event.target.value))} /></label>
          <label>Out of scope <span className="fieldHint">One item per line</span><textarea value={listValue(bundle.outOfScope)} onChange={(event) => update('outOfScope', updateList(event.target.value))} /></label>
          <label>Linked context <span className="fieldHint">Markdown paths or plain-language document names</span><textarea value={listValue(bundle.linkedContext)} onChange={(event) => update('linkedContext', updateList(event.target.value))} /></label>
        </section>

        <section className="panel formPanel">
          <h2>Approval criteria</h2>
          <label>Acceptance criteria <span className="fieldHint">One criterion per line</span><textarea value={listValue(bundle.acceptanceCriteria)} onChange={(event) => update('acceptanceCriteria', updateList(event.target.value))} /></label>
          <label>Verification plan <span className="fieldHint">How should humans prove the work is done?</span><textarea value={listValue(bundle.verificationPlan)} onChange={(event) => update('verificationPlan', updateList(event.target.value))} /></label>
          <label>Risks / constraints <span className="fieldHint">Optional</span><textarea value={listValue(bundle.risks)} onChange={(event) => update('risks', updateList(event.target.value))} /></label>
        </section>

        <details className="markdownPreview">
          <summary>Generated Markdown preview</summary>
          <pre>{bundleToMarkdown(bundle)}</pre>
        </details>
      </section>
      <ReadinessPanel bundle={bundle} />
    </main>
  );
}
