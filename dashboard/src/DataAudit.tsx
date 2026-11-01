import { useState } from "react";

import { ALL_FILES, auditView } from "./auditView";
import type { AuditFile, ForecastFile } from "./types";

interface DataAuditProps {
  audit: AuditFile;
  forecast: ForecastFile;
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

/** Data Hygiene & Audit Log (SPEC 6.4), in three steps: pick a source file, pick a
 *  type of issue, then open an issue to see its records. */
export function DataAudit({ audit, forecast, selectedId, onSelect }: DataAuditProps) {
  const [file, setFile] = useState(ALL_FILES);
  const [tabKey, setTabKey] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const view = auditView(audit, forecast, file);
  const tab = view.tabs.find((t) => t.key === tabKey) ?? view.tabs[0];

  return (
    <section className="card data-audit" aria-label="Data Hygiene & Audit Log">
      <div className="audit-head">
        <h2>Data Hygiene &amp; Audit Log</h2>
        <p className="record-count">{view.summary}</p>

        <div className="file-filters" role="group" aria-label="Source file">
          {view.files.map((f) => (
            <button key={f.key} type="button" className="pill" aria-pressed={f.key === file} onClick={() => setFile(f.key)}>
              {f.label} <span className="pill-count">({f.count})</span>
            </button>
          ))}
        </div>

        <div className="type-tabs" role="group" aria-label="Type of issue">
          {view.tabs.map((t) => (
            <button key={t.key} type="button" className="type-tab" aria-pressed={t.key === tab.key} onClick={() => setTabKey(t.key)}>
              {t.label} <span className="type-count">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="data-audit-body">
        <ul className="issue-list" aria-label={tab.label}>
          {tab.issues.length === 0 && <li className="issue-empty">No issues of this type in this file.</li>}
          {tab.issues.map((issue) => {
            const isOpen = !!open[issue.key];
            return (
              <li key={issue.key} className="issue">
                <button type="button" className="issue-button" aria-expanded={isOpen}
                  onClick={() => setOpen({ ...open, [issue.key]: !isOpen })}>
                  <span className={`chevron${isOpen ? " open" : ""}`} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
                  </span>
                  <span className="issue-text">
                    <span className="issue-title">{issue.title}</span>
                    <span className="issue-resolution">{issue.resolution}</span>
                  </span>
                  <span className="issue-count">{issue.countText}</span>
                </button>
                {isOpen && (
                  <table className="record-table">
                    <thead>
                      <tr>
                        <th scope="col">Customer</th>
                        <th scope="col">Where</th>
                        <th scope="col">What was wrong</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issue.records.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {r.dealId ? (
                              <button type="button" className="row-link" aria-current={r.dealId === selectedId ? "true" : undefined}
                                aria-label={`${r.name}: open details`} onClick={() => onSelect(r.dealId!)}>
                                {r.name}
                              </button>
                            ) : (
                              <span className="muted">{r.name ?? "Whole file"}</span>
                            )}
                          </td>
                          <td className="record-where">{r.where}</td>
                          <td>{r.wrong}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
