"""
schemas.py
----------
Pydantic models for request/response validation across the FastAPI backend.
Kept separate from main.py so the API contract is easy to scan on its own —
useful when the frontend team (or future you) needs to know exactly what
shape of JSON to expect without reading endpoint logic.
"""

from typing import Optional, Literal
from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    question: str
    api_key: Optional[str] = None
    history: list[ChatMessage] = []


class SourceChunk(BaseModel):
    source: str
    page: int | str
    similarity: float
    text: str


class Confidence(BaseModel):
    label: Literal["High", "Medium", "Low"]
    score: float


class ChatResponse(BaseModel):
    status: Literal["ok", "no_docs", "low_relevance", "error"]
    answer: Optional[str] = None
    sources: list[SourceChunk] = []
    confidence: Optional[Confidence] = None
    resolved_question: Optional[str] = None
    error_message: Optional[str] = None


class DocumentSummary(BaseModel):
    filename: str
    chunk_count: int


class KnowledgeBaseStats(BaseModel):
    total_documents: int
    total_chunks: int
    documents: list[DocumentSummary]


class ProcessDocumentsResponse(BaseModel):
    files_processed: int
    chunks_added: int
    warnings: list[str] = []


class ResetResponse(BaseModel):
    success: bool
    message: str


class UploadJobStatus(BaseModel):
    job_id: str
    stage: Literal[
        "queued", "extracting", "chunking", "embedding", "building", "ready", "error"
    ]
    message: str
    progress: float  # 0.0 - 1.0
    result: Optional[ProcessDocumentsResponse] = None
    error_message: Optional[str] = None
