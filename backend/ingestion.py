"""
ingestion.py
------------
Handles the "load" side of the RAG pipeline:
  1. Extract text from uploaded PDFs (page-by-page, via PyMuPDF)
  2. Chunk the text (LangChain's RecursiveCharacterTextSplitter)
  3. Embed each chunk (Gemini embedding model)
  4. Store chunks + embeddings + metadata in a persistent local ChromaDB collection

Kept separate from rag_chain.py (retrieval/generation) and app.py (UI) so each
file can be explained independently in a demo/viva.
"""

import os
import hashlib
import time
import re
import fitz  # PyMuPDF
import chromadb
from langchain.text_splitter import RecursiveCharacterTextSplitter
import google.generativeai as genai

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHROMA_DB_DIR = "./chroma_db"
COLLECTION_NAME = "satellite_mission_docs"
EMBEDDING_MODEL = "models/gemini-embedding-001"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150

# Where original uploaded PDF bytes are kept so they can be re-served for
# preview later (e.g. selecting a document from the Knowledge Base to view
# it in the Workspace). ChromaDB only stores extracted text + embeddings,
# never the original file, so this is a separate flat-file store.
PDF_STORAGE_DIR = "./uploaded_pdfs"


def get_chroma_client():
    """Return a persistent ChromaDB client stored on local disk."""
    os.makedirs(CHROMA_DB_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=CHROMA_DB_DIR)


def get_or_create_collection():
    """Fetch (or create) the single collection used by this app."""
    client = get_chroma_client()
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    return collection


def reset_knowledge_base():
    """Delete the collection entirely (used by the 'Reset Knowledge Base' button)."""
    client = get_chroma_client()
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        # Collection may not exist yet — that's fine.
        pass

    if os.path.isdir(PDF_STORAGE_DIR):
        for fname in os.listdir(PDF_STORAGE_DIR):
            try:
                os.remove(os.path.join(PDF_STORAGE_DIR, fname))
            except OSError:
                continue


def _safe_pdf_path(filename: str) -> str:
    """
    Resolve a stored-PDF path for a filename, stripping any directory
    components first (os.path.basename) so a crafted filename like
    '../../etc/passwd' can't escape PDF_STORAGE_DIR.
    """
    safe_name = os.path.basename(filename)
    return os.path.join(PDF_STORAGE_DIR, safe_name)


def save_pdf_file(filename: str, file_bytes: bytes) -> None:
    """Persist the original PDF bytes so they can be re-served for preview later."""
    os.makedirs(PDF_STORAGE_DIR, exist_ok=True)
    with open(_safe_pdf_path(filename), "wb") as f:
        f.write(file_bytes)


def get_pdf_file_path(filename: str) -> str | None:
    """Return the on-disk path for a stored PDF, or None if it isn't there."""
    path = _safe_pdf_path(filename)
    return path if os.path.isfile(path) else None


def delete_pdf_file(filename: str) -> None:
    """Remove a stored PDF file, if present. Safe to call even if it's missing."""
    path = _safe_pdf_path(filename)
    if os.path.isfile(path):
        os.remove(path)


def delete_document(filename: str) -> int:
    """
    Deletes all chunks belonging to a single document (matched by its
    original filename, stored as the "source" metadata field on every
    chunk). Returns the number of chunks removed, so the caller can report
    something meaningful even though ChromaDB's delete() itself is silent.
    """
    collection = get_or_create_collection()
    existing = collection.get(where={"source": filename}, include=[])
    ids_to_delete = existing.get("ids", [])
    if not ids_to_delete:
        return 0
    collection.delete(ids=ids_to_delete)
    delete_pdf_file(filename)
    return len(ids_to_delete)


def _file_hash(file_bytes: bytes) -> str:
    """Stable hash used to detect duplicate uploads (same file re-processed twice)."""
    return hashlib.sha256(file_bytes).hexdigest()[:16]


def _extract_pages(file_bytes: bytes, filename: str):
    """
    Extract text from a PDF, page by page, using PyMuPDF.
    Returns a list of dicts: {"text": ..., "page": page_number}
    Skips (rather than crashes on) unreadable/corrupt PDFs.
    """
    pages = []
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        raise ValueError(f"Could not open '{filename}' as a PDF: {e}")

    try:
        for page_num in range(len(doc)):
            try:
                page = doc[page_num]
                text = page.get_text("text")
                if text and text.strip():
                    pages.append({"text": text, "page": page_num + 1})
            except Exception:
                # Skip unreadable individual pages rather than aborting the whole file.
                continue
    finally:
        doc.close()

    return pages


# gemini-embedding-001 does NOT support batching multiple texts into one
# API call — each request can only include a single input text (confirmed
# in Google's own docs). An earlier version of this code tried to batch
# anyway; every batched call silently failed and fell back to one-by-one
# embedding regardless, so real throughput was already 1 call/chunk — it
# was just wasting a failed batch call before every fallback. Removed that
# entirely and replaced it with explicit rate limiting instead, since
# that's the thing actually within our control.
#
# Free-tier embedding quota is commonly ~100 requests/minute. We pace
# calls to stay comfortably under that rather than bursting and hitting
# 429s, and retry with backoff on any 429 that slips through anyway.
EMBED_MIN_INTERVAL_SECONDS = 0.7  # ~85 requests/minute, under the 100/min cap
EMBED_MAX_RETRIES = 3


def _extract_retry_delay_seconds(error_message: str) -> float | None:
    """Parse 'retry_delay { seconds: 50 }' out of a 429 error message, if present."""
    match = re.search(r"seconds:\s*(\d+)", error_message)
    return float(match.group(1)) if match else None


