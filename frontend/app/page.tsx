"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Satellite, ArrowRight, Upload, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDocuments, checkHealth } from "@/lib/api";

export default function LandingPage() {
  const { data: stats } = useQuery({ queryKey: ["documents"], queryFn: getDocuments });
  const { data: online } = useQuery({
    queryKey: ["health"],
    queryFn: checkHealth,
    refetchInterval: 30_000,
  });

  return (
    <main className="relative">
      <div className="grain-overlay" />

      {/* ---------- Nav ---------- */}
      <nav className="relative z-20 flex items-center justify-between px-6 py-6 md:px-12">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Satellite className="h-4 w-4 text-white" strokeWidth={2.4} />
          </div>
          <span className="font-display text-base font-bold tracking-tight">MissionDoc AI</span>
        </div>
        <div className="hidden items-center gap-8 text-sm text-muted md:flex">
          <Link href="/workspace" className="hover:text-foreground transition-colors">Workspace</Link>
          <Link href="/knowledge-base" className="hover:text-foreground transition-colors">Knowledge Base</Link>
          <Link href="/analytics" className="hover:text-foreground transition-colors">Analytics</Link>
          <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
        </div>
        <Link href="/workspace">
          <Button variant="outline" size="sm">Open Workspace</Button>
        </Link>
      </nav>

      {/* ---------- Hero ---------- */}
      <section className="relative px-6 pb-24 pt-16 md:px-12 md:pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
          {/* LEFT — thesis */}
          <div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-muted"
            >
              RAG for space mission documents
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl"
            >
              Every answer,
              <br />
              traced to its <span className="text-accent">page</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mt-6 max-w-md text-base leading-relaxed text-muted"
            >
              Upload mission reports and launch vehicle manuals. Ask questions in plain
              language. MissionDoc AI answers strictly from what your documents say —
              nothing invented, every claim cited.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link href="/workspace">
                <Button variant="accent" size="lg" className="group">
                  <Upload className="h-4 w-4" />
                  Upload Documents
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <Link href="/workspace">
                <Button variant="outline" size="lg">Open Workspace</Button>
              </Link>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="mt-6 font-mono text-xs text-muted"
            >
              {stats ? `${stats.total_documents} documents · ${stats.total_chunks} chunks indexed` : "—"}
              {" · "}
              <span className={online ? "text-success" : "text-muted"}>
                backend {online === undefined ? "checking..." : online ? "online" : "offline"}
              </span>
            </motion.p>
          </div>

          {/* RIGHT — signature element: a real preview of the product working,
              not decoration. This is the actual thesis: grounded, cited answers. */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="rounded-2xl border border-border bg-surface/80 shadow-2xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  workspace preview
                </span>
              </div>

              <div className="space-y-3 p-5">
                <div className="flex justify-end">
                  <div className="rounded-xl rounded-tr-sm bg-primary px-3.5 py-2 text-xs text-white">
                    What&apos;s the payload capacity of the launch vehicle?
                  </div>
                </div>

                <div className="rounded-xl rounded-tl-sm border border-border bg-background/60 px-3.5 py-2.5 text-xs leading-relaxed text-foreground">
                  The PSLV can carry up to 1,750 kg to a 600&nbsp;km sun-synchronous
                  polar orbit, according to the launch vehicle manual.
                </div>

                <div className="flex items-center gap-1.5 pl-1">
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  <span className="font-mono text-[10px] text-success">High confidence</span>
                </div>

                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-muted" />
                    <span className="truncate font-mono text-[10px] text-muted">
                      PSLV_Launch_Manual.pdf · page 74
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-muted/70">similarity 0.91</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ---------- Recent documents ---------- */}
      <section className="relative px-6 pb-24 md:px-12">
        <div className="mx-auto max-w-6xl">
          {stats && stats.documents.length > 0 ? (
            <Card>
              <CardContent className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-muted">
                    Recent documents
                  </h2>
                  <Link href="/knowledge-base" className="text-xs text-primary hover:underline">
                    View all
                  </Link>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {stats.documents.slice(0, 4).map((doc) => (
                    <div
                      key={doc.filename}
                      className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-4 py-3"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <FileText className="h-4 w-4 shrink-0 text-muted" />
                        <span className="truncate text-sm">{doc.filename}</span>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {doc.chunk_count} chunks
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : stats ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <p className="text-sm text-muted">
                  No documents yet. Upload a mission report to start asking questions.
                </p>
                <Link href="/workspace">
                  <Button variant="outline" size="sm">Go to Workspace</Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="relative border-t border-border px-6 py-10 md:px-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-muted sm:flex-row">
          <span>MissionDoc AI — retrieval-augmented, grounded to your documents.</span>
          <span className="font-mono">Gemini · LangChain · ChromaDB · FastAPI · Next.js</span>
        </div>
      </footer>
    </main>
  );
}
