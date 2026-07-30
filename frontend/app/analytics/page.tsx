"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, Database, Clock } from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/animated-counter";
import { getDocuments } from "@/lib/api";

export default function AnalyticsPage() {
  const { data: stats, isLoading } = useQuery({ queryKey: ["documents"], queryFn: getDocuments });

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="mx-auto max-w-4xl px-6 pb-24 md:px-12">
        <h1 className="font-display text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 mb-8 text-sm text-muted">
          Knowledge base size right now. Usage metrics below are tracked live in your browser
          session only.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-display text-2xl font-bold">
                  <AnimatedCounter value={stats?.total_documents ?? 0} />
                </div>
                <div className="text-xs text-muted">Documents ingested</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                <Database className="h-5 w-5 text-accent" />
              </div>
              <div>
                <div className="font-display text-2xl font-bold">
                  <AnimatedCounter value={stats?.total_chunks ?? 0} />
                </div>
                <div className="text-xs text-muted">Chunks indexed</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-hover">
              <Clock className="h-5 w-5 text-muted" />
            </div>
            <p className="text-sm font-medium">Questions asked & response time</p>
            <p className="max-w-sm text-xs text-muted">
              Not tracked yet — the backend doesn&apos;t log per-question metrics persistently.
              This would need a small events table (e.g. in the same ChromaDB instance or a
              lightweight SQLite log) to populate real trends here.
            </p>
          </CardContent>
        </Card>

        {!isLoading && stats && stats.documents.length > 0 && (
          <Card className="mt-6">
            <CardContent className="p-6">
              <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-muted">
                Chunks per document
              </h2>
              <div className="space-y-3">
                {stats.documents.map((doc) => {
                  const pct = stats.total_chunks > 0 ? (doc.chunk_count / stats.total_chunks) * 100 : 0;
                  return (
                    <div key={doc.filename}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="truncate text-foreground">{doc.filename}</span>
                        <span className="shrink-0 font-mono text-muted">{doc.chunk_count}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
