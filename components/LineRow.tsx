"use client";

import { useEffect, useRef, useState } from "react";
import type { Line, LineStatus } from "@/lib/types";
import { fmtEntryDate } from "@/lib/xlsxParse";
import { fetchAssetBlob } from "@/lib/store";

function fmtAmount(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " o";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " Ko";
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}

interface Props {
  line: Line;
  onAttach: (lineId: string, file: File) => Promise<void>;
  onRemoveAttach: (line: Line) => void;
  onViewAttach: (line: Line) => void;
  onChangeStatus: (lineId: string, status: LineStatus) => void;
  onEditNote: (lineId: string, note: string) => void;
}

export default function LineRow({ line, onAttach, onRemoveAttach, onViewAttach, onChangeStatus, onEditNote }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [noteValue, setNoteValue] = useState(line.note || "");

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      alert("Ce fichier dépasse 15 Mo, choisis un fichier plus léger.");
      return;
    }
    setUploading(true);
    try {
      await onAttach(line.id, file);
    } finally {
      setUploading(false);
    }
  }

  const isImg = /^image\//.test(line.asset?.type || "");
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImg || !line.asset) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAssetBlob(line.asset.path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      })
      .catch(() => {
        /* thumbnail is a nice-to-have; silently fall back to the icon */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImg, line.asset?.path]);

  return (
    <tr>
      <td className="mono">{fmtEntryDate(line.dateRaw)}</td>
      <td className="libelle-cell">
        <div className="libelle">{line.libelle}</div>
        <div className="sub">
          {line.reference ? `Réf. ${line.reference}` : ""}
          {line.piece ? `${line.reference ? " · " : ""}Pièce ${line.piece}` : ""}
        </div>
        <input
          type="text"
          className="note-input"
          placeholder="Ajouter une note…"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          onBlur={() => {
            if (noteValue !== (line.note || "")) onEditNote(line.id, noteValue);
          }}
        />
      </td>
      <td className="num mono amount-debit">{fmtAmount(line.debit)}</td>
      <td className="num mono amount-credit">{fmtAmount(line.credit)}</td>
      <td>
        {line.asset ? (
          <span className="attach-chip">
            {isImg && thumbUrl ? (
              <img src={thumbUrl} alt="" className="thumb" />
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flex: "none" }}>
                <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            )}
            <button
              type="button"
              className="fname"
              title={`${line.asset.filename} · ${fmtSize(line.asset.size)} — cliquer pour télécharger`}
              onClick={() => onViewAttach(line)}
            >
              {line.asset.filename}
            </button>
            <button type="button" className="remove" title="Retirer le justificatif" onClick={() => onRemoveAttach(line)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ) : (
          <>
            <button type="button" className="add-attach-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {uploading ? "Envoi…" : "Justificatif"}
            </button>
            <input ref={fileInputRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={handleFileChosen} />
          </>
        )}
      </td>
      <td>
        <select
          className={`status-select st-${line.status}`}
          aria-label="Statut"
          value={line.status}
          onChange={(e) => onChangeStatus(line.id, e.target.value as LineStatus)}
        >
          <option value="attente">En attente</option>
          <option value="recu">Reçu</option>
          <option value="manquant">Manquant</option>
        </select>
      </td>
    </tr>
  );
}
