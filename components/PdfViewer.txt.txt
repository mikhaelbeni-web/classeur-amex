"use client";

import { useEffect, useRef, useState } from "react";

/** Renders a PDF entirely with pdf.js onto <canvas> elements, instead of
 *  handing the file to the browser's built-in PDF viewer via <iframe>.
 *
 *  Why: an <iframe src="blob:..."> only shows a PDF inline when the browser
 *  has a native PDF viewer AND it's enabled — some browsers don't ship one,
 *  and Chrome itself has a user/IT setting ("Download PDF files instead of
 *  automatically opening them") that disables it, which would silently
 *  force a download instead of a preview. Drawing the pages ourselves with
 *  pdf.js (already a dependency, used for statement parsing) works
 *  identically in every browser, on every PC, with nothing to install. */
export default function PdfViewer({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    setError(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // Slice to a fresh copy: pdf.js may transfer/detach the buffer it's
        // given, and this same ArrayBuffer must stay usable if the effect
        // re-runs (e.g. re-opening the same justificatif).
        const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) return;
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.className = "pdf-page";
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
      } catch (err) {
        console.error("PDF render failed:", err);
        if (!cancelled) setError("Impossible d'afficher ce PDF ici — utilise le bouton Télécharger.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) return <div className="pdf-error">{error}</div>;
  return <div ref={containerRef} className="pdf-pages" />;
}