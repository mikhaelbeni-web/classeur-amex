"use client";

import type { ImportPreviewGroup } from "@/lib/store";

interface Props {
  fileName: string;
  groups: ImportPreviewGroup[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ImportModal({ fileName, groups, busy, onCancel, onConfirm }: Props) {
  const totalNew = groups.reduce((a, g) => a + g.newCount, 0);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Importer {fileName}</h3>
        <p className="modal-sub">
          {groups.length} relevé{groups.length > 1 ? "s" : ""} détecté{groups.length > 1 ? "s" : ""} dans ce fichier.
        </p>
        <div className="import-groups">
          {groups.map((g) => (
            <div key={g.id} className={`import-group-row ${g.newCount > 0 ? "is-new" : "is-dup"}`}>
              <span className="g-label">{g.label}</span>
              <span className="g-status">
                {g.isNewStatement
                  ? `${g.newCount} ligne${g.newCount > 1 ? "s" : ""}`
                  : g.newCount > 0
                  ? `+${g.newCount} nouvelle${g.newCount > 1 ? "s" : ""}`
                  : "déjà à jour"}
              </span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy || totalNew === 0}>
            {busy ? "Import…" : "Importer"}
          </button>
        </div>
      </div>
    </div>
  );
}
