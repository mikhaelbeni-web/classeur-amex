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
        /* thumbnail is a nice-to-have;