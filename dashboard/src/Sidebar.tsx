import type { FlagKey } from "./dealRoomRows";
import { FLAG_FILTERS, NO_FILTERS, activeFilterCount, type Filters } from "./tableView";
import type { Bucket } from "./types";

export type Tab = "deal-room" | "what-changed" | "data-audit";

export const TABS: { key: Tab; label: string; short: string }[] = [
  { key: "deal-room", label: "Deal Room", short: "DR" },
  { key: "what-changed", label: "What Changed", short: "WC" },
  { key: "data-audit", label: "Data Hygiene & Audit Log", short: "AL" },
];

const BUCKETS: Bucket[] = ["Top", "Longtail"];

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  options: { products: string[]; reps: string[] };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function Sidebar(props: SidebarProps) {
  const { tab, onTabChange, filters, onFiltersChange, options, collapsed, onCollapsedChange } = props;
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const filterCount = activeFilterCount(filters);
  const hasFilters = filterCount > 0;

  if (collapsed) {
    // Narrow rail: tabs as short labels, a Filters button with the active count, and expand.
    return (
      <aside className="sidebar rail" aria-label="Sidebar (collapsed)">
        <button type="button" className="rail-button" aria-label="Expand sidebar" title="Expand sidebar"
          onClick={() => onCollapsedChange(false)}>
          »
        </button>
        <nav aria-label="Tabs">
          <ul className="rail-list">
            {TABS.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className={`rail-button rail-tab${tab === t.key ? " active" : ""}`}
                  aria-label={t.label}
                  aria-current={tab === t.key ? "page" : undefined}
                  title={t.label}
                  onClick={() => onTabChange(t.key)}
                >
                  {t.short}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {tab === "deal-room" && (
          <button
            type="button"
            className="rail-button rail-filters"
            aria-label={hasFilters ? `Filters: ${filterCount} active. Expand sidebar` : "Filters. Expand sidebar"}
            title="Filters"
            onClick={() => onCollapsedChange(false)}
          >
            <span aria-hidden="true">⚲</span>
            {hasFilters && <span className="badge">{filterCount}</span>}
          </button>
        )}
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button type="button" className="rail-button" aria-label="Collapse sidebar" title="Collapse sidebar"
          onClick={() => onCollapsedChange(true)}>
          «
        </button>
      </div>
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
