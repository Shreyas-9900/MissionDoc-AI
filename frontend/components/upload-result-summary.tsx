"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";

interface UploadResult {
  files_processed: number;
  chunks_added: number;
  warnings: string[];
}

/**
 * Shows what actually happened after an upload job reaches "ready" — this
 * matters because the backend can return HTTP 200 / stage "ready" while
 * still having processed zero files (e.g. missing API key, embedding
 * failures, duplicate file). Silently hiding that on success would make a
 * real failure look like nothing happened.
 */
export function UploadResultSummary({ result }: { result: UploadResult }) {
  const succeeded = result.files_processed > 0;

  return (
    <div
      className={`w-full rounded-xl border p-4 ${
        succeeded && result.warnings.length === 0
          ? "border-success/30 bg-success/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        {succeeded && result.warnings.length === 0 ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span className="text-success">
              Processed {result.files_processed} file(s) — {result.chunks_added} chunks added.
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-amber-400">
              {succeeded
                ? `Processed ${result.files_processed} file(s), ${result.chunks_added} chunks added — with warnings:`
                : "No files were added. Here's why:"}
            </span>
          </>
        )}
      </div>
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 pl-1">
          {result.warnings.map((w, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-muted">
              • {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