def _embed_texts(texts, task_type="retrieval_document", progress_callback=None):
    """
    Embed a list of strings using the Gemini embedding model, one API call
    per text (gemini-embedding-001 doesn't support batching multiple texts
    into a single request). Calls are paced to stay under the free-tier
    rate limit, and a 429 (quota exceeded) triggers an automatic wait-and-
    retry using the server's own suggested retry_delay when available.

    task_type differs for documents ("retrieval_document") vs queries ("retrieval_query").
    progress_callback(done: int, total: int) is called after each text so
    the UI can show a live progress bar.
    """
    embeddings = []
    total = len(texts)
    last_call_time = 0.0

    for i, text in enumerate(texts):
        # Pace requests so we don't burst past the free-tier rate limit.
        elapsed = time.monotonic() - last_call_time
        if elapsed < EMBED_MIN_INTERVAL_SECONDS:
            time.sleep(EMBED_MIN_INTERVAL_SECONDS - elapsed)

        for attempt in range(EMBED_MAX_RETRIES + 1):
            try:
                result = genai.embed_content(
                    model=EMBEDDING_MODEL,
                    content=text,
                    task_type=task_type,
                )
                embeddings.append(result["embedding"])
                last_call_time = time.monotonic()
                break
            except Exception as e:
                is_rate_limit = "429" in str(e) or "quota" in str(e).lower()
                if is_rate_limit and attempt < EMBED_MAX_RETRIES:
                    wait = _extract_retry_delay_seconds(str(e)) or (5 * (attempt + 1))
                    if progress_callback:
                        progress_callback(i, total)  # keep the UI showing current position
                    time.sleep(wait)
                    continue
                raise

        if progress_callback:
            progress_callback(i + 1, total)

    return embeddings


def get_ingested_documents_summary():
    """
    Returns a dict: {filename: chunk_count} for everything currently in ChromaDB.
    Used by the sidebar to show what's already ingested.
    """
    collection = get_or_create_collection()
    count = collection.count()
    if count == 0:
        return {}

    # Chroma requires a limit; pull metadata only (no embeddings) for all items.
    results = collection.get(include=["metadatas"], limit=count)
    summary = {}
    for meta in results["metadatas"]:
        fname = meta.get("source", "unknown")
        summary[fname] = summary.get(fname, 0) + 1
    return summary


def get_ingested_file_hashes():
    """Return the set of file-hashes already stored, to avoid duplicate ingestion."""
    collection = get_or_create_collection()
    count = collection.count()
    if count == 0:
        return set()
    results = collection.get(include=["metadatas"], limit=count)
    return {meta.get("file_hash") for meta in results["metadatas"] if meta.get("file_hash")}


def process_pdfs(uploaded_files, progress_callback=None):
    """
    Main ingestion entry point, called from app.py's "Process Documents" button.

    uploaded_files: list of Streamlit UploadedFile objects
    progress_callback: optional fn(message: str, fraction: float | None) to
        report status + progress-bar position back to the UI. fraction is
        None for stage-change messages (e.g. "Extracting text...") and a
        0.0-1.0 value while embedding is actively progressing.

    Returns: (num_files_processed, num_chunks_added, warnings: list[str])
    """
    collection = get_or_create_collection()
    existing_hashes = get_ingested_file_hashes()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    files_processed = 0
    chunks_added = 0
    warnings = []

    for uploaded_file in uploaded_files:
        filename = uploaded_file.name
        file_bytes = uploaded_file.getvalue()
        file_hash = _file_hash(file_bytes)

        if file_hash in existing_hashes:
            warnings.append(f"'{filename}' was already ingested — skipped to avoid duplicates.")
            continue

        if progress_callback:
            progress_callback(f"Extracting text from {filename}...", None)

        try:
            pages = _extract_pages(file_bytes, filename)
        except ValueError as e:
            warnings.append(str(e))
            continue

        if not pages:
            warnings.append(f"'{filename}' had no extractable text — skipped.")
            continue

        # Chunk each page separately so we retain accurate page-number metadata.
        chunk_texts = []
        chunk_metadatas = []
        for page_info in pages:
            page_chunks = splitter.split_text(page_info["text"])
            for chunk in page_chunks:
                if not chunk.strip():
                    continue
                chunk_texts.append(chunk)
                chunk_metadatas.append({
                    "source": filename,
                    "page": page_info["page"],
                    "file_hash": file_hash,
                })

        if not chunk_texts:
            warnings.append(f"'{filename}' produced no usable chunks — skipped.")
            continue

        if progress_callback:
            progress_callback(f"Embedding {len(chunk_texts)} chunks from {filename}...", 0.0)

        def _report_embed_progress(done, total, _filename=filename, _total_display=len(chunk_texts)):
            if progress_callback:
                fraction = done / total if total else 0.0
                progress_callback(
                    f"Embedding chunk {done}/{_total_display} from {_filename}...",
                    fraction,
                )

        try:
            embeddings = _embed_texts(
                chunk_texts,
                task_type="retrieval_document",
                progress_callback=_report_embed_progress,
            )
        except Exception as e:
            warnings.append(f"Embedding failed for '{filename}': {e}")
            continue

        ids = [f"{file_hash}_{i}" for i in range(len(chunk_texts))]

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=chunk_texts,
            metadatas=chunk_metadatas,
        )
        save_pdf_file(filename, file_bytes)

        files_processed += 1
        chunks_added += len(chunk_texts)
        existing_hashes.add(file_hash)

    return files_processed, chunks_added, warnings