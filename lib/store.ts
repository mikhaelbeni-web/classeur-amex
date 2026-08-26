import {
  collection,
  collectionGroup,
  doc,
  writeBatch,
  updateDoc,
  onSnapshot,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  type Unsubscribe,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  deleteObject,
  getBlob,
} from "firebase/storage";
import { db, storage } from "./firebase";
import type { Asset, Line, LineStatus, Statement } from "./types";
import type { ParsedGroup } from "./types";
import { lineFingerprint } from "./xlsxParse";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------------------------------------------------------------------
   Realtime subscriptions
--------------------------------------------------------------------- */

export function subscribeStatements(cb: (statements: Statement[]) => void): Unsubscribe {
  const q = query(collection(db, "statements"), orderBy("year", "desc"), orderBy("month", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Statement, "id">) })));
  });
}

/**
 * Subscribes to EVERY line across every statement via a Firestore
 * collection-group query, grouped by statement id. At the volume this
 * tool deals with (one small-business card, a few hundred lines a year)
 * this is simpler and always-consistent compared to maintaining
 * denormalized per-statement counters — it's what powers both the
 * sidebar's missing-justificatif badges and the selected statement's
 * table from a single live listener.
 */
export function subscribeAllLines(cb: (linesByStatement: Record<string, Line[]>) => void): Unsubscribe {
  const q = query(collectionGroup(db, "lines"));
  return onSnapshot(q, (snap) => {
    const grouped: Record<string, Line[]> = {};
    for (const d of snap.docs) {
      const statementId = d.ref.parent.parent?.id;
      if (!statementId) continue;
      const line = { id: d.id, ...(d.data() as Omit<Line, "id">) } as Line;
      (grouped[statementId] ||= []).push(line);
    }
    for (const lines of Object.values(grouped)) {
      lines.sort((a, b) => a.dateRaw.localeCompare(b.dateRaw));
    }
    cb(grouped);
  });
}

/* ---------------------------------------------------------------------
   Import: dedupe against what's already stored, then batch-write only
   the genuinely new lines. Mirrors the logic that was validated in the
   original Claude Artifact prototype.
--------------------------------------------------------------------- */

export interface ImportPreviewGroup extends ParsedGroup {
  isNewStatement: boolean;
  newCount: number;
}

export async function computeImportPreview(groups: ParsedGroup[]): Promise<ImportPreviewGroup[]> {
  const out: ImportPreviewGroup[] = [];
  for (const g of groups) {
    const linesSnap = await getDocs(collection(db, "statements", g.id, "lines"));
    const existingFps = new Set(linesSnap.docs.map((d) => lineFingerprint(d.data() as Line)));
    const newCount = g.lines.filter((l) => !existingFps.has(lineFingerprint(l))).length;
    out.push({ ...g, isNewStatement: linesSnap.empty, newCount });
  }
  return out;
}

export async function applyImport(groups: ImportPreviewGroup[]): Promise<number> {
  let total = 0;
  for (const g of groups) {
    if (g.newCount === 0) continue;
    const linesSnap = await getDocs(collection(db, "statements", g.id, "lines"));
    const existingFps = new Set(linesSnap.docs.map((d) => lineFingerprint(d.data() as Line)));
    const newLines = g.lines.filter((l) => !existingFps.has(lineFingerprint(l)));
    if (!newLines.length) continue;

    const batch = writeBatch(db);
    const statementRef = doc(db, "statements", g.id);
    batch.set(
      statementRef,
      {
        label: g.label,
        year: g.year,
        month: g.month,
        importedAt: linesSnap.empty ? serverTimestamp() : undefined,
      },
      { merge: true }
    );
    for (const l of newLines) {
      const lineRef = doc(db, "statements", g.id, "lines", uid());
      batch.set(lineRef, {
        dateRaw: l.dateRaw,
        jal: l.jal,
        piece: l.piece,
        libelle: l.libelle,
        reference: l.reference,
        debit: l.debit,
        credit: l.credit,
        status: "attente" as LineStatus,
        note: "",
        asset: null,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
    total += newLines.length;
  }
  return total;
}

/* ---------------------------------------------------------------------
   Per-line mutations
--------------------------------------------------------------------- */

export async function setLineStatus(statementId: string, lineId: string, status: LineStatus) {
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { status });
}

export async function setLineNote(statementId: string, lineId: string, note: string) {
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { note });
}

export async function renameStatement(statementId: string, label: string) {
  await updateDoc(doc(db, "statements", statementId), { label });
}

export async function deleteStatement(statementId: string, lines: Line[]) {
  await Promise.all(
    lines.filter((l) => l.asset).map((l) => deleteObject(storageRef(storage, l.asset!.path)).catch(() => {}))
  );
  const batch = writeBatch(db);
  for (const l of lines) {
    batch.delete(doc(db, "statements", statementId, "lines", l.id));
  }
  batch.delete(doc(db, "statements", statementId));
  await batch.commit();
}

function extOf(filename: string, mime: string): string {
  const m = /\.([a-zA-Z0-9]{1,6})$/.exec(filename || "");
  if (m) return m[1].toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

/** Downscales large photos client-side before upload (receipts photographed
 *  on a phone are often 5-10MB; this keeps storage and load times sane). */
async function maybeDownscaleImage(file: File): Promise<File> {
  if (!/^image\//.test(file.type) || file.type === "image/gif") return file;
  if (file.size < 900 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxDim = 2000;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export async function attachAsset(statementId: string, lineId: string, rawFile: File, previousAsset: Asset | null) {
  const file = await maybeDownscaleImage(rawFile);
  const ext = extOf(file.name, file.type);
  const path = `justificatifs/${lineId}/${uid()}.${ext}`;
  await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "application/octet-stream" });
  if (previousAsset) {
    await deleteObject(storageRef(storage, previousAsset.path)).catch(() => {});
  }
  const asset: Asset = { path, filename: rawFile.name, size: file.size, type: file.type };
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { asset });
}

export async function removeAsset(statementId: string, lineId: string, asset: Asset) {
  await deleteObject(storageRef(storage, asset.path)).catch(() => {});
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { asset: null });
}

/** Fetches a justificatif's bytes through the authenticated Storage SDK
 *  (rather than a public download URL) so access still goes through
 *  storage.rules on every read. */
export async function fetchAssetBlob(path: string): Promise<Blob> {
  return getBlob(storageRef(storage, path));
}
