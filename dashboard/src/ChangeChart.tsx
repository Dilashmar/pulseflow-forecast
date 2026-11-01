import { Bar, BarChart, Cell, LabelList, ReferenceLine, Tooltip, XAxis, YAxis, ResponsiveContainer } from "recharts";

import type { ChangeBar } from "./whatChangedView";

// Same as --good / --bad in styles.css (SVG fill attributes can't read CSS variables).
// Red and green alone aren't safe for colour-blind readers: every bar also has a signed label.
const FILL = { up: "#2e844a", down: "#ba0517", zero: "#a0a0a0" } as const;
const ROW_HEIGHT = 44;

interface ChangeChartProps {
  bars: ChangeBar[];
}

/** Horizontal diverging bars: increases right of zero, decreases left. The tables below hold the same numbers. */
export function ChangeChart({ bars }: ChangeChartProps) {
  const data = bars.map((b) => ({ ...b, value: b.valueCents / 100, name: `${b.label} (${b.count})` }));
  // Same distance either side of zero, with room for the labels.
  const reach = Math.max(1, ...data.map((d) => Math.abs(d.value))) * 1.3;

  return (
    <div className="change-chart-plot" aria-hidden="true">
      <ResponsiveContainer width="100%" height={bars.length * ROW_HEIGHT + 16}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }} barCategoryGap={10}
          accessibilityLayer={false}>
          <XAxis type="number" domain={[-reach, reach]} hide />
          <YAxis type="category" dataKey="name" width={170} axisLine={false} tickLine={false}
            tick={{ fill: "#444444", fontSize: 14 }} />
          <ReferenceLine x={0} stroke="#706e6b" />
          <Tooltip cursor={{ fill: "#f3f6fb" }} content={<BarTooltip />} />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={FILL[d.tone]} />
            ))}
            <LabelList dataKey="valueText" content={<BarLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface LabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
}

/** The signed amount just past the end of the bar: right of an increase, left of a decrease. */
function BarLabel({ x = 0, y = 0, width = 0, height = 0, value }: LabelProps) {
  const [left, w, top, h] = [Number(x), Number(width), Number(y), Number(height)];
  const negative = String(value).startsWith("−");
  const start = Math.min(left, left + w);
  const end = Math.max(left, left + w);
  return (
    <text x={negative ? start - 8 : end + 8} y={top + h / 2} dy="0.35em" textAnchor={negative ? "end" : "start"}
      fill="#181818" fontSize={14} fontWeight={600}>
      {value}
    </text>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: { payload: ChangeBar }[];
}

function BarTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const bar = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{bar.label}</strong>
      <span>{bar.valueText} from {bar.count} {bar.count === 1 ? "deal" : "deals"}</span>
    </div>
  );
}
