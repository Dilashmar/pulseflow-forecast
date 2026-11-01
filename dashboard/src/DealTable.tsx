import type { DealRoomRow } from "./dealRoomRows";
import type { Sort, SortKey } from "./tableView";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "customer", label: "Customer" },
  { key: "bucket", label: "Bucket" },
  { key: "product", label: "Product" },
  { key: "salesRep", label: "Rep" },
  { key: "stage", label: "Stage" },
  { key: "annualAcv", label: "Annual ACV", numeric: true },
  { key: "gpa", label: "GPA", numeric: true },
  { key: "probability", label: "Probability", numeric: true },
  { key: "expectedValue", label: "Expected value", numeric: true },
];

interface DealTableProps {
  rows: DealRoomRow[];
  summary: string;
  search: string;
  onSearchChange: (search: string) => void;
  sort: Sort | null;
  onSortChange: (sort: Sort | null) => void;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
  changed: boolean;
  onReset: () => void;
}

export function DealTable(props: DealTableProps) {
  const { rows, summary, search, onSearchChange, sort, onSortChange, selectedId, onSelect, changed, onReset } = props;

  // Click once: ascending (numbers high to low first), again: reverse, a third time: back to pipeline order.
  const nextSort = (key: SortKey, numeric?: boolean): Sort | null => {
    const first = numeric ? "desc" : "asc";
    if (sort?.key !== key) return { key, direction: first };
    if (sort.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
    return null;
  };

  return (
    <section className="card deal-room" aria-label="Deal Room">
      <div className="toolbar">
        <div className="toolbar-title">
          <h2>Deal Room</h2>
          <p className="record-count" aria-live="polite">{summary}</p>
        </div>
        <div className="toolbar-actions">
          <input
            type="search"
            className="search"
            placeholder="Search customer, product, rep, stage or ID"
            aria-label="Search deals"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <button type="button" className="button" onClick={onReset} disabled={!changed}>
            Reset to Baseline
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="deal-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th key={c.key} className={c.numeric ? "num" : undefined} aria-sort={ariaSort}>
                    <button type="button" className="sort-button" onClick={() => onSortChange(nextSort(c.key, c.numeric))}>
                      {c.label}
                      <span className="sort-indicator" aria-hidden="true">
                        {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 1} className="empty">No deals match these filters.</td></tr>
            )}
            {rows.map((row) => {
              const classes = [row.edited && "edited", row.dealId === selectedId && "selected"].filter(Boolean).join(" ");
              return (
                <tr
                  key={row.dealId}
                  className={classes || undefined}
                  tabIndex={0}
                  aria-selected={row.dealId === selectedId}
                  onClick={() => onSelect(row.dealId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row.dealId); } }}
                >
                  <td className="customer">
                    <span className="link">{row.customer}</span>
                    {row.edited && <span className="edited-badge">Edited</span>}
                  </td>
                  <td><span className={`bucket bucket-${row.bucket.toLowerCase()}`}>{row.bucket}</span></td>
                  <td>{row.product}</td>
                  <td>{row.salesRep}</td>
                  <td>{row.stage}</td>
                  <td className="num">{row.annualAcv}</td>
                  <td className="num">{row.gpa}</td>
                  <td className="num">{row.probability}</td>
                  <td className="num strong">{row.expectedValue}</td>
                  <td>
                    <div className="chips">
                      {row.chips.map((c) => <span key={c.label} className={`chip chip-${c.tone}`}>{c.label}</span>)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
