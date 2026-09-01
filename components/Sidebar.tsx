"use client";

import type { Line, Statement } from "@/lib/types";

interface Props {
  statements: Statement[];
  selectedId: string | null;
  missingCounts: Record<string, number>;
  lineCounts: Record<string, number>;
  onSelect: (id: string) => void;
  sachaCount: number;
  sachaActive: boolean;
  onSelectSacha: () => void;
}

export default function Sidebar({
  statements,
  selectedId,
  missingCounts,
  lineCounts,
  onSelect,
  sachaCount,
  sachaActive,
  onSelectSacha,
}: Props) {
  return (
    <aside className="sidebar">
      <button
        className={`statement-item sacha-item ${sachaActive ? "active" : ""}`}
        onClick={onSelectSacha}
      >
        <div className="row1">
          <span className="label">Sacha Lévy</span>
          {sachaCount > 0 && <span className="badge-missing">{sachaCount}</span>}
        </div>
        <div className="meta">Toutes les factures assignées</div>
      </button>
      <div className="sidebar-title">Relevés</div>
      {statements.map((s) => {
        const missing = missingCounts[s.id] ?? 0;
        const count = lineCounts[s.id] ?? 0;
        return (
          <button
            key={s.id}
            className={`statement-item ${s.id === selectedId ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="row1">
              <span className="label">{s.label}</span>
              {missing ? <span className="badge-missing">{missing}</span> : <span className="badge-ok">✓</span>}
            </div>
            <div className="meta">
              {count} ligne{count > 1 ? "s" : ""}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

export function missingCountFor(lines: Line[]): number {
  return lines.filter((l) => !l.assets?.length).length;
}