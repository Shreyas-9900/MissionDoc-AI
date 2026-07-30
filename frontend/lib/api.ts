/**
 * lib/api.ts
 * ----------
 * Typed client for the MissionDoc AI FastAPI backend. Every shape here
 * mirrors backend/schemas.py exactly — if the backend contract changes,
 * update both places together.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SourceChunk {
  source: string;
  page: number | string;
  similarity: number;
  text: string;
}

export interface Confidence {
  label: "High" | "Medium" | "Low";
  score: number;
}

export interface ChatResponse {
  status: "ok" | "no_docs" | "low_relevance" | "error";
  answer: string | null;
  sources: SourceChunk[];
  confidence: Confidence | null;
  resolved_question: string | null;
  error_message: string | null;
}

export interface DocumentSummary {
  filename: string;
  chunk_count: number;
}

export interface KnowledgeBaseStats {
  total_documents: number;
  total_chunks: number;
  documents: DocumentSummary[];
}

export interface UploadJobStatus {
  job_id: string;
  stage: "queued" | "extracting" | "chunking" | "embedding" | "building" | "ready" | "error";
  message: string;
  progress: number;
  result: { files_processed: number; chunks_added: number; warnings: string[] } | null;
  error_message: string | null;
}

export type StreamEvent =
  | { type: "meta"; status: ChatResponse["status"]; resolved_question: string; sources: SourceChunk[]; confidence: Confidence | null }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

async function handleJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getDocuments(): Promise<KnowledgeBaseStats> {
  const res = await fetch(`${API_BASE_URL}/api/documents`);
  return handleJsonResponse<KnowledgeBaseStats>(res);
}

export async function resetDocuments(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/documents`, { method: "DELETE" });
  return handleJsonResponse(res);
}

export async function deleteDocument(filename: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/documents/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res);
}

export function getDocumentFileUrl(filename: string): string {
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(filename)}/file`;
}

/** Fetches a previously-ingested document's original PDF bytes and wraps
 * them as a File object, so it can be dropped straight into <PDFViewer>. */
export async function fetchDocumentAsFile(filename: string): Promise<File> {
  const res = await fetch(getDocumentFileUrl(filename));
  if (!res.ok) {
    throw new Error(`Could not load '${filename}': HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return new File([blob], filename, { type: "application/pdf" });
}

export async function uploadDocuments(
  files: File[],
  apiKey?: string
): Promise<{ job_id: string }> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  const url = new URL(`${API_BASE_URL}/api/documents/upload`);
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url.toString(), { method: "POST", body: formData });
  return handleJsonResponse(res);
}

export async function getUploadStatus(jobId: string): Promise<UploadJobStatus> {
  const res = await fetch(`${API_BASE_URL}/api/documents/upload/${jobId}`);
  return handleJsonResponse<UploadJobStatus>(res);
}

/**
 * Polls an upload job until it reaches "ready" or "error", calling
 * onUpdate after every poll. Returns the final status.
 */
export async function pollUploadJob(
  jobId: string,
  onUpdate: (status: UploadJobStatus) => void,
  intervalMs = 800
): Promise<UploadJobStatus> {
  while (true) {
    const status = await getUploadStatus(jobId);
    onUpdate(status);
    if (status.stage === "ready" || status.stage === "error") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function chat(
  question: string,
  history: ChatMessage[] = [],
  apiKey?: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, api_key: apiKey || null }),
  });
  return handleJsonResponse<ChatResponse>(res);
}

/**
 * Streams a chat answer token-by-token via Server-Sent Events.
 * Calls onEvent for every parsed event (meta / token / done / error).
 * Throws if the network request itself fails; per-event errors come
 * through onEvent as {type: "error"} instead.
 */
export async function streamChat(
  question: string,
  history: ChatMessage[],
  apiKey: string | undefined,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, api_key: apiKey || null }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Stream request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || ""; // last (possibly incomplete) chunk stays in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const event = JSON.parse(jsonStr) as StreamEvent;
        onEvent(event);
      } catch {
        // Skip malformed SSE frames rather than killing the whole stream.
        continue;
      }
    }
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
