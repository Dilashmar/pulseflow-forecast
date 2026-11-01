import { useEffect, useRef } from "react";

import type { DealDetail } from "./dealDetail";

interface DetailPanelProps {
  detail: DealDetail;
  onClose: () => void;
}

/** The deal drawer: who, the four numbers, then only the sections that have something to say. */
export function DetailPanel({ detail, onClose }: DetailPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { figures } = detail;

  // A drawer over the page: Esc or × closes it; focus moves to it when a deal opens.
  useEffect(() => {
    // Esc closes the drawer, unless a dialog (e.g. Upload) is open: Esc closes that instead.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { closeRef.current?.focus(); }, [detail.deal.deal_id]);

  return (
    <aside className="detail-panel" aria-label={`Details for ${detail.name}`}>
      <header className="drawer-head">
        <div>
          <h2>{detail.name}</h2>
          <p className="drawer-id">{detail.idLine}</p>
          <p className="drawer-rep">{detail.rep}</p>
        </div>
        <button ref={closeRef} type="button" className="icon-button" aria-label="Close details" title="Close details"
          onClick={onClose}>
          ×
        </button>
      </header>

      {detail.status && <p className="status-line">{detail.status}</p>}

      <dl className="drawer-figures">
        <div><dt>Expected value</dt><dd className="drawer-big">{figures.expectedValue}</dd></div>
        <div><dt>Win %</dt><dd className="drawer-big">{figures.winPercent}</dd></div>
        <div><dt>Annual value</dt><dd>{figures.annualValue}</dd></div>
        <div><dt>Close date</dt><dd>{figures.closeDate}</dd></div>
      </dl>

      {detail.attention.length > 0 && (
        <section className="drawer-section">
          <h3>Needs attention</h3>
          <ul className="attention-list">
            {detail.attention.map((line) => (
              <li key={line}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2L1.5 13.5h13z" /><path d="M8 6.5v3" /><path d="M8 11.8v.2" />
                </svg>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.vpNotes && (
        <section className="drawer-section">
          <h3>VP notes</h3>
          <p className="vp-notes">{detail.vpNotes}</p>
        </section>
      )}

      {detail.changes.length > 0 && (
        <section className="drawer-section">
          <h3>This week</h3>
          <ul className="week-changes">
            {detail.changes.map((c) => (
              <li key={c.key}>
                <span>{c.before === null ? c.after : `${c.before} → ${c.after}`}</span>
                <strong className={`change-value tone-${c.tone}`}>{c.change}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
