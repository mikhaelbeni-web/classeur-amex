"use client";

import { useState } from "react";
import type { Line, Statement } from "@/lib/types";

export function RenameModal({
  statement,
  onCancel,
  onConfirm,
}: {
  statement: Statement;
  onCancel: () => void;
  onConfirm: (label: string) => void;
}) {
  const [value, setValue] = useState(statement.label);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Renommer le relevé</h3>
        <div className="field">
          <label htmlFor="rename-input">Nom du relevé</label>
          <input id="rename-input" type="text" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => value.trim() && onConfirm(value.trim())}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteStatementModal({
  statement,
  lines,
  onCancel,
  onConfirm,
}: {
  statement: Statement;
  lines: Line[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const withAsset = lines.filter((l) => l.asset).length;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Supprimer « {statement.label} » ?</h3>
        <p className="modal-sub">
          {lines.length} ligne{lines.length > 1 ? "s" : ""} et {withAsset} justificatif{withAsset > 1 ? "s" : ""} seront
          supprimés définitivement.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import impossible</h3>
        <p className="modal-sub">{message}</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
