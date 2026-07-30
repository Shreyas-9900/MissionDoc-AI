"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Search, Trash2, Upload, Loader2, Database } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDocuments, deleteDocument, resetDocuments, uploadDocuments, pollUploadJob,
  type UploadJobStatus,
} from "@/lib/api";
import { UploadResultSummary } from "@/components/upload-result-summary";

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadJobStatus | null>(null);

  const { data: stats, isLoading } = useQuery({ queryKey: ["documents"], queryFn: getDocuments });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => deleteDocument(filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const resetMutation = useMutation({
    mutationFn: resetDocuments,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const handleUpload = async (files: FileList) => {
    const pdfFiles = Array.from(files).filter((f) => f.type === "application/pdf");
    if (pdfFiles.length === 0) return;

    const apiKey = typeof window !== "undefined" ? localStorage.getItem("missiondoc_api_key") : null;
    setUploadStatus({ job_id: "", stage: "queued", message: "Uploading...", progress: 0, result: null, error_message: null });

    try {
      const { job_id } = await uploadDocuments(pdfFiles, apiKey || undefined);
      const final = await pollUploadJob(job_id, setUploadStatus);
      if (final.stage === "ready") {
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      }
    } catch (e) {
      setUploadStatus({
        job_id: "", stage: "error", progress: 0, result: null,
        message: e instanceof Error ? e.message : "Upload failed",
        error_message: e instanceof Error ? e.message : "Upload failed",
      });
    }
  };

  const filteredDocs = (stats?.documents ?? []).filter((d) =>
    d.filename.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="mx-auto max-w-4xl px-6 pb-24 md:px-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Knowledge Base</h1>
            <p className="mt-1 text-sm text-muted">
              {stats ? `${stats.total_documents} documents · ${stats.total_chunks} chunks indexed` : "Loading..."}
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm("Reset the entire knowledge base? This deletes all documents and cannot be undone.")) {
                  resetMutation.mutate();
                }
              }}
              disabled={resetMutation.isPending || !stats || stats.total_documents === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> Reset all
            </Button>
          </div>
        </div>

        {uploadStatus && uploadStatus.stage !== "ready" && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                {uploadStatus.stage !== "error" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {uploadStatus.message}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((uploadStatus.progress || 0) * 100)}%` }}
                />
              </div>
              {uploadStatus.error_message && (
                <p className="mt-2 text-[11px] text-red-400">{uploadStatus.error_message}</p>
              )}
            </CardContent>
          </Card>
        )}

        {uploadStatus && uploadStatus.stage === "ready" && uploadStatus.result && (
          <div className="mb-6">
            <UploadResultSummary result={uploadStatus.result} />
          </div>
        )}

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading knowledge base...
          </div>
        )}

        {!isLoading && filteredDocs.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-hover">
                <Database className="h-5 w-5 text-muted" />
              </div>
              <p className="text-sm text-muted">
                {search
                  ? `No documents matching "${search}".`
                  : "No documents yet. Upload a mission report to get started."}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {filteredDocs.map((doc) => (
            <Card key={doc.filename}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <Link
                  href={`/workspace?doc=${encodeURIComponent(doc.filename)}`}
                  className="flex min-w-0 flex-1 items-start gap-3 group"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:text-primary transition-colors">
                      {doc.filename}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {doc.chunk_count} chunks · <span className="group-hover:text-primary transition-colors">open in workspace</span>
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${doc.filename}"? This cannot be undone.`)) {
                      deleteMutation.mutate(doc.filename);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label={`Delete ${doc.filename}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
