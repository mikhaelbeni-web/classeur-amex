import type { ParsedLine } from "./types";

/**
 * Parses the official American Express PDF statement ("Relevé de compte"),
 * as an alternative to the Excel export from the accountant.
 *
 * IMPORTANT — read before touching this file: this PDF has no equivalent
 * of the Excel export's "Pièce" (accounting entry number), which is what
 * the app normally uses to detect "this line was already imported" on a
 * re-import. Lines parsed from a PDF are deduped instead on a composite of
 * date + libellé + montant (see lineFingerprint in xlsxParse.ts) — good
 * enough to avoid re-adding the *same* PDF twice, but it will NOT
 * recognize a transaction as "already there" if that same month was
 * already imported from the Excel file (different fingerprint shape). In
 * short: pick one source per month (Excel OR PDF), not both, or you'll get
 * duplicate lines for that month.
 *
 * The parsing approach: pdf.js gives every piece of text on the page as an
 * item with an (x, y) position — it does NOT hand you rows or columns.
 * Amex's layout uses fixed column bands (verified against a real
 * statement), and each transaction row is reliably introduced by a line
 * starting with a date in the leftmost column ("21 mars", "2 avr", or
 * both dates already merged into one item as "24 mars 24 mars"). We use
 * those as anchors: everything positioned between one date-anchor and the
 * next (a few points of rounding slack aside) belongs to that transaction
 * — including a "CR" tag that Amex renders as its own line just under a
 * credit amount, and an optional "REF NUM: ..." line. A handful of fixed
 * boilerplate phrases (section headers, the foreign-currency conversion
 * note, the page footer) are filtered out by text pattern since they can
 * land inside a column band without belonging to any transaction.
 */

const MONTHS_FR: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1,
  fev: 2, "fév": 2, fevr: 2, "févr": 2, fevrier: 2, "février": 2,
  mar: 3, mars: 3,
  avr: 4, avril: 4,
  mai: 5,
  juin: 6,
  juil: 7, juillet: 7,
  aou: 8, "aoû": 8, aout: 8, "août": 8,
  sep: 9, sept: 9, septembre: 9,
  oct: 10, octobre: 10,
  nov: 11, novembre: 11,
  dec: 12, "déc": 12, decembre: 12, "décembre": 12,
};

function normMonth(s: string): number | null {
  return MONTHS_FR[s.toLowerCase().replace(/\.$/, "")] ?? null;
}

const DATE_ANCHOR_RE = /^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?(?:\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?)?$/;

interface DateAnchor {
  day1: number;
  month1: number;
  day2: number;
  month2: number;
}

function isDateAnchor(text: string): DateAnchor | null {
  const m = DATE_ANCHOR_RE.exec(text.trim());
  if (!m) return null;
  const month1 = normMonth(m[2]);
  if (!month1) return null;
  const day1 = parseInt(m[1], 10);
  let day2 = day1;
  let month2 = month1;
  if (m[3] && m[4]) {
    const m2 = normMonth(m[4]);
    if (m2) {
      day2 = parseInt(m[3], 10);
      month2 = m2;
    }
  }
  return { day1, month1, day2, month2 };
}

// Fixed column bands, verified against a real statement's coordinates.
const DATE_COL: [number, number] = [10, 70];
const DETAILS_COL: [number, number] = [95, 320];
const AMOUNT_COL: [number, number] = [465, 560];

function inRange(x: number, [a, b]: [number, number]): boolean {
  return x >= a && x < b;
}

const FLOOR_MARKERS = [
  /^Total des d[ée]penses pour/i,
  /^Num[ée]ro de compte carte$/i,
  /^American Express Carte\s*-/i,
  /^R\.C\.S\.\s*Nanterre/i,
  /^Etablissement de paiement/i,
];

const DETAILS_SKIP_RE = [/^Op[ée]rations pour/i, /^Carte\s+[x\d-]+$/i, /^Taux de conversion/i];

interface TextItem {
  str: string;
  x: number;
  y: number;
}

