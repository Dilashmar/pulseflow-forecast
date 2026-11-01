import { useState, type ReactNode } from "react";

import type { DealRoomRow } from "./dealRoomRows";
import type { Pillar } from "./forecast";
import { ScoreSelects } from "./ScoreSelects";
import { resetLabel, type Filters, type Section } from "./tableView";
import type { Deal } from "./types";

interface DealTableProps {
  sections: Section[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  options: { products: string[]; reps: string[] };
  search: string;
  onSearchChange: (search: string) => void;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
  onScoreChange: (deal: Deal, pillar: Pillar, value: number) => void;
  onMove: (deal: Deal, kind: "promote" | "demote") => void;
  changes: number; // what Reset to baseline would undo; the button shows only when > 0
  onReset: () => void;
}

/** The Deal Room (SPEC 6.2): a toolbar, then two sections, Top 8 strategic deals and
 *  Forecasted Longtail. One scroll area; each section's column headings stay in view. */
export function DealTable(props: DealTableProps) {
  const {
    sections, filters, onFiltersChange, options, search, onSearchChange, selectedId, onSelect,
    onScoreChange, onMove, changes, onReset,
  } = props;
  const [longtailOpen, setLongtailOpen] = useState(true);
  const [top, longtail] = sections;

  return (
    <section className="card deal-room" aria-label="Deal Room">
      <div className="toolbar">
        <div className="toolbar-filters">
          <label className="field">
            <span>Product</span>
            <select value={filters.product ?? ""} onChange={(e) => onFiltersChange({ ...filters, product: e.target.value || null })}>
              <option value="">All products</option>
              {options.products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Rep</span>
            <select value={filters.rep ?? ""} onChange={(e) => onFiltersChange({ ...filters, rep: e.target.value || null })}>
              <option value="">All reps</option>
              {options.reps.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="search-field">
            <SearchIcon />
            <span className="visually-hidden">Search deals</span>
            <input type="search" placeholder="Search" value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </label>
        </div>
        {changes > 0 && (
          <button type="button" className="button" onClick={onReset}>{resetLabel(changes)}</button>
        )}
      </div>

      <div className="table-scroll">
        <SectionTable section={top} heading={<h2>{top.title} <span className="section-count">({top.rows.length})</span></h2>}
          detailColumn="Scores (L / C / K)" render={(row) => (
            <ScoreSelects deal={row.deal} scores={row.scores!} onChange={onScoreChange} variant="compact" />
          )}
          action={(row) => (
            <button type="button" className="row-action" aria-label={`Move ${row.customer} to the Longtail`}
              onClick={() => onMove(row.deal, "demote")}>
              <ArrowDownIcon /> To Longtail
            </button>
          )}
          selectedId={selectedId} onSelect={onSelect} />

        <SectionTable section={longtail} open={longtailOpen}
          heading={
            <h2>
              <button type="button" className="section-toggle" aria-expanded={longtailOpen}
                onClick={() => setLongtailOpen(!longtailOpen)}>
                <ChevronIcon open={longtailOpen} />
                {longtail.title} <span className="section-count">({longtail.rows.length})</span>
              </button>
            </h2>
          }
          detailColumn="Stage" render={(row) => row.stage}
          action={(row) => (
            <button type="button" className="row-action" aria-label={`Promote ${row.customer} to the Top 8`}
              onClick={() => onMove(row.deal, "promote")}>
              <ArrowUpIcon /> To Top 8
            </button>
          )}
          selectedId={selectedId} onSelect={onSelect} />
      </div>
    </section>
  );
}

interface SectionTableProps {
  section: Section;
  heading: ReactNode;
  open?: boolean;
  detailColumn: string; // the fourth column: Scores (Top 8) or Stage (Longtail)
  render: (row: DealRoomRow) => ReactNode;
  action: (row: DealRoomRow) => ReactNode;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

function SectionTable({ section, heading, open = true, detailColumn, render, action, selectedId, onSelect }: SectionTableProps) {
  return (
    <div className={`deal-section deal-section-${section.key}`}>
      <div className="section-head">
        {heading}
        <span className="section-total">{section.total}</span>
      </div>
      {open && (
        <table className="deal-table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Product</th>
              <th scope="col">Rep</th>
              <th scope="col">{detailColumn}</th>
              <th scope="col" className="num">Win %</th>
              <th scope="col" className="num">Expected value</th>
              <th scope="col"><span className="visually-hidden">Move</span></th>
            </tr>
          </thead>
          <tbody>
            {section.rows.length === 0 && (
              <tr><td colSpan={7} className="empty">No deals match.</td></tr>
            )}
            {section.rows.map((row) => {
              const selected = row.dealId === selectedId;
              const changed = row.edited || row.moved !== null;
              return (
                // Clicking the row opens the drawer (mouse); the customer name is the keyboard target.
                <tr key={row.dealId} className={[changed && "edited", selected && "selected"].filter(Boolean).join(" ") || undefined}
                  aria-current={selected ? "true" : undefined} onClick={() => onSelect(row.dealId)}>
                  <th scope="row" className="customer">
                    <button type="button" className="row-link" aria-label={`${row.customer}: open details`}
                      onClick={(e) => { e.stopPropagation(); onSelect(row.dealId); }}>
                      {row.customer}
                    </button>
                    {row.chips.length > 0 && (
                      <span className="chips">
                        {row.chips.map((c) => <span key={c.label} className={`chip chip-${c.tone}`}>{c.label}</span>)}
                      </span>
                    )}
                  </th>
                  <td>{row.product}</td>
                  <td className="nowrap">{row.salesRep}</td>
                  <td className="nowrap">{render(row)}</td>
                  <td className="num">{row.probability}</td>
                  <td className="num strong">{row.expectedValue}</td>
                  <td className="action" onClick={(e) => e.stopPropagation()}>{action(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ArrowDownIcon = () => <Icon><path d="M8 3v10" /><path d="M4 9l4 4 4-4" /></Icon>;
const ArrowUpIcon = () => <Icon><path d="M8 13V3" /><path d="M4 7l4-4 4 4" /></Icon>;
const SearchIcon = () => <Icon><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></Icon>;
const ChevronIcon = ({ open }: { open: boolean }) => (
  <span className={`chevron${open ? " open" : ""}`}><Icon><path d="M6 3l5 5-5 5" /></Icon></span>
);
