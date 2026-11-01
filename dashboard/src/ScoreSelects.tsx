// The Leadership / Commercial / Contractual score dropdowns, shared by the Deal
// Room table (compact) and the detail panel (labeled). Both write the same
// what-if edit, so they always show the same values.

import type { KeyboardEvent, MouseEvent } from "react";

import { pipelineScores, type Pillar } from "./forecast";
import type { Deal, Scores } from "./types";

export const PILLARS: { key: Pillar; label: string; short: string }[] = [
  { key: "leadership", label: "Leadership", short: "L" },
  { key: "commercial", label: "Commercial", short: "C" },
  { key: "contractual", label: "Contractual", short: "K" },
];
const SCORE_OPTIONS = [1, 2, 3, 4];

interface ScoreSelectsProps {
  deal: Deal;
  scores: Scores;
  onChange: (deal: Deal, pillar: Pillar, value: number) => void;
  variant: "compact" | "labeled";
}

// In the table, using a dropdown must not also open the detail panel.
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

export function ScoreSelects({ deal, scores, onChange, variant }: ScoreSelectsProps) {
  const original = pipelineScores(deal);
  const name = deal.customer ?? deal.deal_id;

  return (
    <div
      className={variant === "compact" ? "score-pickers" : "score-editor"}
      role="group"
      aria-label={`Scores for ${name}`}
    >
      {PILLARS.map((p) => {
        const changed = original !== null && scores[p.key] !== original[p.key];
        const select = (
          <select
            aria-label={`${p.label} score for ${name}${changed ? " (edited)" : ""}`}
            title={variant === "compact" ? `${p.label} score` : undefined}
            value={scores[p.key]}
            className={changed ? "changed" : undefined}
            onClick={stop}
            onKeyDown={stop}
            onChange={(e) => onChange(deal, p.key, Number(e.target.value))}
          >
            {SCORE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        );
        return variant === "compact" ? (
          <span key={p.key}>{select}</span>
        ) : (
          <label key={p.key} className="score-field">
            <span aria-hidden="true">{p.label}</span>
            {select}
          </label>
        );
      })}
    </div>
  );
}
