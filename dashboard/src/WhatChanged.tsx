import { ChangeChart } from "./ChangeChart";
import type { ChangeSection, WhatChangedView } from "./whatChangedView";

interface WhatChangedProps {
  view: WhatChangedView;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

export function WhatChanged({ view, selectedId, onSelect }: WhatChangedProps) {
  return (
    <section className="card what-changed" aria-label="What Changed">
      <div className="toolbar">
        <div className="toolbar-title">
          <h2>What Changed</h2>
          <p className="record-count">Since last week's Salesforce export. Select a customer name to open its details.</p>
        </div>
      </div>

      <div className="what-changed-body">
        <figure className="change-chart">
          <figcaption className="section-label">{view.caption}</figcaption>
          <p className="visually-hidden">{view.summary}</p>
          <ChangeChart bars={view.bars} />
          <p className="change-net">{view.net}</p>
        </figure>

        {view.topNote && (
          <p className="top-note">
            <span className="bucket bucket-top">Top</span> {view.topNote}
          </p>
        )}

        {view.sections.map((s) => (
          <ChangeTable key={s.key} section={s} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

interface ChangeTableProps {
  section: ChangeSection;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

function ChangeTable({ section, selectedId, onSelect }: ChangeTableProps) {
  const headingId = `changes-${section.key.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className="change-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{section.heading}</h3>
      <div className="table-scroll">
        <table className="deal-table change-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Product</th>
              <th scope="col">Rep</th>
              <th scope="col">Before → after</th>
              <th scope="col" className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => {
              const selected = row.dealId === selectedId;
              return (
                // Same as the Deal Room: the row responds to a mouse click; the customer name is the keyboard target.
                <tr key={row.key} className={selected ? "selected" : undefined} aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(row.dealId)}>
                  <th scope="row" className="customer" title={row.customer}>
                    <button type="button" className="row-link" aria-label={`${row.customer}: open details`}
                      onClick={(e) => { e.stopPropagation(); onSelect(row.dealId); }}>
                      {row.customer}
                    </button>
                    {row.isTop && <span className="bucket bucket-top change-top">Top</span>}
                    {row.alsoIn && <span className="also-in">{row.alsoIn}</span>}
                  </th>
                  <td>{row.product}</td>
                  <td>{row.salesRep}</td>
                  <td>
                    <BeforeAfter before={row.before} after={row.after} />
                    {row.direction && (
                      <span className={`direction tone-${row.tone}`}>
                        {row.direction.symbol && <span aria-hidden="true">{row.direction.symbol} </span>}
                        {row.direction.word}
                      </span>
                    )}
                    {row.acvNote && <span className="acv-note">{row.acvNote}</span>}
                  </td>
                  <td className={`num change-value tone-${row.tone}`}>{row.change}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
