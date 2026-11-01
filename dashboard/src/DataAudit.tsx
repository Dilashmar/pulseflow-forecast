import { useState } from "react";

import type { AuditGroup, AuditItem, AuditTableRow, AuditView } from "./auditView";

const AUDIT_TAB_TITLE = "Data Hygiene & Audit Log";

interface DataAuditProps {
  view: AuditView;
  table: AuditTableRow[];
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

export function DataAudit({ view, table, selectedId, onSelect }: DataAuditProps) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="card data-audit" aria-label={AUDIT_TAB_TITLE}>
      <div className="toolbar">
        <div className="toolbar-title">
          <h2>{AUDIT_TAB_TITLE}</h2>
          <p className="audit-summary">{view.summary}</p>
        </div>
      </div>

      <div className="data-audit-body">
        <section aria-labelledby="judgment-calls">
          <h3 id="judgment-calls" className="audit-heading">Judgment calls</h3>
          <div className="judgment-calls">
            {view.judgmentCalls.map((j) => (
              <article key={j.key} className="judgment-card">
                <header className="judgment-head">
                  <h4>{j.title}</h4>
                  <span className="judgment-amount">{j.amount}</span>
                </header>
                <p><strong>Decision:</strong> {j.decision}</p>
                {j.reasoning && <p><strong>Why:</strong> {j.reasoning}</p>}
                <ul className="judgment-deals">
                  {j.items.map((d, i) => (
                    <li key={`${d.dealId}-${i}`}>
                      <ItemName item={d} selectedId={selectedId} onSelect={onSelect} />
                      {j.items.length > 1 && <span className="judgment-deal-amount">{d.amount}</span>}
                      <span className="audit-item-detail">{d.detail}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {view.attention.length > 0 && (
          <GroupList id="needs-a-check" heading="Needs a check" groups={view.attention} selectedId={selectedId} onSelect={onSelect} />
        )}

        <GroupList id="fixed" heading="Fixed automatically" groups={view.fixes} selectedId={selectedId} onSelect={onSelect} />

        {view.notes.length > 0 && (
          <details className="audit-notes">
            <summary>{view.notesSummary}</summary>
            <GroupList id="notes" heading="Notes" hideHeading groups={view.notes} selectedId={selectedId} onSelect={onSelect} />
          </details>
        )}

        <div className="all-issues">
          <button type="button" className="button" aria-expanded={showAll} aria-controls="all-issues-table"
            onClick={() => setShowAll(!showAll)}>
            {showAll ? "Hide all issues" : `Show all issues (${table.length})`}
          </button>
          {showAll && (
            <AllIssuesTable rows={table} selectedId={selectedId} onSelect={onSelect} />
          )}
        </div>
      </div>
    </section>
  );
}

interface GroupListProps {
  id: string;
  heading: string;
  hideHeading?: boolean;
  groups: AuditGroup[];
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

/** One expandable row per group: title and count; open it to see the deals. */
function GroupList({ id, heading, hideHeading, groups, selectedId, onSelect }: GroupListProps) {
  return (
    <section aria-labelledby={id} className="audit-groups">
      <h3 id={id} className={hideHeading ? "visually-hidden" : "audit-heading"}>{heading}</h3>
      <ul className="group-list">
        {groups.map((g) => (
          <li key={g.key}>
            <details className="audit-group">
              <summary>
                <span className="group-title">{g.title}</span>
                <span className="group-count">{g.countText}</span>
              </summary>
              <ul className="group-items">
                {g.items.map((item, i) => (
                  <li key={`${item.dealId}-${i}`}>
                    {item.name && <ItemName item={item} selectedId={selectedId} onSelect={onSelect} />}
                    <span className="audit-item-detail">{item.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every audit entry as a row, for checking the numbers against the source files. */
function AllIssuesTable({ rows, selectedId, onSelect }: { rows: AuditTableRow[]; selectedId: string | null; onSelect: (dealId: string) => void }) {
  return (
    <div id="all-issues-table" className="all-issues-body">
      <p className="all-issues-legend">
        $ impact: <strong>+</strong> the forecast would have been that much too high without the fix,
        {" "}<strong>−</strong> too low. Past-due deals show the amount at risk.
      </p>
      <div className="table-scroll">
        <table className="deal-table audit-table">
          <caption className="visually-hidden">All {rows.length} data issues, in audit log order</caption>
          <thead>
            <tr>
              <th scope="col">Source file</th>
              <th scope="col">Record</th>
              <th scope="col">Issue</th>
              <th scope="col">Resolution</th>
              <th scope="col" className="num">$ impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="source">{row.records.map((r, i) => <div key={i}>{r.file}</div>)}</td>
                <td className="record">
                  {row.records.map((r, i) => (
                    <div key={i}>
                      {r.dealId ? (
                        <button type="button" className="row-link" aria-label={`${r.record}: open details`}
                          aria-current={r.dealId === selectedId ? "true" : undefined} onClick={() => onSelect(r.dealId!)}>
                          {r.record}
                        </button>
                      ) : r.record}
                    </div>
                  ))}
                </td>
                <th scope="row" className="wrap issue">
                  <span className="audit-title">{row.title}</span>
                  <span className="audit-item-detail">{row.issue}</span>
                </th>
                <td className="wrap">{row.resolution}</td>
                <td className="num strong">{row.impact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The customer: a button that opens the detail panel when the entry is about a deal. */
function ItemName({ item, selectedId, onSelect }: { item: AuditItem; selectedId: string | null; onSelect: (dealId: string) => void }) {
  if (!item.dealId) return <span className="item-name">{item.name}</span>;
  const dealId = item.dealId;
  return (
    <button type="button" className="row-link item-name" aria-label={`${item.name}: open details`}
      aria-current={dealId === selectedId ? "true" : undefined} onClick={() => onSelect(dealId)}>
      {item.name}
    </button>
  );
}
