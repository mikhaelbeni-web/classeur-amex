export type LineStatus = "attente" | "recu" | "manquant";

export interface Asset {
  path: string; // Storage path, e.g. "justificatifs/<lineId>/<uuid>.pdf"
  filename: string;
  size: number;
  type: string;
}

export interface Line {
  id: string;
  dateRaw: string; // "DDMMYY" as found in the accounting export
  jal: string;
  piece: string;
  libelle: string;
  reference: string;
  debit: number | null;
  credit: number | null;
  status: LineStatus;
  note: string;
  assets: Asset[]; // several justificatifs can cover one payment line
  createdAt?: unknown; // Firestore server timestamp
}

export interface Statement {
  id: string; // "YYYY-MM"
  label: string;
  year: number;
  month: number;
  importedAt?: unknown; // Firestore server timestamp
}

export interface ParsedLine {
  dateRaw: string;
  jal: string;
  piece: string;
  libelle: string;
  reference: string;
  debit: number | null;
  credit: number | null;
}

export interface ParsedGroup {
  id: string;
  label: string;
  year: number | null;
  month: number | null;
  lines: ParsedLine[];
}