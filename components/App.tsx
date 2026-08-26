"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Line, LineStatus, Statement, ParsedLine } from "@/lib/types";
import { parseWorkbook, groupIntoStatements } from "@/lib/xlsxParse";
import { parseAmexPdf } from "@/lib/pdfParse";
import {
  subscribeStatements,
  subscribeAllLines,
  computeImportPreview,
  applyImport,
  setLineStatus,
  setLineNote,
  renameStatement,
  deleteStatement,
  attachAsset,
  removeAsset,
  fetchAssetBlob,
  type ImportPreviewGroup,
} from "@/lib/store";
import { useSignOut } from "./AuthGate";
import Sidebar from "./Sidebar";
import LineRow from "./LineRow";
import ImportModal from "./ImportModal";
import { RenameModal, DeleteStatementModal, ErrorModal } from "./ConfirmModals";

type Filter = "all" | "noattach" | "manquant";
type ModalState =
  | { type: "none" }
  | { type: "import"; fileName: string; groups: ImportPreviewGroup[] }
  | { type: "rename"; statement: Statement }
  | { type: "delete"; statement: Statement }
  | { type: "error"; message: string };

export default function App() {
  const signOut = useSignOut();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [linesByStatement, setLinesByStatement] = useState<Record<string, Line[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [importBusy, setImportBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeStatements(setStatements), []);
  useEffect(() => subscribeAllLines(setLinesByStatement), []);

  useEffect(() => {
    if (!selectedId && statements.length) setSelectedId(statements[0].id);
  }, [statements, selectedId]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  const totalLines = Object.values(linesByStatement).reduce((a, l) => a + l.length, 0);
  const totalMissing = Object.values(linesByStatement).reduce((a, l) => a + l.filter((x) => !x.asset).length, 0);
  const missingCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, lines] of Object.entries(linesByStatement)) out[id] = lines.filter((l) => !l.asset).length;
    return out;
  }, [linesByStatement]);
  const lineCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, lines] of Object.entries(linesByStatement)) out[id] = lines.length;
    return out;
  }, [linesByStatement]);

  const selectedStatement = statements.find((s) => s.id === selectedId) || null;
  const selectedLines = (selectedId && linesByStatement[selectedId]) || [];

  const filteredLines = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return selectedLines.filter((l) => {
      if (filter === "noattach" && l.asset) return false;
      if (filter === "manquant" && l.status !== "manquant") return false;
      if (
        term &&
        !(
          l.libelle.toLowerCase().includes(term) ||
          (l.reference || "").toLowerCase().includes(term) ||
          (l.note || "").toLowerCase().includes(term)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [selectedLines, filter, searchTerm]);

  async function handleImportFile(file: File) {
    // Step 1: read & parse the file itself. Failures here are really about
    // the file (unreadable, wrong format, no recognizable columns).
    // Two source formats are supported: the accountant's Excel export, and
    // the official Amex PDF statement — routed by extension.
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    let lines: ParsedLine[];
    try {
      const buf = await file.arrayBuffer();
      if (isPdf) {
        lines = await parseAmexPdf(buf);
      } else {
        const wb = XLSX.read(buf, { type: "array" });
        const parsed = parseWorkbook(wb);
        lines = parsed?.lines ?? [];
      }
    } catch (err) {
      console.error("import parse failed:", err);
      setModal({
        type: "error",
        message: isPdf
          ? "Ce PDF n'a pas pu être lu. Vérifie qu'il s'agit bien du relevé de compte Amex (pas un autre document), et qu'il n'est pas protégé par un mot de passe."
          : "Ce fichier n'a pas pu être lu. Vérifie qu'il s'agit bien d'un fichier Excel (.xlsx), et qu'il n'est pas protégé par un mot de passe.",
      });
      return;
    }
    if (!lines.length) {
      setModal({
        type: "error",
        message: isPdf
          ? "Aucune ligne de transaction reconnue dans ce PDF. Vérifie qu'il s'agit bien du relevé de compte complet (pas un extrait ou une capture d'écran)."
          : "Aucune ligne reconnue dans ce fichier. Vérifie qu'il contient bien les colonnes Date, Libellé, Débit et Crédit.",
      });
      return;
    }

    // Step 2: check what's already stored, against Firestore. Failures here
    // are almost always security-rules/permissions issues, not the file —
    // give a message that actually points at the real cause.
    try {
      const groups = groupIntoStatements(lines);
      const preview = await computeImportPreview(groups);
      setModal({ type: "import", fileName: file.name, groups: preview });
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      if (code.includes("permission-denied")) {
        setModal({
          type: "error",
          message: "Le fichier a bien été lu, mais Firestore refuse l'accès. Vérifie que ton email est bien dans firestore.rules et que les règles ont été déployées (firebase deploy --only firestore:rules,storage:rules).",
        });
      } else {
        setModal({ type: "error", message: "Le fichier a bien été lu, mais la connexion à la base de données a échoué. Vérifie ta connexion et réessaie." });
      }
    }
  }

  async function handleConfirmImport() {
    if (modal.type !== "import") return;
    setImportBusy(true);
    try {
      const total = await applyImport(modal.groups);
      const firstNew = modal.groups.find((g) => g.newCount > 0);
      if (firstNew) setSelectedId(firstNew.id);
      setModal({ type: "none" });
      showToast(`${total} nouvelle${total > 1 ? "s" : ""} ligne${total > 1 ? "s" : ""} importée${total > 1 ? "s" : ""}.`);
        } catch (err) {
      console.error("applyImport failed:", err);
      showToast("L'import a échoué — réessaie.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleAttach(lineId: string, file: File) {
    if (!selectedId) return;
    const line = selectedLines.find((l) => l.id === lineId);
    try {
      await attachAsset(selectedId, lineId, file, line?.asset || null);
    } catch (err) {
      console.error("attachAsset failed:", err);
      showToast("Envoi du justificatif impossible — réessaie.");
    }
  }

  async function handleRemoveAttach(line: Line) {
    if (!selectedId || !line.asset) return;
    await removeAsset(selectedId, line.id, line.asset).catch(() => showToast("Suppression impossible."));
  }

  async function handleViewAttach(line: Line) {
    if (!line.asset) return;
    try {
      const blob = await fetchAssetBlob(line.asset.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = line.asset.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      showToast("Téléchargement impossible.");
    }
  }

  async function handleChangeStatus(lineId: string, status: LineStatus) {
    if (!selectedId) return;
    await setLineStatus(selectedId, lineId, status).catch(() => showToast("Enregistrement impossible."));
  }
  async function handleEditNote(lineId: string, note: string) {
    if (!selectedId) return;
    await setLineNote(selectedId, lineId, note).catch(() => showToast("Enregistrement impossible."));
  }

  async function handleRename(label: string) {
    if (modal.type !== "rename") return;
    await renameStatement(modal.statement.id, label).catch(() => showToast("Renommage impossible."));
    setModal({ type: "none" });
  }

  async function handleDeleteStatement() {
    if (modal.type !== "delete") return;
    const id = modal.statement.id;
    const lines = linesByStatement[id] || [];
    setModal({ type: "none" });
    try {
      await deleteStatement(id, lines);
      if (selectedId === id) {
        const remaining = statements.filter((s) => s.id !== id);
        setSelectedId(remaining[0]?.id || null);
      }
    } catch {
      showToast("Suppression impossible.");
    }
  }

  return (
    <div id="root-app">
      <header className="topbar">
        <div className="brand">
          <h1>🧾 Classeur Amex</h1>
          <span className="tagline">Relevé et justificatifs, au même endroit</span>
        </div>
        {statements.length > 0 && (
          <>
            <span className="stat-pill">
              <span className="n">{totalLines}</span> ligne{totalLines > 1 ? "s" : ""}
            </span>
            <span className={`stat-pill ${totalMissing ? "warn-count" : ""}`}>
              <span className="n">{totalMissing}</span> sans justificatif
            </span>
          </>
        )}
        <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 3v13m0 0l-5-5m5 5l5-5M4 21h16" />
          </svg>
          Importer un relevé
        </button>
        <button className="btn btn-ghost" onClick={signOut}>
          Se déconnecter
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) handleImportFile(f);
          }}
        />
      </header>

      <div className="layout">
        <Sidebar
          statements={statements}
          selectedId={selectedId}
          missingCounts={missingCounts}
          lineCounts={lineCounts}
          onSelect={(id) => {
            setSelectedId(id);
            setSearchTerm("");
            setFilter("all");
          }}
        />

        <main className="content">
          {!selectedStatement ? (
            <div className="empty-state">
              <div className="display">{statements.length ? "Sélectionne un relevé" : "Aucun relevé pour l'instant"}</div>
              <p>
                {statements.length
                  ? "Choisis un relevé dans la liste à gauche pour voir ses lignes et ses justificatifs."
                  : "Importe le relevé Amex (Excel de ta comptable ou PDF téléchargé depuis Amex) : chaque ligne apparaîtra ici, prête à recevoir son justificatif."}
              </p>
              {!statements.length && (
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  Importer un relevé
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="content-toolbar">
                <div className="content-title-group">
                  <h2>{selectedStatement.label}</h2>
                  <button className="icon-btn" title="Renommer" onClick={() => setModal({ type: "rename", statement: selectedStatement })}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    title="Supprimer ce relevé"
                    onClick={() => setModal({ type: "delete", statement: selectedStatement })}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" />
                    </svg>
                  </button>
                </div>
                <div className="filter-chips">
                  <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
                    Toutes ({selectedLines.length})
                  </button>
                  <button className={`chip ${filter === "noattach" ? "active" : ""}`} onClick={() => setFilter("noattach")}>
                    Sans justificatif ({missingCounts[selectedStatement.id] ?? 0})
                  </button>
                  <button className={`chip ${filter === "manquant" ? "active" : ""}`} onClick={() => setFilter("manquant")}>
                    Signalées manquantes ({selectedLines.filter((l) => l.status === "manquant").length})
                  </button>
                </div>
                <div className="search-box">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Rechercher un commerçant…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="table-wrap">
                {filteredLines.length ? (
                  <table className="lines">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Date</th>
                        <th>Libellé</th>
                        <th className="num" style={{ width: 100 }}>
                          Débit
                        </th>
                        <th className="num" style={{ width: 100 }}>
                          Crédit
                        </th>
                        <th style={{ width: 200 }}>Justificatif</th>
                        <th style={{ width: 150 }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLines.map((l) => (
                        <LineRow
                          key={l.id}
                          line={l}
                          onAttach={handleAttach}
                          onRemoveAttach={handleRemoveAttach}
                          onViewAttach={handleViewAttach}
                          onChangeStatus={handleChangeStatus}
                          onEditNote={handleEditNote}
                        />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <p>Aucune ligne ne correspond à ce filtre.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {modal.type === "import" && (
        <ImportModal
          fileName={modal.fileName}
          groups={modal.groups}
          busy={importBusy}
          onCancel={() => setModal({ type: "none" })}
          onConfirm={handleConfirmImport}
        />
      )}
      {modal.type === "rename" && (
        <RenameModal statement={modal.statement} onCancel={() => setModal({ type: "none" })} onConfirm={handleRename} />
      )}
      {modal.type === "delete" && (
        <DeleteStatementModal
          statement={modal.statement}
          lines={linesByStatement[modal.statement.id] || []}
          onCancel={() => setModal({ type: "none" })}
          onConfirm={handleDeleteStatement}
        />
      )}
      {modal.type === "error" && <ErrorModal message={modal.message} onClose={() => setModal({ type: "none" })} />}

      {toast && (
        <div className="toast-wrap">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}