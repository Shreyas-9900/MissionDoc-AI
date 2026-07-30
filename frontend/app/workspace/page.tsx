"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Satellite, Send, Upload, Loader2, FileUp, Sparkles,
  Settings as SettingsIcon, ArrowLeft,
} from "lucide-react";
import { UploadResultSummary } from "@/components/upload-result-summary";
import { TypingIndicator } from "@/components/typing-indicator";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PDFViewer, type PDFViewerHandle } from "@/components/pdf-viewer";
import { SourceCard } from "@/components/source-card";
import {
  getDocuments, uploadDocuments, pollUploadJob, streamChat, fetchDocumentAsFile,
  type ChatMessage, type SourceChunk, type Confidence, type UploadJobStatus,
} from "@/lib/api";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceChunk[];
  confidence?: Confidence | null;
  resolvedQuestion?: string;
  status?: "ok" | "no_docs" | "low_relevance" | "error";
  streaming?: boolean;
}

const STAGE_LABELS: Record<UploadJobStatus["stage"], string> = {
  queued: "Queued",
  extracting: "Reading PDF & extracting text",
  chunking: "Chunking document",
  embedding: "Building embeddings",
  building: "Building vector database",
  ready: "Ready",
  error: "Error",
};

const STARTER_PROMPTS = [
  "Summarize this document in a few sentences",
  "What are the key figures or numbers mentioned?",
  "List the mission names referenced in this document",
];

