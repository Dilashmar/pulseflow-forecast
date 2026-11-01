import { useCallback, useEffect, useState } from "react";

import { Banner } from "./Banner";
import { bannerView } from "./bannerView";
import { audit, forecast, weekOverWeek } from "./data";
import { dealDetail } from "./dealDetail";
import { DataAudit } from "./DataAudit";
import { dealRoomRows } from "./dealRoomRows";
import { DealTable } from "./DealTable";
import { NO_FILTERS, changeCount, dealSections, filterOptions, visibleRows, type Filters } from "./tableView";
import { DetailPanel } from "./DetailPanel";
import {
  BASELINE, demote, promote, reset, setScore, setVpOverride, type Pillar, type Scenario,
} from "./forecast";
import { TabBar, type Tab } from "./Tabs";
import type { Deal } from "./types";
import { UpdateDialog } from "./UpdateDialog";
import { ServerDown, getStatus, undoUpdate, type UpdateStatus } from "./updateApi";
import { SERVER_DOWN, canUndo } from "./uploadView";
import { WhatChanged } from "./WhatChanged";
import { whatChangedView } from "./whatChangedView";

// Week over week doesn't change with the what-if scenario: work it out once.
const changesView = whatChangedView(weekOverWeek);

export function App() {
  // The what-if scenario: score edits and the VP override toggle. Everything on
  // screen is recomputed from forecast.json's deals for this scenario.
  const [scenario, setScenario] = useState<Scenario>(BASELINE);
  const [tab, setTab] = useState<Tab>("deal-room");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closePanel = useCallback(() => setSelectedId(null), []);
  // Weekly update (SPEC 8). If the update server isn't running, status stays null:
  // the dashboard works as usual and the dialog explains how to start the server.
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  useEffect(() => {
    getStatus().then(setUpdateStatus).catch(() => setUpdateStatus(null));
  }, [updateOpen]);
  const goBack = async () => {
    const message = "Go back to last week's data? This week's update is removed from the dashboard.";
    if (!window.confirm(message)) return;
    try {
      await undoUpdate();
      window.location.reload();
    } catch (e) {
      window.alert(e instanceof ServerDown ? SERVER_DOWN : (e as Error).message);
    }
  };
  // One handler for the table's and the panel's score dropdowns, so both always agree.
  const changeScore = (deal: Deal, pillar: Pillar, value: number) =>
    setScenario((s) => setScore(s, deal, pillar, value));
  // Promote to Top / Move to Longtail, from a table row or the drawer.
  const moveDeal = (deal: Deal, kind: "promote" | "demote") =>
    setScenario((s) => (kind === "promote" ? promote(s, deal, forecast.settings) : demote(s, deal)));
  // Clicking a deal opens its details in a drawer over the table.
  const selectDeal = (dealId: string) => setSelectedId(dealId);

  const view = bannerView(forecast, scenario);
  const rows = dealRoomRows(forecast, scenario);
  const sections = dealSections(visibleRows(rows, filters, search));
  // Any deal in forecast.json can open the panel, including ones not in the forecast (read-only).
  const selected = forecast.deals.find((d) => d.deal_id === selectedId);

  return (
    <div className="shell">
      {/* Pinned: the header, the banner strip and the tabs. Only the content below scrolls. */}
      <div className="top">
        <Banner
          view={view}
          onVpOverrideChange={(on) => setScenario((s) => setVpOverride(s, on))}
          onUpload={() => setUpdateOpen(true)}
          showUndo={canUndo(updateStatus)}
          onUndo={goBack}
        />
        <TabBar tab={tab} onTabChange={setTab} />
      </div>

      <UpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} status={updateStatus}
        dashboardAsOf={forecast.meta.as_of} />

      <main className="main">
        {tab === "deal-room" ? (
          <DealTable
            sections={sections}
            filters={filters}
            onFiltersChange={setFilters}
            options={filterOptions(rows)}
            search={search}
            onSearchChange={setSearch}
            selectedId={selectedId}
            onSelect={selectDeal}
            onScoreChange={changeScore}
            onMove={moveDeal}
            changes={changeCount(rows, scenario)}
            onReset={() => setScenario(reset())}
          />
        ) : tab === "what-changed" ? (
          <WhatChanged view={changesView} selectedId={selectedId} onSelect={selectDeal} />
        ) : (
          <DataAudit audit={audit} forecast={forecast} selectedId={selectedId} onSelect={selectDeal} />
        )}
      </main>

      {selected && (
        <DetailPanel detail={dealDetail(selected, scenario, forecast, weekOverWeek)} onClose={closePanel} />
      )}
    </div>
  );
}
