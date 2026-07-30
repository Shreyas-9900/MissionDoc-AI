"use client";

import { FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SourceChunk } from "@/lib/api";

function confidenceVariant(similarity: number): "high" | "medium" | "low" {
  if (similarity >= 0.65) return "high";
  if (similarity >= 0.5) return "medium";
  return "low";
}

export function SourceCard({
  source,
  index,
  onOpenPage,
}: {
  source: SourceChunk;
  index: number;
  onOpenPage?: (page: number) => void;
}) {
  const pageNum = typeof source.page === "number" ? source.page : parseInt(String(source.page), 10);
  const canJump = Boolean(onOpenPage) && !Number.isNaN(pageNum);

  return (
    <div className="rounded-xl border border-border bg-surface/50 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] text-primary">
            {index}
          </span>
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="truncate text-xs font-medium text-foreground">{source.source}</span>
        </div>
        <Badge variant={confidenceVariant(source.similarity)}>
          {source.similarity.toFixed(2)}
        </Badge>
      </div>

      <p className="line-clamp-3 text-xs leading-relaxed text-muted">{source.text}</p>

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">Page {source.page}</span>
        {canJump && (
          <button
            onClick={() => onOpenPage!(pageNum)}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Open page <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
