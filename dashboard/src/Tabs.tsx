// The tab bar under the banner (SPEC 6): the three views, side by side.
// Links in a <nav>; the current one is marked for screen readers (aria-current).

export type Tab = "deal-room" | "what-changed" | "data-audit";

export const TABS: { key: Tab; label: string }[] = [
  { key: "deal-room", label: "Deal Room" },
  { key: "what-changed", label: "What Changed" },
  { key: "data-audit", label: "Data Hygiene & Audit Log" },
];

interface TabBarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function TabBar({ tab, onTabChange }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Views">
      <ul>
        {TABS.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              className={`tab${tab === t.key ? " active" : ""}`}
              aria-current={tab === t.key ? "page" : undefined}
              onClick={() => onTabChange(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
