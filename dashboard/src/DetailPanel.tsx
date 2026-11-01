import { useEffect, useRef } from "react";

import type { DealDetail } from "./dealDetail";
import type { Pillar } from "./forecast";
import type { Deal } from "./types";

const PILLARS: { key: Pillar; label: string }[] = [
  { key: "leadership", label: "Leadership" },
  { key: "commercial", label: "Commercial" },
  { key: "contractual", label: "Contractual" },
];
const SCORE_OPTIONS = [1, 2, 3, 4];

interface DetailPanelProps {
  detail: DealDetail;
  onScoreChange: (deal: Deal, pillar: Pillar, value: number) => void;
  onClose: () => void;
}

export function DetailPanel({ detail, onScoreChange, onClose }: DetailPanelProps) {
  const { deal } = detail;
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the panel; focus moves to it when a new deal opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { closeRef.current?.focus(); }, [deal.deal_id]);

  const original = { leadership: deal.leadership_score, commercial: deal.commercial_score, contractual: deal.contractual_score };

  return (
    <aside className="detail-panel" aria-label={`Details for ${deal.customer ?? deal.deal_id}`}>
      <header className="detail-header">
        <div>
          <p className="detail-eyebrow">
            <span className={`bucket bucket-${detail.isTop ? "top" : "longtail"}`}>{detail.isTop ? "Top" : "Longtail"}</span>
            {detail.edited && <span className="edited-badge">Edited</span>}
          </p>
          <h2>{deal.customer ?? deal.deal_id}</h2>
          <p className="detail-id">{deal.deal_id} · {deal.source}</p>
        </div>
        <button ref={closeRef} type="button" className="icon-button" aria-label="Close details" onClick={onClose}>×</button>
      </header>

      <dl className="detail-facts">
        <div><dt>Product</dt><dd>{deal.product}</dd></div>
        <div><dt>Rep</dt><dd>{deal.sales_rep ?? "—"}</dd></div>
        <div><dt>Stage</dt><dd>{deal.stage ?? "—"}</dd></div>
        <div><dt>Close date</dt><dd>{deal.close_date ?? "—"}</dd></div>
        <div><dt>Quarter</dt><dd>{deal.fiscal_period}</dd></div>
        <div><dt>Region</dt><dd>{deal.region ?? "—"}</dd></div>
      </dl>

      <section className="detail-section">
        <h3>How the expected value is calculated</h3>
        {detail.scores && (
          <div className="score-editor">
            {PILLARS.map((p) => (
              <label key={p.key} className="score-field">
                <span>{p.label}</span>
                <select
                  value={detail.scores![p.key]}
                  className={detail.scores![p.key] !== original[p.key] ? "changed" : undefined}
                  onChange={(e) => onScoreChange(deal, p.key, Number(e.target.value))}
                >
                  {SCORE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        <ol className="calc">
          {detail.gpaLine && <li>{detail.gpaLine}</li>}
          <li>{detail.probabilityLine}</li>
          <li className="calc-result">{detail.expectedValueLine}</li>
        </ol>
        {detail.vpLine && <p className="vp-line">{detail.vpLine}</p>}
      </section>

      {detail.vpNotes && (
        <section className="detail-section">
          <h3>VP notes</h3>
          <p className="vp-notes">{detail.vpNotes}</p>
        </section>
      )}

      <section className="detail-section">
        <h3>Flags</h3>
        {detail.flags.length === 0 ? (
          <p className="muted">No flags on this deal.</p>
        ) : (
          <ul className="flag-list">
            {detail.flags.map((f) => (
              <li key={f.label}>
                <span className={`chip chip-${f.tone}`}>{f.label}</span>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section">
        <h3>Audit log ({detail.auditEntries.length})</h3>
        {detail.auditEntries.length === 0 ? (
          <p className="muted">No data issues found for this deal.</p>
        ) : (
          <ul className="audit-list">
            {detail.auditEntries.map((e, i) => (
              <li key={`${e.check}-${i}`} className="audit-item">
                <div className="audit-item-head">
                  <span className="audit-check">{e.check}</span>
                  <span className={`chip chip-kind-${e.kind.toLowerCase().replace(" ", "-")}`}>{e.kind}</span>
                  <span className="audit-impact">{e.impact}{e.atRisk ? ` · ${e.atRisk} at risk` : ""}</span>
                </div>
                <p><strong>What was wrong:</strong> {e.whatWasWrong}</p>
                <p><strong>Resolution:</strong> {e.resolution}</p>
                {e.reasoning && <p className="muted"><strong>Why:</strong> {e.reasoning}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
