"""
main.py
-------
FastAPI backend for MissionDoc AI.

This file is the ONLY new piece of backend logic — everything it calls
(ingestion.py, rag_chain.py) is the same RAG pipeline from the original
Streamlit app, completely unchanged. This file's job is purely to expose
that pipeline as HTTP endpoints for the Next.js frontend:

  POST   /api/documents/upload            start ingesting uploaded PDFs (async job)
  GET    /api/documents/upload/{job_id}    poll ingestion progress
  GET    /api/documents                    knowledge base stats
  DELETE /api/documents                    reset knowledge base
  DELETE /api/documents/{filename}         delete a single document
  GET    /api/documents/{filename}/file    fetch the original PDF bytes (for preview)
  POST   /api/chat                         ask a question (single JSON response)
  POST   /api/chat/stream                  ask a question (SSE token stream)
  GET    /api/health                       liveness check

Run locally with:  uvicorn main:app --reload --port 8000
"""

import os
import json
import uuid
import threading

from dotenv import load_dotenv
load_dotenv()  # reads backend/.env if present, before anything touches GEMINI_API_KEY

from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse

import ingestion
import rag_chain
from schemas import (
    ChatRequest, ChatResponse, SourceChunk, Confidence,
    KnowledgeBaseStats, DocumentSummary, ProcessDocumentsResponse,
    ResetResponse, UploadJobStatus,
)


def resolve_api_key(request_key: str | None) -> str | None:
    """
    API key resolution order: explicit key passed in the request (from the
    frontend's Settings page) first, then the server's own GEMINI_API_KEY
    env var as a fallback — mirroring the original Streamlit app's
    "sidebar override, else env var" behavior. Returns None if neither is
    set; downstream Gemini calls will then fail with a clear error rather
    than a confusing one.
    """
    return request_key or os.environ.get("GEMINI_API_KEY")

app = FastAPI(title="MissionDoc AI API", version="1.0.0")

# CORS: allow the Next.js frontend (local dev + deployed Vercel URL) to call
# this API from the browser. Set FRONTEND_ORIGINS as a comma-separated env
# var in production (e.g. "https://missiondoc-ai.vercel.app").
default_origins = "http://localhost:3000,http://127.0.0.1:3000"
allowed_origins = os.environ.get("FRONTEND_ORIGINS", default_origins).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# In-memory job store for async PDF ingestion (progress polling).
# Fine for a single-instance deployment (e.g. one Render service); would
# need Redis or similar if this backend is ever horizontally scaled.
# ---------------------------------------------------------------------------
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


class _InMemoryUploadedFile:
    """
    Minimal adapter so ingestion.process_pdfs (written for Streamlit's
    UploadedFile) works unchanged here. Only needs .name and .getvalue().
    """
    def __init__(self, name: str, data: bytes):
        self.name = name
        self._data = data

    def getvalue(self) -> bytes:
        return self._data


def _update_job(job_id: str, **fields):
    with _jobs_lock:
        _jobs[job_id].update(fields)


def _run_ingestion_job(job_id: str, files: list[_InMemoryUploadedFile], api_key: str | None):
    resolved_key = resolve_api_key(api_key)
    if not resolved_key:
        _update_job(
            job_id, stage="error", progress=0.0,
            message="No Gemini API key configured.",
            error_message=(
                "No Gemini API key found. Set GEMINI_API_KEY in backend/.env, "
                "or add a key in the frontend's Settings page."
            ),
        )
        return

    import google.generativeai as genai
    genai.configure(api_key=resolved_key)

    def progress_callback(message: str, fraction: float | None):
        stage = "embedding" if fraction is not None else "extracting"
        _update_job(
            job_id,
            stage=stage,
            message=message,
            progress=fraction if fraction is not None else 0.0,
        )

    try:
        _update_job(job_id, stage="chunking", message="Starting ingestion...", progress=0.0)
        n_files, n_chunks, warnings = ingestion.process_pdfs(files, progress_callback=progress_callback)
        _update_job(
            job_id,
            stage="ready",
            message=f"Processed {n_files} file(s), {n_chunks} chunks added.",
            progress=1.0,
            result={"files_processed": n_files, "chunks_added": n_chunks, "warnings": warnings},
        )
    except Exception as e:
        _update_job(job_id, stage="error", message=str(e), error_message=str(e), progress=0.0)


