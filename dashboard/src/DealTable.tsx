import type { DealRoomRow } from "./dealRoomRows";
import type { Pillar } from "./forecast";
import { PILLARS, ScoreSelects } from "./ScoreSelects";
import type { Sort, SortKey } from "./tableView";
import type { Deal } from "./types";

// Columns in order. Those with a sort key can be sorted; Scores and Flags can't.
const COLUMNS: { key: SortKey | "scores" | "flags"; label: string; numeric?: boolean }[] = [
  { key: "customer", label: "Customer" },
  { key: "bucket", label: "Bucket" },
  { key: "product", label: "Product" },
  { key: "salesRep", label: "Rep" },
  { key: "stage", label: "Stage" },
  { key: "annualAcv", label: "Annual ACV", numeric: true },
  { key: "scores", label: "Scores" },
  { key: "gpa", label: "GPA", numeric: true },
  { key: "probability", label: "Probability", numeric: true },
  { key: "expectedValue", label: "Expected value", numeric: true },
  { key: "flags", label: "Flags" },
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
  onScoreChange: (deal: Deal, pillar: Pillar, value: number) => void;
  changed: boolean;
  onReset: () => void;
  filterCount: number;
  onClearFilters: () => void;
}

export function DealTable(props: DealTableProps) {
  const {
    rows, summary, search, onSearchChange, sort, onSortChange, selectedId, onSelect, onScoreChange,
    changed, onReset, filterCount, onClearFilters,
  } = props;

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
          <p className="record-count" aria-live="polite">
            {summary}
            {filterCount > 0 && (
              <span className="filters-active">
                {" · "}{filterCount} {filterCount === 1 ? "filter" : "filters"} active ·{" "}
                <button type="button" className="link-button" onClick={onClearFilters}>Clear</button>
              </span>
            )}
          </p>
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
          <caption className="visually-hidden">
            Forecast deals. Select a customer name to open its details; Top deals have score dropdowns.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                if (c.key === "scores") {
                  return (
                    <th key={c.key} scope="col">
                      <span className="visually-hidden">Scores: Leadership, Commercial, Contractual</span>
                      <span className="score-heading" aria-hidden="true">
                        {PILLARS.map((p) => <abbr key={p.key} title={`${p.label} score`}>{p.short}</abbr>)}
                      </span>
                    </th>
                  );
                }
                if (c.key === "flags") return <th key={c.key} scope="col">{c.label}</th>;
                const key = c.key;
                const active = sort?.key === key;
                const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th key={key} scope="col" className={c.numeric ? "num" : undefined} aria-sort={ariaSort}>
                    <button type="button" className="sort-button" onClick={() => onSortChange(nextSort(key, c.numeric))}>
                      {c.label}
                      <span className="sort-indicator" aria-hidden="true">
                        {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="empty">No deals match these filters.</td></tr>
            )}
            {rows.map((row) => {
              const selected = row.dealId === selectedId;
              const changed = row.edited || row.moved !== null; // score edits, promotions, demotions
              const classes = [changed && "edited", selected && "selected"].filter(Boolean).join(" ");
              return (
                // Clicking anywhere on the row opens the panel (mouse). For keyboard and screen
                // readers the customer name is the button, so the row itself never takes focus.
                <tr
                  key={row.dealId}
                  className={classes || undefined}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(row.dealId)}
                >
                  <th scope="row" className="customer" title={row.customer}>
                    <button
                      type="button"
                      className="row-link"
                      aria-label={`${row.customer}: open details`}
                      onClick={(e) => { e.stopPropagation(); onSelect(row.dealId); }}
                    >
                      {row.customer}
                    </button>
                    {row.edited && <span className="edited-badge">Edited</span>}
                  </th>
                  <td><span className={`bucket bucket-${row.bucket.toLowerCase()}`}>{row.bucket}</span></td>
                  <td>{row.product}</td>
                  <td>{row.salesRep}</td>
                  <td>{row.stage}</td>
                  <td className="num">{row.annualAcv}</td>
                  <td>
                    {row.scores ? (
                      <ScoreSelects deal={row.deal} scores={row.scores} onChange={onScoreChange} variant="compact" />
                    ) : (
                      <span className="muted" aria-label="No scores (Longtail)">—</span>
                    )}
                  </td>
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
