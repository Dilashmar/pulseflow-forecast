import type { AuditGroup, AuditItem, AuditView } from "./auditView";

interface DataAuditProps {
  view: AuditView;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

export function DataAudit({ view, selectedId, onSelect }: DataAuditProps) {
  return (
    <section className="card data-audit" aria-label="Data Audit">
      <div className="toolbar">
        <div className="toolbar-title">
          <h2>Data Audit</h2>
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
