import * as XLSX from "xlsx";
import type { ParsedGroup, ParsedLine } from "./types";

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function normalizeHeader(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface HeaderMap {
  headerRow: number;
  date: number;
  libelle: number;
  jal: number;
  piece: number;
  reference: number;
  debit: number;
  credit: number;
}

function findHeaderMap(rows: unknown[][]): HeaderMap | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    const norm = row.map(normalizeHeader);
    const dateIdx = norm.findIndex((c) => c === "date");
    const libIdx = norm.findIndex((c) => c.indexOf("libell") === 0);
    if (dateIdx !== -1 && libIdx !== -1) {
      return {
        headerRow: r,
        date: dateIdx,
        libelle: libIdx,
        jal: norm.findIndex((c) => c === "jal"),
        piece: norm.findIndex((c) => c.indexOf("piece") === 0),
        reference: norm.findIndex((c) => c.indexOf("reference") === 0),
        debit: norm.findIndex((c) => c.indexOf("debit") === 0),
        credit: norm.findIndex((c) => c.indexOf("credit") === 0),
      };
    }
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

interface DDMMYY {
  day: number;
  month: number;
  year: number;
}

function parseDDMMYY(s: string): DDMMYY | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return { day: +m[1], month: +m[2], year: 2000 + +m[3] };
}

export function fmtEntryDate(raw: string): string {
  const s = String(raw || "").trim();
  const d = parseDDMMYY(s);
  if (!d) return s;
  return (
    String(d.day).padStart(2, "0") +
    "/" +
    String(d.month).padStart(2, "0") +
    "/" +
    String(d.year).slice(2)
  );
}

function monthLabel(year: number, month: number): string {
  return `${MONTHS_FR[month - 1]} ${year}`;
}

export interface ParsedWorkbook {
  sheetName: string;
  lines: ParsedLine[];
}

/**
 * Parses an accounting-style export (columns: Date, Jal., Pièce / Lig.,
 * Libellé, Référence, Débit, Crédit) — the format the accountant sends
 * back after converting the raw Amex PDF statement. Scans every sheet
 * and returns the first one whose header row is recognized.
 */
export function parseWorkbook(workbook: XLSX.WorkBook): ParsedWorkbook | null {
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: "",
    });
    const map = findHeaderMap(rows);
    if (!map) continue;

    const lines: ParsedLine[] = [];
    for (let r = map.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const dateRaw = String(row[map.date] ?? "").trim();
      const libelle = row[map.libelle];
      const debit = map.debit !== -1 ? toNumber(row[map.debit]) : null;
      const credit = map.credit !== -1 ? toNumber(row[map.credit]) : null;
      if (!/^\d{6}$/.test(dateRaw) || (debit === null && credit === null) || !libelle) {
        continue;
      }
      const pieceRaw = map.piece !== -1 ? String(row[map.piece] ?? "") : "";
      lines.push({
        dateRaw,
        jal: map.jal !== -1 ? String(row[map.jal] ?? "").trim() : "",
        piece: pieceRaw.trim(),
        libelle: String(libelle).trim(),
        reference: map.reference !== -1 ? String(row[map.reference] ?? "").trim() : "",
        debit,
        credit,
      });
    }
    if (lines.length) return { sheetName, lines };
  }
  return null;
}

/**
 * Groups flat transaction lines into one statement per calendar month,
 * based on the accounting entry date (column "Date"). A single export
 * file commonly bundles several months at once — this is what lets the
 * app auto-split them, and re-importing later only adds what's new
 * (see dedupe logic in lib/dedupe.ts / the import handler).
 */
export function groupIntoStatements(lines: ParsedLine[]): ParsedGroup[] {
  const groups = new Map<string, { year: number | null; month: number | null; lines: ParsedLine[] }>();
  for (const line of lines) {
    const d = parseDDMMYY(line.dateRaw);
    const key = d ? `${d.year}-${String(d.month).padStart(2, "0")}` : `x-${line.dateRaw}`;
    if (!groups.has(key)) {
      groups.set(key, { year: d ? d.year : null, month: d ? d.month : null, lines: [] });
    }
    groups.get(key)!.lines.push(line);
  }
  const arr: ParsedGroup[] = [...groups.entries()].map(([key, g]) => ({
    id: key,
    label: g.year && g.month ? monthLabel(g.year, g.month) : `Relevé ${key}`,
    year: g.year,
    month: g.month,
    lines: g.lines,
  }));
  arr.sort((a, b) => (b.year ?? 0) * 12 + (b.month ?? 0) - ((a.year ?? 0) * 12 + (a.month ?? 0)));
  return arr;
}

/** Stable fingerprint used to avoid re-adding a line already imported. */
export function lineFingerprint(l: ParsedLine): string {
  if (l.piece) return "p:" + l.piece;
  return ["f", l.dateRaw, l.libelle, l.reference, l.debit, l.credit].join("|");
}
