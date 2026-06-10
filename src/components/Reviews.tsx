import { Bot, CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import type { DeliveryBundle } from '../domain/types';

interface ReviewsProps {
  bundles: DeliveryBundle[];
  selectedId: string;
  onSelectBundle: (id: string) => void;
  bundle: DeliveryBundle;
  onChange: (bundle: DeliveryBundle) => void;
}

export function Reviews({ bundles, selectedId, onSelectBundle, bundle, onChange }: ReviewsProps) {
  const aiReviewItems = bundles.filter((item) => item.status === 'in-ai-execution' || item.status === 'needs-verification' || item.status === 'approved-for-ai');

  const markAiReview = (notes: string) => {
    onChange({ ...bundle, verificationNotes: notes, status: 'needs-verification', lastUpdated: new Date().toISOString().slice(0, 10) });
  };

  return (
    <main className="screen">
      <header className="screenHeader">
        <div>
          <p className="eyebrow">AI Reviews</p>
          <h1>Review what the AI changed</h1>
          <p className="muted">This review is for AI output: scope drift, acceptance criteria, verification evidence, and required updates to capabilities, components, decisions, or standards.</p>
        </div>
      </header>

      <section className="reviewLayout">
        <div className="panel queuePanel">
          <h2>AI review queue</h2>
          <div className="bundleList compact">
            {(aiReviewItems.length ? aiReviewItems : bundles).map((item) => (
              <button key={item.id} className={item.id === selectedId ? 'bundleRow selected' : 'bundleRow'} onClick={() => onSelectBundle(item.id)}>
                <div>
                  <strong>{item.id} · {item.title}</strong>
                  <span>{item.status.replace(/-/g, ' ')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel reviewDetail">
          <div className="sectionTitleIcon"><Bot size={18} /><h2>{bundle.title}</h2></div>
          <p className="muted">Use this once an AI agent has produced work for a delivery package.</p>
          <div className="aiReviewChecklist">
            <div><Circle size={18} /><span>Changed files are within the delivery package scope.</span></div>
            <div><Circle size={18} /><span>No unapproved capability or component behaviour was added.</span></div>
            <div><Circle size={18} /><span>Acceptance criteria have evidence.</span></div>
            <div><Circle size={18} /><span>Required decisions or standards updates have been created.</span></div>
            <div><Circle size={18} /><span>Verification is ready for final human acceptance.</span></div>
          </div>
          <label className="fieldLabel">AI review notes</label>
          <textarea className="textArea large" value={bundle.verificationNotes} onChange={(event) => onChange({ ...bundle, verificationNotes: event.target.value })} placeholder="Summarise the AI output, drift, issues, and evidence." />
          <div className="buttonGroup left">
            <button className="secondaryButton" onClick={() => onChange({ ...bundle, status: 'changes-requested' })}><ShieldCheck size={16} />Request AI rework</button>
            <button className="primaryButton" onClick={() => markAiReview(bundle.verificationNotes || 'AI output reviewed. Ready for verification.')}><CheckCircle2 size={16} />AI review complete</button>
          </div>
        </div>
      </section>
    </main>
  );
}
