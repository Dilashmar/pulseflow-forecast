import { useCallback, useState } from "react";

import { auditView } from "./auditView";
import { Banner } from "./Banner";
import { bannerView } from "./bannerView";
import { audit, forecast, weekOverWeek } from "./data";
import { dealDetail } from "./dealDetail";
import { DataAudit } from "./DataAudit";
import { dealRoomRows } from "./dealRoomRows";
import { DealTable } from "./DealTable";
import { NO_FILTERS, activeFilterCount, filterOptions, summary, visibleRows, type Filters, type Sort } from "./tableView";
import { DetailPanel } from "./DetailPanel";
import {
  BASELINE, demote, isChanged, promote, reset, setScore, setVpOverride, type Pillar, type Scenario,
} from "./forecast";
import { Sidebar, type Tab } from "./Sidebar";
import type { Deal } from "./types";
import { WhatChanged } from "./WhatChanged";
import { whatChangedView } from "./whatChangedView";

// Week over week and the audit log don't change with the what-if scenario: work them out once.
const changesView = whatChangedView(weekOverWeek);
const dataAuditView = auditView(audit, forecast);

export function App() {
  // The what-if scenario: score edits and the VP override toggle. Everything on
  // screen is recomputed from forecast.json's deals for this scenario.
  const [scenario, setScenario] = useState<Scenario>(BASELINE);
  const [tab, setTab] = useState<Tab>("deal-room");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Collapsed side panels: kept in memory while the page is open (a reload opens both again).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const closePanel = useCallback(() => setSelectedId(null), []);
  // One handler for the table's and the panel's score dropdowns, so both always agree.
  const changeScore = (deal: Deal, pillar: Pillar, value: number) =>
    setScenario((s) => setScore(s, deal, pillar, value));
  // Promote to Top / Move to Longtail from the panel. The deal stays selected.
  const moveDeal = (deal: Deal, kind: "promote" | "demote") =>
    setScenario((s) => (kind === "promote" ? promote(s, deal, forecast.settings) : demote(s, deal)));
  // Clicking a deal means "show me this": the detail panel expands.
  const selectDeal = (dealId: string) => {
    setSelectedId(dealId);
    setPanelCollapsed(false);
  };

  const view = bannerView(forecast, scenario);
  const rows = dealRoomRows(forecast, scenario);
  const shown = visibleRows(rows, filters, search, sort);
  // Any deal in forecast.json can open the panel, including ones not in the forecast (read-only).
  const selected = forecast.deals.find((d) => d.deal_id === selectedId);

  const shellClasses = [
    "shell",
    sidebarCollapsed && "sidebar-collapsed",
    selected && "with-panel",
    selected && panelCollapsed && "panel-collapsed",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClasses}>
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
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
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
            onSelect={selectDeal}
            onScoreChange={changeScore}
            changed={isChanged(scenario)}
            onReset={() => setScenario(reset())}
            filterCount={activeFilterCount(filters)}
            onClearFilters={() => setFilters(NO_FILTERS)}
          />
        ) : tab === "what-changed" ? (
          <WhatChanged view={changesView} selectedId={selectedId} onSelect={selectDeal} />
        ) : (
          <DataAudit view={dataAuditView} selectedId={selectedId} onSelect={selectDeal} />
        )}
      </main>

      {selected && (
        <DetailPanel
          detail={dealDetail(selected, scenario, forecast, audit, weekOverWeek)}
          onScoreChange={changeScore}
          onClose={closePanel}
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
          onMove={moveDeal}
        />
      )}
    </div>
  );
}
