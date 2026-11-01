import type { ReactNode } from "react";

import type { BannerView } from "./bannerView";

interface BannerProps {
  view: BannerView;
  onVpOverrideChange: (on: boolean) => void;
  onUpload: () => void; // opens the Upload files dialog (SPEC 8)
  showUndo: boolean; // there is an update to undo
  onUndo: () => void;
}

export function Banner({ view, onVpOverrideChange, onUpload, showUndo, onUndo }: BannerProps) {
  return (
    <>
      <header className="app-header">
        <h1>{view.title} <span className="app-quarter">· {view.quarter}</span></h1>
        <div className="header-actions">
          <p className="as-of">{view.asOf}</p>
          {/* Undo only after an upload has been applied (SPEC 8.3). */}
          {showUndo && (
            <button type="button" className="button header-button" title="Go back to last week's data"
              aria-label="Undo: go back to last week's data" onClick={onUndo}>
              <UndoIcon /> Undo
            </button>
          )}
          <button type="button" className="button header-button" onClick={onUpload}>
            <UploadIcon /> Upload
          </button>
        </div>
      </header>

      <section className="banner" aria-label="Forecast summary">
        {/* Four KPI cards, the brief's banner items, with Lightning-style headers. */}
        <dl className="kpi-cards">
          <div className="kpi-card">
            <dt><SumIcon />{view.totalLabel}</dt>
            <dd className="kpi-value">{view.total}</dd>
          </div>
          <div className={`kpi-card ${view.onTarget ? "accent-on" : "accent-short"}`}>
            <dt><TargetIcon />{view.varianceLabel}</dt>
            <dd className={`kpi-value ${view.onTarget ? "variance-on" : "variance-short"}`}>
              {view.onTarget ? <CheckIcon /> : <WarningIcon />}
              <span className="visually-hidden">{view.varianceStatus}: </span>
              {view.variance}
            </dd>
          </div>
          <div className="kpi-card">
            <dt><StarIcon />{view.top.label}</dt>
            <dd className="kpi-value">{view.top.value}</dd>
            <dd className="kpi-extra">
              {/* The VP override only changes Top deals, so its switch sits with their number. */}
              <label className="kpi-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={view.vpOverrideOn}
                  onChange={(e) => onVpOverrideChange(e.target.checked)}
                />
                VP overrides
              </label>
            </dd>
          </div>
          <div className="kpi-card">
            <dt><LayersIcon />{view.longtail.label}</dt>
            <dd className="kpi-value">{view.longtail.value}</dd>
            <dd className="kpi-extra">
              <dl className="kpi-split">
                {view.longtail.split.map((part) => (
                  <div key={part.label}>
                    <dt>{part.label}</dt>
                    <dd>{part.value}</dd>
                  </div>
                ))}
              </dl>
            </dd>
          </div>
        </dl>

        {/* Always present (empty when fine) so screen readers announce the warning when it appears. */}
        <div className="top-warning-slot" role="status" aria-live="polite">
          {view.topWarning && (
            <p className="top-warning">
              <span className="top-warning-icon" aria-hidden="true">!</span>
              {view.topWarning}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2L1.5 13.5h13z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.8v.2" />
    </svg>
  );
}

// Card and button icons: decoration only (the text beside them names each one).
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SumIcon = () => <Icon><path d="M12 3H4l4.5 5L4 13h8" /></Icon>;
const TargetIcon = () => <Icon><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.5" /></Icon>;
const StarIcon = () => <Icon><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></Icon>;
const LayersIcon = () => <Icon><path d="M8 2L1.5 5.5 8 9l6.5-3.5z" /><path d="M1.5 9L8 12.5 14.5 9" /></Icon>;
const UndoIcon = () => <Icon><path d="M5.5 3L2.5 6l3 3" /><path d="M2.5 6h7a4 4 0 0 1 0 8H7" /></Icon>;
const UploadIcon = () => <Icon><path d="M8 11V2.5" /><path d="M4.5 6L8 2.5 11.5 6" /><path d="M2.5 11v2.5h11V11" /></Icon>;
