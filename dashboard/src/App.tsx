import { useCallback, useState } from "react";

import { Banner } from "./Banner";
import { bannerView } from "./bannerView";
import { audit, forecast } from "./data";
import { dealDetail } from "./dealDetail";
import { dealRoomRows } from "./dealRoomRows";
import { DealTable } from "./DealTable";
import { NO_FILTERS, filterOptions, summary, visibleRows, type Filters, type Sort } from "./tableView";
import { DetailPanel } from "./DetailPanel";
import { BASELINE, isChanged, reset, setScore, setVpOverride, type Scenario } from "./forecast";
import { Sidebar, TABS, type Tab } from "./Sidebar";

export function App() {
  // The what-if scenario: score edits and the VP override toggle. Everything on
  // screen is recomputed from forecast.json's deals for this scenario.
  const [scenario, setScenario] = useState<Scenario>(BASELINE);
  const [tab, setTab] = useState<Tab>("deal-room");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closePanel = useCallback(() => setSelectedId(null), []);

  const view = bannerView(forecast, scenario);
  const rows = dealRoomRows(forecast, scenario);
  const shown = visibleRows(rows, filters, search, sort);
  const selected = tab === "deal-room" ? rows.find((r) => r.dealId === selectedId) : undefined;

  return (
    <div className={`shell${selected ? " with-panel" : ""}`}>
      <div className="top">
        <header className="app-header">
          <h1>{view.title}</h1>
          <p className="as-of">{view.asOf}</p>
        </header>
        <Banner view={view} onVpOverrideChange={(on) => setScenario((s) => setVpOverride(s, on))} />
      </div>

      <Sidebar
        tab={tab}
        onTabChange={setTab}
        filters={filters}
        onFiltersChange={setFilters}
        options={filterOptions(rows)}
      />

      <main className="main">
        {tab === "deal-room" ? (
          <DealTable
            rows={shown}
            summary={summary(shown, rows.length)}
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            selectedId={selectedId}
            onSelect={setSelectedId}
            changed={isChanged(scenario)}
            onReset={() => setScenario(reset())}
          />
        ) : (
          <section className="card placeholder">
            <h2>{TABS.find((t) => t.key === tab)!.label}</h2>
            <p className="muted">Coming next.</p>
          </section>
        )}
      </main>

      {selected && (
        <DetailPanel
          detail={dealDetail(selected.deal, scenario, forecast, audit)}
          onScoreChange={(deal, pillar, value) => setScenario((s) => setScore(s, deal, pillar, value))}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
