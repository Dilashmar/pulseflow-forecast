import type { FlagKey } from "./dealRoomRows";
import { FLAG_FILTERS, NO_FILTERS, type Filters } from "./tableView";
import type { Bucket } from "./types";

export type Tab = "deal-room" | "what-changed" | "data-audit";

export const TABS: { key: Tab; label: string }[] = [
  { key: "deal-room", label: "Deal Room" },
  { key: "what-changed", label: "What Changed" },
  { key: "data-audit", label: "Data Audit" },
];

const BUCKETS: Bucket[] = ["Top", "Longtail"];

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  options: { products: string[]; reps: string[] };
}

export function Sidebar({ tab, onTabChange, filters, onFiltersChange, options }: SidebarProps) {
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const hasFilters = filters.products.length + filters.buckets.length + filters.flags.length > 0 || filters.rep !== null;

  return (
    <aside className="sidebar">
      <nav aria-label="Tabs">
        <ul className="nav-list">
          {TABS.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                className={`nav-item${tab === t.key ? " active" : ""}`}
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "deal-room" && (
        <section className="filters" aria-label="Filters">
          <div className="filters-header">
            <h2>Filters</h2>
            {hasFilters && (
              <button type="button" className="link-button" onClick={() => onFiltersChange(NO_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>

          <fieldset>
            <legend>Product</legend>
            {options.products.map((p) => (
              <label key={p} className="check">
                <input
                  type="checkbox"
                  checked={filters.products.includes(p)}
                  onChange={() => onFiltersChange({ ...filters, products: toggle(filters.products, p) })}
                />
                {p}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Rep</legend>
            <select
              aria-label="Rep"
              value={filters.rep ?? ""}
              onChange={(e) => onFiltersChange({ ...filters, rep: e.target.value || null })}
            >
              <option value="">All reps</option>
              {options.reps.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </fieldset>

          <fieldset>
            <legend>Bucket</legend>
            {BUCKETS.map((b) => (
              <label key={b} className="check">
                <input
                  type="checkbox"
                  checked={filters.buckets.includes(b)}
                  onChange={() => onFiltersChange({ ...filters, buckets: toggle(filters.buckets, b) })}
                />
                {b === "Top" ? "Top deals" : "Longtail"}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Flags</legend>
            {FLAG_FILTERS.map((f) => (
              <label key={f.key} className="check">
                <input
                  type="checkbox"
                  checked={filters.flags.includes(f.key)}
                  onChange={() => onFiltersChange({ ...filters, flags: toggle<FlagKey>(filters.flags, f.key) })}
                />
                {f.label}
              </label>
            ))}
          </fieldset>
        </section>
      )}
    </aside>
  );
}