const FOLLOWUP_CHIPS = ["Tell me more", "What page is this from?", "Explain that in simpler terms"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const docParam = searchParams.get("doc");

  const queryClient = useQueryClient();
  const pdfViewerRef = useRef<PDFViewerHandle>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingDocFromKB, setLoadingDocFromKB] = useState(false);
  const [docLoadError, setDocLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadJobStatus | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const { data: kbStats } = useQuery({ queryKey: ["documents"], queryFn: getDocuments });

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("missiondoc_api_key") : null;
    if (saved) setApiKey(saved);
  }, []);

  // Load a document selected from the Knowledge Base page (?doc=filename)
  // into the PDF viewer, by fetching its stored bytes from the backend.
  useEffect(() => {
    if (!docParam) return;
    let cancelled = false;
    setLoadingDocFromKB(true);
    setDocLoadError(null);

    fetchDocumentAsFile(docParam)
      .then((file) => {
        if (!cancelled) setSelectedFile(file);
      })
      .catch((e) => {
        if (!cancelled) setDocLoadError(e instanceof Error ? e.message : "Failed to load document");
      })
      .finally(() => {
        if (!cancelled) setLoadingDocFromKB(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docParam]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveApiKey = (val: string) => {
    setApiKey(val);
    try {
      localStorage.setItem("missiondoc_api_key", val);
    } catch {
      // ignore storage failures (private browsing, etc.)
    }
  };

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const pdfFiles = Array.from(files).filter((f) => f.type === "application/pdf");
      if (pdfFiles.length === 0) return;

      setSelectedFile(pdfFiles[0]);
      setIsUploading(true);
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
      } finally {
        setIsUploading(false);
      }
    },
    [apiKey, queryClient]
  );

  const sendMessage = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isSending) return;

      const history: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const userMsg: DisplayMessage = { id: uid(), role: "user", content: trimmed };
      const assistantId = uid();
      const assistantMsg: DisplayMessage = { id: assistantId, role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fields: Partial<DisplayMessage>) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...fields } : m)));
      };

      // Tracks whether the stream ever gave us an explicit "done" or
      // "error" event. If the connection drops (or anything else ends the
      // stream) without one, we must not leave the message stuck showing
      // "..." forever with no way for the user to know something failed.
      let reachedTerminalState = false;

      try {
        await streamChat(trimmed, history, apiKey || undefined, (event) => {
          if (event.type === "meta") {
            if (event.status === "no_docs") {
              reachedTerminalState = true;
              patch({
                content: "There are no documents in the knowledge base yet. Upload a PDF to get started.",
                streaming: false, status: event.status,
              });
            } else if (event.status === "low_relevance") {
              reachedTerminalState = true;
              patch({
                content: "No relevant information found — try rephrasing your question.",
                streaming: false, status: event.status,
                sources: event.sources, confidence: event.confidence ?? undefined,
              });
            } else {
              patch({
                sources: event.sources,
                confidence: event.confidence ?? undefined,
                resolvedQuestion: event.resolved_question,
                status: event.status,
              });
            }
          } else if (event.type === "token") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.text } : m))
            );
          } else if (event.type === "error") {
            reachedTerminalState = true;
            patch({ content: `⚠️ ${event.message}`, streaming: false, status: "error" });
          } else if (event.type === "done") {
            reachedTerminalState = true;
            patch({ streaming: false });
          }
        }, controller.signal);

        if (!reachedTerminalState) {
          patch({
            content: "⚠️ The connection ended unexpectedly before a response was received. Please try again.",
            streaming: false, status: "error",
          });
        }
      } catch (e) {
        patch({
          content: `⚠️ ${e instanceof Error ? e.message : "Something went wrong."}`,
          streaming: false, status: "error",
        });
      } finally {
        setIsSending(false);
      }
    },
    [messages, isSending, apiKey]
  );

  const confidenceVariant = (label: Confidence["label"]) =>
    label === "High" ? "high" : label === "Medium" ? "medium" : "low";

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ---------- Top bar ---------- */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
              <Satellite className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-display text-sm font-semibold">MissionDoc AI</span>
          </div>
          {kbStats && (
            <span className="ml-2 hidden font-mono text-[11px] text-muted sm:inline">
              {kbStats.total_documents} docs · {kbStats.total_chunks} chunks
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            placeholder="Gemini API key (optional)"
            value={apiKey}
            onChange={(e) => saveApiKey(e.target.value)}
            className="hidden w-52 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none md:block"
          />
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      {/* ---------- Split layout ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT — PDF Viewer */}
        <div className="hidden w-[42%] shrink-0 border-r border-border md:block">
          {loadingDocFromKB ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
              <p className="text-sm text-muted">Loading {docParam}...</p>
            </div>
          ) : docLoadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-red-400">Couldn&apos;t load this document.</p>
              <p className="text-xs text-muted">{docLoadError}</p>
            </div>
          ) : (
            <PDFViewer ref={pdfViewerRef} file={selectedFile} />
          )}
        </div>

        {/* RIGHT — Chat */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-6 md:px-8">
            {messages.length === 0 && (
              <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-6 text-center">
                {!kbStats || kbStats.total_documents === 0 ? (
                  <>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragActive(false);
                        handleFiles(e.dataTransfer.files);
                      }}
                      className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 transition-colors ${
                        dragActive ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <FileUp className="h-5 w-5 text-primary" />
                      </div>
                      <p className="text-sm text-foreground">Drag & drop a mission PDF here</p>
                      <p className="text-xs text-muted">or</p>
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-3.5 w-3.5" /> Browse files
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf"
                        multiple
                        className="hidden"
                        onChange={(e) => e.target.files && handleFiles(e.target.files)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-6 w-6 text-accent" />
                    <p className="text-sm text-muted">Ask anything about your ingested documents.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {STARTER_PROMPTS.map((p) => (
                        <button
                          key={p}
                          onClick={() => sendMessage(p)}
                          className="rounded-full border border-border bg-surface/50 px-3 py-1.5 text-xs text-muted transition-colors hover:border-primary hover:text-foreground"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {uploadStatus && uploadStatus.stage !== "ready" && (
                  <div className="w-full rounded-xl border border-border bg-surface/50 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                      {uploadStatus.stage !== "error" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {STAGE_LABELS[uploadStatus.stage]}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.round((uploadStatus.progress || 0) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 truncate text-[11px] text-muted">{uploadStatus.message}</p>
                    {uploadStatus.error_message && (
                      <p className="mt-2 text-[11px] text-red-400">{uploadStatus.error_message}</p>
                    )}
                  </div>
                )}

                {uploadStatus && uploadStatus.stage === "ready" && uploadStatus.result && (
                  <UploadResultSummary result={uploadStatus.result} />
                )}
              </div>
            )}

            <div className="mx-auto max-w-2xl space-y-6">
              {messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={m.role === "user" ? "max-w-[85%]" : "w-full max-w-[85%]"}>
                    {m.role === "assistant" && m.resolvedQuestion && (
                      <p className="mb-1.5 text-[11px] italic text-muted">
                        🔗 Interpreted as: {m.resolvedQuestion}
                      </p>
                    )}

                    <div
                      className={
                        m.role === "user"
                          ? "rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-white"
                          : "rounded-2xl rounded-tl-sm border border-border bg-surface/60 px-4 py-3 text-sm leading-relaxed"
                      }
                    >
                      {m.role === "assistant" ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-pre:bg-background prose-pre:border prose-pre:border-border">
                          {m.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                          ) : m.streaming ? (
                            <TypingIndicator />
                          ) : null}
                          {m.streaming && m.content && (
                            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
                          )}
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>

                    {m.role === "assistant" && m.confidence && (
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={confidenceVariant(m.confidence.label)}>
                          {m.confidence.label} confidence
                        </Badge>
                        <span className="font-mono text-[11px] text-muted">
                          top match {m.confidence.score.toFixed(2)}
                        </span>
                      </div>
                    )}

                    {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {m.sources.slice(0, 4).map((s, i) => (
                          <SourceCard
                            key={i}
                            source={s}
                            index={i + 1}
                            onOpenPage={(page) => pdfViewerRef.current?.jumpToPage(page)}
                          />
                        ))}
                      </div>
                    )}

                    {m.role === "assistant" && !m.streaming && m.content && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {FOLLOWUP_CHIPS.map((chip) => (
                          <button
                            key={chip}
                            onClick={() => sendMessage(chip)}
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-primary hover:text-foreground"
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* ---------- Input bar ---------- */}
          <div className="shrink-0 border-t border-border p-4">
            <div className="mx-auto flex max-w-2xl items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  kbStats && kbStats.total_documents > 0
                    ? "Ask a question about your mission documents..."
                    : "Upload a document first to start chatting..."
                }
                className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
              <Button variant="accent" size="icon" onClick={() => sendMessage(input)} disabled={isSending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}
