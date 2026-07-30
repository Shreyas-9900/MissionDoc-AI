"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";

export interface PDFViewerHandle {
  jumpToPage: (page: number) => void;
}

interface RenderedPage {
  pageNum: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface PDFViewerProps {
  file: File | null;
}

// Cap rendering for very large documents so the browser tab doesn't choke —
// most mission reports/manuals are well under this in a demo setting.
const MAX_RENDERED_PAGES = 60;

export const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(function PDFViewer(
  { file },
  ref
) {
  const pageContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    jumpToPage(page: number) {
      const el = pageContainerRefs.current.get(page);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightedPage(page);
      window.setTimeout(() => {
        setHighlightedPage((current) => (current === page ? null : current));
      }, 2200);
    },
  }));

  useEffect(() => {
    if (!file) {
      setPages([]);
      setTotalPages(0);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setTotalPages(pdf.numPages);
        const pageCount = Math.min(pdf.numPages, MAX_RENDERED_PAGES);
        const rendered: RenderedPage[] = [];

        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({
            pageNum,
            dataUrl: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height,
          });
        }

        if (!cancelled) setPages(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to render PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-hover">
          <FileText className="h-5 w-5 text-muted" />
        </div>
        <p className="text-sm text-muted">
          Select a document from the{" "}
          <Link href="/knowledge-base" className="text-primary hover:underline">
            Knowledge Base
          </Link>{" "}
          to preview it here, or upload a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between px-1 text-xs text-muted">
        <span className="truncate font-mono">{file.name}</span>
        {totalPages > 0 && (
          <span className="shrink-0 font-mono">
            {Math.min(totalPages, MAX_RENDERED_PAGES)} / {totalPages} pages
          </span>
        )}
      </div>

      {loading && pages.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Rendering document...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Couldn&apos;t render this PDF: {error}
        </div>
      )}

      <div className="space-y-4">
        {pages.map((p) => (
          <div
            key={p.pageNum}
            ref={(el) => {
              if (el) pageContainerRefs.current.set(p.pageNum, el);
            }}
            className={`relative overflow-hidden rounded-lg border transition-all duration-300 ${
              highlightedPage === p.pageNum
                ? "border-primary shadow-[0_0_0_3px_rgba(99,102,241,0.35)]"
                : "border-border"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.dataUrl} alt={`Page ${p.pageNum}`} className="block w-full" />
            <span className="absolute bottom-2 right-2 rounded-md bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted backdrop-blur">
              Page {p.pageNum}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
