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

      {/* A slim strip: the brief's four numbers, small labels above bold values, thin dividers. */}
      <section className="banner" aria-label="Forecast summary">
        <dl className="kpi-strip">
          <div className="kpi">
            <dt>{view.totalLabel}</dt>
            <dd className="kpi-value">{view.total}</dd>
          </div>
          <div className="kpi">
            <dt>{view.varianceLabel}</dt>
            <dd className={`kpi-value ${view.onTarget ? "variance-on" : "variance-short"}`}>
              {view.onTarget ? <CheckIcon /> : <WarningIcon />}
              <span className="visually-hidden">{view.varianceStatus}: </span>
              {view.variance}
            </dd>
          </div>
          <div className="kpi">
            <dt>{view.top.label}</dt>
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
          <div className="kpi">
            <dt>{view.longtail.label}</dt>
            <dd className="kpi-value">{view.longtail.value}</dd>
            <dd className="kpi-extra kpi-split">
              {view.longtail.split.map((part) => (
                <span key={part.label}>{part.label} <strong>{part.value}</strong></span>
              ))}
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

// Icons: decoration only (the text beside each one names it).
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const CheckIcon = () => <Icon size={18}><path d="M3 8.5l3 3 7-7" /></Icon>;
const WarningIcon = () => <Icon size={18}><path d="M8 2L1.5 13.5h13z" /><path d="M8 6.5v3" /><path d="M8 11.8v.2" /></Icon>;
const UndoIcon = () => <Icon><path d="M5.5 3L2.5 6l3 3" /><path d="M2.5 6h7a4 4 0 0 1 0 8H7" /></Icon>;
const UploadIcon = () => <Icon><path d="M8 11V2.5" /><path d="M4.5 6L8 2.5 11.5 6" /><path d="M2.5 11v2.5h11V11" /></Icon>;
