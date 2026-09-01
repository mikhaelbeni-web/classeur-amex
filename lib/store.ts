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
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { supabase, JUSTIFICATIFS_BUCKET } from "./supabase";
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
  // Sorted client-side (rather than via a two-field orderBy in the query)
  // so this never needs a Firestore composite index to be created manually.
  return onSnapshot(
    collection(db, "statements"),
    (snap) => {
      const statements = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Statement, "id">) }));
      statements.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
      cb(statements);
    },
    (err) => {
      console.error("subscribeStatements failed:", err);
    }
  );
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
      const data = d.data() as Omit<Line, "id" | "assets"> & { assets?: Asset[]; asset?: Asset | null };
      // Backward-compat: lines written before multi-justificatif support
      // stored a single "asset" field instead of an "assets" array.
      const assets = data.assets ?? (data.asset ? [data.asset] : []);
      const line = { id: d.id, ...data, assets } as Line;
      (grouped[statementId] ||= []).push(line);
    }
    for (const lines of Object.values(grouped)) {
      lines.sort((a, b) => a.dateRaw.localeCompare(b.dateRaw));
    }
    cb(grouped);
  }, (err) => {
    console.error("subscribeAllLines failed:", err);
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
    // Firestore rejects an explicit `undefined` field value outright, so
    // `importedAt` is only included in the write when it actually has a
    // value (i.e. on first import of this statement) — this used to crash
    // every re-import of an existing statement.
    const statementData: Record<string, unknown> = { label: g.label, year: g.year, month: g.month };
    if (linesSnap.empty) statementData.importedAt = serverTimestamp();
    batch.set(statementRef, statementData, { merge: true });
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
        assets: [],
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
  const paths = lines.flatMap((l) => (l.assets || []).map((a) => a.path));
  if (paths.length) {
    await supabase.storage.from(JUSTIFICATIFS_BUCKET).remove(paths).catch(() => {});
  }
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

/** Adds one more justificatif to a line — several files can cover the same
 *  payment line (e.g. an invoice + a delivery note), so this appends
 *  rather than replaces. */
export async function attachAsset(
  statementId: string,
  lineId: string,
  rawFile: File,
  currentAssets: Asset[]
): Promise<Asset> {
  const file = await maybeDownscaleImage(rawFile);
  const ext = extOf(file.name, file.type);
  const path = `${lineId}/${uid()}.${ext}`;
  const { error } = await supabase.storage
    .from(JUSTIFICATIFS_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw error;
  const asset: Asset = { path, filename: rawFile.name, size: file.size, type: file.type };
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { assets: [...currentAssets, asset] });
  return asset;
}

export async function removeAsset(statementId: string, lineId: string, asset: Asset, currentAssets: Asset[]) {
  await supabase.storage.from(JUSTIFICATIFS_BUCKET).remove([asset.path]).catch(() => {});
  const assets = currentAssets.filter((a) => a.path !== asset.path);
  await updateDoc(doc(db, "statements", statementId, "lines", lineId), { assets });
}

/** Fetches a justificatif's bytes through the Supabase Storage SDK. Note:
 *  unlike the Firebase-only design, access control here relies on the
 *  app's Firebase-Auth login gate plus unguessable (UUID) file paths,
 *  not per-request server-side enforcement — see the README's "Sécurité
 *  du stockage" section for the tradeoff and how to harden it later. */
export async function fetchAssetBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(JUSTIFICATIFS_BUCKET).download(path);
  if (error || !data) throw error || new Error("download failed");
  return data;
}