import { useEffect, useRef } from "react";

import type { DealDetail } from "./dealDetail";
import type { Pillar } from "./forecast";
import { ScoreSelects } from "./ScoreSelects";
import type { Deal } from "./types";
import { BeforeAfter } from "./WhatChanged";

interface DetailPanelProps {
  detail: DealDetail;
  onScoreChange: (deal: Deal, pillar: Pillar, value: number) => void;
  onClose: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onMove: (deal: Deal, kind: "promote" | "demote") => void;
}

export function DetailPanel(props: DetailPanelProps) {
  const { detail, onScoreChange, onClose, collapsed, onCollapsedChange, onMove } = props;
  const { deal } = detail;
  const name = deal.customer ?? deal.deal_id;
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes the panel; focus moves to it when a deal opens or the panel expands.
  useEffect(() => {
    // Esc closes the panel, unless a dialog (e.g. Update data) is open: Esc closes that instead.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { if (!collapsed) closeRef.current?.focus(); }, [deal.deal_id, collapsed]);

  if (collapsed) {
    // Thin rail: the selected deal's name, sideways. Click to expand.
    return (
      <aside className="detail-panel rail" aria-label={`Details for ${name} (collapsed)`}>
        <button type="button" className="rail-button" aria-label="Expand details" title="Expand details"
          onClick={() => onCollapsedChange(false)}>
          «
        </button>
        <button type="button" className="rail-name" title={`Expand details for ${name}`} onClick={() => onCollapsedChange(false)}>
          {name}
        </button>
        <button type="button" className="rail-button" aria-label="Close details" title="Close details" onClick={onClose}>
          ×
        </button>
      </aside>
    );
  }

  return (
    <aside className="detail-panel" aria-label={`Details for ${name}`}>
      <header className="detail-header">
        <div>
          <p className="detail-eyebrow">
            {detail.inForecast ? (
              <span className={`bucket bucket-${detail.isTop ? "top" : "longtail"}`}>{detail.isTop ? "Top" : "Longtail"}</span>
            ) : (
              <span className="bucket bucket-excluded">Not in forecast</span>
            )}
            {detail.edited && <span className="edited-badge">Edited</span>}
          </p>
          <h2>{name}</h2>
          <p className="detail-id">{deal.deal_id} · {deal.source}</p>
        </div>
        <div className="detail-header-actions">
          <button type="button" className="icon-button" aria-label="Collapse details" title="Collapse details"
            onClick={() => onCollapsedChange(true)}>
            »
          </button>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close details" title="Close details"
            onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      {detail.statusLine && <p className="status-line">{detail.statusLine}</p>}

      <dl className="detail-facts">
        <div><dt>Product</dt><dd>{deal.product}</dd></div>
        <div><dt>Rep</dt><dd>{deal.sales_rep ?? "—"}</dd></div>
        <div><dt>Stage</dt><dd>{deal.stage ?? "—"}</dd></div>
        <div><dt>Close date</dt><dd>{deal.close_date ?? "—"}</dd></div>
        <div><dt>Quarter</dt><dd>{deal.fiscal_period}</dd></div>
        <div><dt>Region</dt><dd>{deal.region ?? "—"}</dd></div>
      </dl>

      <section className="detail-section">
        <h3>{detail.inForecast ? "How the expected value is calculated" : "Expected value"}</h3>
        {detail.scores && (
          <ScoreSelects deal={deal} scores={detail.scores} onChange={onScoreChange} variant="labeled" />
        )}
        <ol className="calc">
          {detail.gpaLine && <li>{detail.gpaLine}</li>}
          {detail.probabilityLine && <li>{detail.probabilityLine}</li>}
          <li className="calc-result">{detail.expectedValueLine}</li>
        </ol>
        {detail.vpLine && <p className="vp-line">{detail.vpLine}</p>}
        {detail.moveAction && (
          <div className="move-action">
            <button
              type="button"
              className="button"
              aria-describedby="move-action-note"
              onClick={() => onMove(deal, detail.moveAction!.kind)}
            >
              {detail.moveAction.label}
            </button>
            <p id="move-action-note" className="move-note">{detail.moveAction.note}</p>
          </div>
        )}
      </section>

      <section className="detail-section">
        <h3>This week</h3>
        {detail.changes.length === 0 ? (
          <p className="muted">
            {deal.source === "Salesforce" ? "No change since last week." : "No prior-week file for HubSpot deals."}
          </p>
        ) : (
          <ul className="week-changes">
            {detail.changes.map((c) => (
              <li key={c.key}>
                <div className="week-change-head">
                  <span className="week-change-category">{c.category}</span>
                  <span className={`change-value tone-${c.tone}`}>{c.change}</span>
                </div>
                <BeforeAfter before={c.before} after={c.after} />
                {c.acvNote && <span className="acv-note">{c.acvNote}</span>}
              </li>
            ))}
          </ul>
        )}
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
                  <span className="audit-title">{e.title}</span>
                  <span className={`chip chip-kind-${e.kind.toLowerCase().replace(" ", "-")}`}>{e.kind}</span>
                  <span className="audit-check" title="Check in SPEC.md">{e.check}</span>
                  {(e.impact || e.atRisk) && (
                    <span className="audit-impact">
                      {[e.impact && `${e.impact} impact`, e.atRisk && `${e.atRisk} at risk`].filter(Boolean).join(" · ")}
                    </span>
                  )}
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