interface PdfRow {
  dateRaw: string; // DDMMYY, "date de la transaction"
  libelle: string;
  reference: string;
  debit: number | null;
  credit: number | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parsePageItems(items: TextItem[]): PdfRow[] {
  let endMonth: number | null = null;
  let endYear: number | null = null;
  for (const it of items) {
    const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(it.str.trim());
    if (m) {
      endMonth = parseInt(m[2], 10);
      endYear = 2000 + parseInt(m[3], 10);
      break;
    }
  }

  let floorY = -Infinity;
  for (const it of items) {
    const str = it.str.trim();
    if (FLOOR_MARKERS.some((re) => re.test(str))) {
      floorY = Math.max(floorY, it.y);
    }
  }

  const anchors: (DateAnchor & { y: number })[] = [];
  for (const it of items) {
    if (!inRange(it.x, DATE_COL)) continue;
    if (it.y <= floorY) continue;
    const d = isDateAnchor(it.str);
    if (d) anchors.push({ y: it.y, ...d });
  }
  anchors.sort((a, b) => b.y - a.y);
  const dedup: typeof anchors = [];
  for (const a of anchors) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1].y - a.y) <= 2) continue;
    dedup.push(a);
  }

  const TOL = 3;
  const rows: PdfRow[] = [];

  for (let i = 0; i < dedup.length; i++) {
    const anchor = dedup[i];
    const nextY = i + 1 < dedup.length ? dedup[i + 1].y : floorY;
    const lo = nextY;
    const hi = anchor.y + TOL;

    const detailsParts: TextItem[] = [];
    const amountParts: TextItem[] = [];
    let hasCR = false;
    let ref = "";

    for (const it of items) {
      if (it.y <= lo || it.y > hi) continue;
      const str = it.str.trim();
      if (!str) continue;

      if (inRange(it.x, DETAILS_COL)) {
        const refMatch = /^REF NUM:\s*(\S+)/i.exec(str);
        if (refMatch) {
          ref = refMatch[1];
        } else if (DETAILS_SKIP_RE.some((re) => re.test(str))) {
          // boilerplate / FX note, not part of the merchant name
        } else {
          detailsParts.push(it);
        }
      } else if (inRange(it.x, AMOUNT_COL)) {
        if (str === "CR") {
          hasCR = true;
        } else if (/^[\d\s]+,\d{2}$/.test(str)) {
          amountParts.push(it);
        }
      }
    }

    if (!amountParts.length) continue;

    detailsParts.sort((a, b) => b.y - a.y || a.x - b.x);
    const libelle = detailsParts
      .map((p) => p.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    amountParts.sort((a, b) => b.y - a.y);
    const amount = parseFloat(amountParts[0].str.replace(/\s/g, "").replace(",", "."));
    if (isNaN(amount)) continue;

    if (endMonth == null || endYear == null) continue; // can't date this row reliably
    const year = anchor.month1 <= endMonth ? endYear : endYear - 1;

    rows.push({
      dateRaw: `${pad2(anchor.day1)}${pad2(anchor.month1)}${String(year).slice(2)}`,
      libelle: libelle || "(sans libellé)",
      reference: ref,
      debit: hasCR ? null : amount,
      credit: hasCR ? amount : null,
    });
  }

  return rows;
}

/**
 * Reads an Amex PDF statement (ArrayBuffer) and returns transaction lines
 * in the same shape the Excel importer produces, ready for
 * groupIntoStatements() / the rest of the existing import pipeline.
 */
export async function parseAmexPdf(buffer: ArrayBuffer): Promise<ParsedLine[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const allRows: PdfRow[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.map((it) => {
      // TextItem in pdf.js's types; TextMarkedContent items (no `str`) are
      // filtered out by the `"str" in it` check below.
      const anyIt = it as { str?: string; transform: number[] };
      return { str: anyIt.str ?? "", x: Math.round(anyIt.transform[4]), y: Math.round(anyIt.transform[5]) };
    });
    allRows.push(...parsePageItems(items));
  }

  return allRows.map((r) => ({
    dateRaw: r.dateRaw,
    jal: "",
    piece: "",
    libelle: r.libelle,
    reference: r.reference,
    debit: r.debit,
    credit: r.credit,
  }));
}