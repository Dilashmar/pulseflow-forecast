import type { BannerView } from "./bannerView";

interface BannerProps {
  view: BannerView;
  onVpOverrideChange: (on: boolean) => void;
  onUpload: () => void; // opens the Upload files dialog (SPEC 8)
  showUndo: boolean; // there is an update to undo
  onUndo: () => void;
}

function TileBox({ tile, kind }: { tile: BannerView["tiles"][number]; kind: string }) {
  return (
    <div className={`tile tile-${kind}`}>
      <div className="tile-label">{tile.label}</div>
      <div className="tile-value">{tile.value}</div>
      <div className="tile-count">{tile.count}</div>
    </div>
  );
}

export function Banner({ view, onVpOverrideChange, onUpload, showUndo, onUndo }: BannerProps) {
  const status = view.onTarget ? "on-target" : "short";
  return (
    <section className="banner" aria-label="Forecast summary">
      <div className="progress">
        <div className="progress-heading">
          <h2>Total forecast vs {view.target} target</h2>
          <p className="progress-figures">
            <span className="progress-total">{view.total}</span>
            <span className={`progress-variance ${status}`}>
              {view.variance} · {view.percentOfTarget}
            </span>
          </p>
        </div>
        <div
          className="progress-track"
          role="img"
          aria-label={`${view.total} forecast against a ${view.target} target, ${view.variance}`}
        >
          {view.segments.map((s) => (
            <div
              key={s.key}
              className={`progress-segment segment-${s.key}`}
              style={{ width: `${s.widthPercent}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
          <div className="progress-marker" style={{ left: `${view.targetMarkerPercent}%` }}>
            <span className="progress-marker-label">{view.target} target</span>
          </div>
        </div>
      </div>

      {/* Top deals | Longtail total, with its Core and CareBridge tiles underneath. */}
      <div className="tiles">
        <TileBox tile={view.tiles[0]} kind={view.segments[0].key} />
        <section className="longtail-group" aria-label={`${view.longtail.label}: ${view.longtail.value}`}>
          <p className="longtail-total">
            <span className="tile-label">{view.longtail.label}</span>
            <span className="longtail-value">{view.longtail.value}</span>
            <span className="tile-count">{view.longtail.count}</span>
          </p>
          <div className="longtail-tiles">
            {view.tiles.slice(1).map((tile, i) => (
              <TileBox key={tile.label} tile={tile} kind={view.segments[i + 1].key} />
            ))}
          </div>
        </section>
      </div>

      {/* Always present (empty when fine) so screen readers announce the warning when it appears. */}
      <div className="top-warning-slot" role="status" aria-live="polite">
        {view.topWarning && (
          <p className="top-warning">
            <span className="top-warning-icon" aria-hidden="true">!</span>
            {view.topWarning}
          </p>
        )}
      </div>

      <div className="warnings">
        <span>{view.pastDue}</span>
        <span className="warnings-separator" aria-hidden="true">·</span>
        <label className={`vp-toggle${view.vpOverrideOn ? " on" : ""}`}>
          <input
            type="checkbox"
            role="switch"
            checked={view.vpOverrideOn}
            onChange={(e) => onVpOverrideChange(e.target.checked)}
          />
          <span className="vp-toggle-label">Apply VP overrides</span>
          <span className="vp-toggle-status">{view.vpOverride}</span>
        </label>
        <span className="banner-actions">
          {showUndo && (
            <button type="button" className="button button-small" title="Go back to last week's data"
              aria-label="Undo: go back to last week's data" onClick={onUndo}>
              Undo
            </button>
          )}
          <button type="button" className="button button-small" onClick={onUpload}>
            <span aria-hidden="true">⇪</span> Upload files
          </button>
        </span>
      </div>
    </section>
  );
}
