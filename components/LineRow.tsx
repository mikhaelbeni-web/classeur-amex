"use client";

import { useEffect, useRef, useState } from "react";
import type { Asset, Line, LineStatus } from "@/lib/types";
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
  onAttach: (lineId: string, files: File[]) => Promise<void>;
  onRemoveAttach: (line: Line, asset: Asset) => void;
  onViewAttach: (asset: Asset) => void;
  onDownloadAttach: (asset: Asset) => void;
  onChangeStatus: (lineId: string, status: LineStatus) => void;
  onEditNote: (lineId: string, note: string) => void;
}

function AttachChip({
  asset,
  onView,
  onDownload,
  onRemove,
}: {
  asset: Asset;
  onView: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const isImg = /^image\//.test(asset.type || "");
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImg) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAssetBlob(asset.path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      })
      .catch(() => {
        /* thumbnail is a nice-to-have, fall back to the icon silently */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImg, asset.path]);

  return (
    <span className="attach-chip">
      {isImg && thumbUrl ? (
        <img src={thumbUrl} alt="" className="thumb" />
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flex: "none" }}>
          <path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      )}
      <button type="button" className="fname" title={`${asset.filename} · ${fmtSize(asset.size)} — cliquer pour voir`} onClick={onView}>
        {asset.filename}
      </button>
      <button type="button" className="dl" title="Télécharger" onClick={onDownload}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
        </svg>
      </button>
      <button type="button" className="remove" title="Retirer ce justificatif" onClick={onRemove}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

export default function LineRow({ line, onAttach, onRemoveAttach, onViewAttach, onDownloadAttach, onChangeStatus, onEditNote }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [noteValue, setNoteValue] = useState(line.note || "");
  const assets = line.assets || [];

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = "";
    if (!chosen.length) return;
    const tooBig = chosen.filter((f) => f.size > 15 * 1024 * 1024);
    const files = chosen.filter((f) => f.size <= 15 * 1024 * 1024);
    if (tooBig.length) {
      alert(
        `${tooBig.length > 1 ? "Ces fichiers dépassent" : "Ce fichier dépasse"} 15 Mo et ${tooBig.length > 1 ? "ne seront pas envoyés" : "ne sera pas envoyé"} : ${tooBig.map((f) => f.name).join(", ")}`
      );
    }
    if (!files.length) return;
    setUploading(true);
    try {
      await onAttach(line.id, files);
    } finally {
      setUploading(false);
    }
  }

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
        <div className="attach-list">
          {assets.map((asset) => (
            <AttachChip
              key={asset.path}
              asset={asset}
              onView={() => onViewAttach(asset)}
              onDownload={() => onDownloadAttach(asset)}
              onRemove={() => onRemoveAttach(line, asset)}
            />
          ))}
          <button type="button" className="add-attach-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {uploading ? "Envoi…" : assets.length ? "Ajouter" : "Justificatif"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileChosen}
          />
        </div>
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