@app.post("/api/documents/upload")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    api_key: str | None = None,
):
    """
    Kicks off async ingestion for one or more PDFs and returns a job_id
    immediately. Poll GET /api/documents/upload/{job_id} for progress
    through stages: queued -> extracting -> embedding -> ready | error.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    loaded_files = []
    for f in files:
        data = await f.read()
        loaded_files.append(_InMemoryUploadedFile(f.filename, data))

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "stage": "queued",
            "message": "Queued for processing...",
            "progress": 0.0,
            "result": None,
            "error_message": None,
        }

    background_tasks.add_task(_run_ingestion_job, job_id, loaded_files, api_key)
    return {"job_id": job_id}


@app.get("/api/documents/upload/{job_id}", response_model=UploadJobStatus)
def get_upload_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@app.get("/api/documents", response_model=KnowledgeBaseStats)
def list_documents():
    summary = ingestion.get_ingested_documents_summary()
    documents = [DocumentSummary(filename=name, chunk_count=count) for name, count in summary.items()]
    return KnowledgeBaseStats(
        total_documents=len(documents),
        total_chunks=sum(d.chunk_count for d in documents),
        documents=documents,
    )


@app.delete("/api/documents", response_model=ResetResponse)
def reset_documents():
    ingestion.reset_knowledge_base()
    return ResetResponse(success=True, message="Knowledge base cleared.")


@app.delete("/api/documents/{filename}", response_model=ResetResponse)
def delete_document(filename: str):
    chunks_removed = ingestion.delete_document(filename)
    if chunks_removed == 0:
        raise HTTPException(status_code=404, detail=f"No document named '{filename}' found.")
    return ResetResponse(success=True, message=f"Removed '{filename}' ({chunks_removed} chunks).")


@app.get("/api/documents/{filename}/file")
def get_document_file(filename: str):
    """Serves the original uploaded PDF bytes, e.g. to preview a Knowledge
    Base document in the Workspace's PDF viewer."""
    path = ingestion.get_pdf_file_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail=f"No stored PDF found for '{filename}'.")
    return FileResponse(path, media_type="application/pdf", filename=filename)


def _chunks_to_sources(chunks: list[dict]) -> list[SourceChunk]:
    return [SourceChunk(**c) for c in chunks]


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Non-streaming chat — returns the full answer in one response."""
    resolved_key = resolve_api_key(req.api_key)
    if not resolved_key:
        return ChatResponse(
            status="error", answer=None, sources=[], confidence=None, resolved_question=req.question,
            error_message="No Gemini API key found. Set GEMINI_API_KEY in backend/.env, or add a key in Settings.",
        )

    history = [{"role": m.role, "content": m.content} for m in req.history]
    result = rag_chain.generate_answer(req.question, api_key=resolved_key, chat_history=history)

    confidence = Confidence(**result["confidence"]) if result.get("confidence") else None
    return ChatResponse(
        status=result["status"],
        answer=result.get("answer"),
        sources=_chunks_to_sources(result.get("sources") or []),
        confidence=confidence,
        resolved_question=result.get("resolved_question"),
        error_message=result.get("error_message"),
    )


@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest):
    """
    Streaming chat via Server-Sent Events. Each event is a JSON payload on
    its own "data: ..." line, one of:
      {"type": "meta", status, resolved_question, sources, confidence}
      {"type": "token", "text": "..."}
      {"type": "done"}
      {"type": "error", "message": "..."}
    """
    resolved_key = resolve_api_key(req.api_key)
    history = [{"role": m.role, "content": m.content} for m in req.history]

    def event_source():
        if not resolved_key:
            yield f"data: {json.dumps({'type': 'meta', 'status': 'error', 'resolved_question': req.question, 'sources': [], 'confidence': None})}\n\n"
            yield f"data: {json.dumps({'type': 'error', 'message': 'No Gemini API key found. Set GEMINI_API_KEY in backend/.env, or add a key in Settings.'})}\n\n"
            return
        for event in rag_chain.stream_answer(req.question, api_key=resolved_key, chat_history=history):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_source(), media_type="text/event-stream")


@app.get("/api/health")
def health():
    return {"status": "ok"}