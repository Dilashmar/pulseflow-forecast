import type { BannerView } from "./bannerView";

interface BannerProps {
  view: BannerView;
  onVpOverrideChange: (on: boolean) => void;
}

export function Banner({ view, onVpOverrideChange }: BannerProps) {
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

      <div className="tiles">
        {view.tiles.map((tile, i) => (
          <div key={tile.label} className={`tile tile-${view.segments[i].key}`}>
            <div className="tile-label">{tile.label}</div>
            <div className="tile-value">{tile.value}</div>
            <div className="tile-count">{tile.count}</div>
          </div>
        ))}
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
      </div>
    </section>
  );
}
