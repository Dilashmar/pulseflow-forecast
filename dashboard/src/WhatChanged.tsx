import { useState } from "react";

import type { WhatChangedView } from "./whatChangedView";

interface WhatChangedProps {
  view: WhatChangedView;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

// Room for a column's bar on each side of the zero line (the value label sits beyond it).
const BAR_MAX_PX = 88;

/** What Changed (SPEC 6.3): one column per category around a zero line, increases up and
 *  decreases down. Each column is a button; the list below shows the selected one's deals. */
export function WhatChanged({ view, selectedId, onSelect }: WhatChangedProps) {
  const [picked, setPicked] = useState(view.defaultKey);
  const current = view.categories.find((c) => c.key === picked) ?? view.categories[0];
  const largest = Math.max(1, ...view.categories.map((c) => Math.abs(c.valueCents)));

  return (
    <section className="card what-changed" aria-label="What Changed">
      <div className="toolbar">
        <div className="toolbar-title">
          <h2>What changed since last week</h2>
          <p className="record-count">{view.caption}</p>
        </div>
        <p className="net-change">Net change <strong className={`tone-${view.netTone}`}>{view.net}</strong></p>
      </div>

      <div className="what-changed-body">
        <p className="visually-hidden">{view.summary}</p>
        <div className="column-chart" role="group" aria-label="Change by category">
          {view.categories.map((c) => {
            const selected = c.key === current.key;
            const height = `${Math.max(4, Math.round((Math.abs(c.valueCents) / largest) * BAR_MAX_PX))}px`;
            const down = c.tone === "down";
            return (
              <button
                key={c.key}
                type="button"
                className={`column column-${c.tone}${selected ? " selected" : ""}`}
                aria-pressed={selected}
                aria-label={`${c.label}: ${c.valueText} from ${c.countText}`}
                onClick={() => setPicked(c.key)}
              >
                <span className="column-half column-above" aria-hidden="true">
                  {!down && <><span className="column-value">{c.valueText}</span><span className="column-bar" style={{ height }} /></>}
                </span>
                <span className="column-half column-below" aria-hidden="true">
                  {down && <><span className="column-bar" style={{ height }} /><span className="column-value">{c.valueText}</span></>}
                </span>
                <span className="column-label" aria-hidden="true">{c.label}</span>
                <span className="column-count" aria-hidden="true">{c.countText}</span>
              </button>
            );
          })}
        </div>

        <section className="change-list" aria-labelledby="change-list-title">
          <div className="section-head">
            <h3 id="change-list-title">{current.label} <span className="section-count">({current.rows.length})</span></h3>
            <span className={`section-total tone-${current.tone}`}>{current.valueText}</span>
          </div>
          <ChangeTable rows={current.rows} selectedId={selectedId} onSelect={onSelect} />
          <p className="change-note">{view.note}</p>
        </section>

        {view.couldntCompare.length > 0 && (
          <section className="change-list" aria-labelledby="couldnt-compare-title">
            <div className="section-head">
              <h3 id="couldnt-compare-title">Couldn't compare <span className="section-count">({view.couldntCompare.length})</span></h3>
            </div>
            <ChangeTable rows={view.couldntCompare} selectedId={selectedId} onSelect={onSelect} />
          </section>
        )}
      </div>
    </section>
  );
}

interface ChangeTableProps {
  rows: WhatChangedView["couldntCompare"];
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

function ChangeTable({ rows, selectedId, onSelect }: ChangeTableProps) {
  return (
    <table className="deal-table change-table">
      <thead>
        <tr>
          <th scope="col">Customer</th>
          <th scope="col">What changed</th>
          <th scope="col" className="num">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={3} className="empty">No deals in this category this week.</td></tr>
        )}
        {rows.map((row) => {
          const selected = row.dealId === selectedId;
          return (
            // Same as the Deal Room: the row responds to a mouse click; the customer name is the keyboard target.
            <tr key={row.key} className={selected ? "selected" : undefined} aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(row.dealId)}>
              <th scope="row" className="customer">
                <button type="button" className="row-link" aria-label={`${row.customer}: open details`}
                  onClick={(e) => { e.stopPropagation(); onSelect(row.dealId); }}>
                  {row.customer}
                </button>
              </th>
              <td><BeforeAfter before={row.before} after={row.after} /></td>
              <td className={`num change-value tone-${row.tone}`}>{row.change}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** "Business Approval → Contract Negotiations": the new value bold, the old one muted.
 *  Screen readers hear "from ... to ..." instead of "right arrow". */
export function BeforeAfter({ before, after }: { before: string | null; after: string }) {
  if (before === null) return <span className="after">{after}</span>;
  return (
    <>
      <span className="visually-hidden">From {before} to {after}</span>
      <span aria-hidden="true">
        <span className="before">{before}</span>
        <span className="arrow"> → </span>
        <span className="after">{after}</span>
      </span>
    </>
  );
}
