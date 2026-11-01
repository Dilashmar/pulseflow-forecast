// The Leadership / Commercial / Contractual score dropdowns in the Deal Room's
// Top 8 rows. Each writes a what-if edit; the banner and the drawer follow.

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
}

// Using a dropdown must not also open the deal drawer.
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

export function ScoreSelects({ deal, scores, onChange }: ScoreSelectsProps) {
  const original = pipelineScores(deal);
  const name = deal.customer ?? deal.deal_id;

  return (
    <div className="score-pickers" role="group" aria-label={`Scores for ${name}`}>
      {PILLARS.map((p) => {
        const changed = original !== null && scores[p.key] !== original[p.key];
        return (
          <span key={p.key}>
            <select
              aria-label={`${p.label} score for ${name}${changed ? " (edited)" : ""}`}
              title={`${p.label} score`}
              value={scores[p.key]}
              className={changed ? "changed" : undefined}
              onClick={stop}
              onKeyDown={stop}
              onChange={(e) => onChange(deal, p.key, Number(e.target.value))}
            >
              {SCORE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </span>
        );
      })}
    </div>
  );
}
