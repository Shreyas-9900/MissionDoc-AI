"""
rag_chain.py
------------
Handles the "ask" side of the RAG pipeline:
  1. Embed the user's question
  2. Retrieve the top-k most similar chunks from ChromaDB
  3. Build a grounded prompt (context + question)
  4. Call Gemini to generate an answer
  5. Return the answer plus the source chunks used, for citation display

Kept separate from ingestion.py so retrieval/generation logic can be explained
and tested independently.
"""

import google.generativeai as genai
from ingestion import get_or_create_collection, EMBEDDING_MODEL

# Primary model to try first, then fall back through this list in order if
# a model has been deprecated/retired (Google has been rotating these often).
# This makes the app resilient to future model retirements without needing
# a code change every time.
GENERATION_MODEL = "gemini-3.5-flash"
GENERATION_MODEL_FALLBACKS = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
]
TOP_K = 5

# Chunks with a similarity below this are treated as "not relevant enough".
# Chroma returns cosine *distance* (lower = more similar), so we convert to
# a similarity score (1 - distance) and threshold on that.
MIN_SIMILARITY = 0.35

# Confidence tiers shown to the user, based on the best (top) similarity
# score among the retrieved chunks actually used to answer.
CONFIDENCE_HIGH_THRESHOLD = 0.65
CONFIDENCE_MEDIUM_THRESHOLD = 0.50

# How many prior chat turns (user+assistant pairs) to feed into the
# follow-up question resolver. Keeping this small keeps the extra API call
# cheap and avoids dragging in irrelevant older context.
MAX_HISTORY_TURNS = 2

GROUNDING_PROMPT_TEMPLATE = """You are a technical assistant answering questions about space mission documents. Answer the question using ONLY the context provided below. Do not use outside knowledge. If the answer cannot be found in the context, respond exactly with: 'This information is not available in the provided documents.' When you do answer, mention which source document your answer comes from.

Context:
{retrieved_chunks_with_metadata}

Question: {user_question}"""

CONDENSE_QUESTION_PROMPT_TEMPLATE = """Given the conversation history below and a follow-up question, rewrite the follow-up question as a standalone question that includes any context needed to understand it on its own (for example, replace pronouns like "it", "that", or "this" with what they refer to). If the follow-up question is already standalone, return it unchanged. Output ONLY the rewritten question, with no extra commentary.

Conversation history:
{history}

Follow-up question: {question}

Standalone question:"""


def _embed_query(query: str):
    """Embed the user's question using the Gemini embedding model (query mode)."""
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=query,
        task_type="retrieval_query",
    )
    return result["embedding"]


def retrieve_chunks(query: str, top_k: int = TOP_K):
    """
    Query ChromaDB for the top_k most similar chunks to the user's question.

    Returns a list of dicts:
      {"text": ..., "source": ..., "page": ..., "similarity": float}
    Sorted by similarity, most relevant first.
    """
    collection = get_or_create_collection()
    if collection.count() == 0:
        return []

    query_embedding = _embed_query(query)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    chunks = []
    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]
    dists = results.get("distances", [[]])[0]

    for text, meta, dist in zip(docs, metas, dists):
        similarity = 1 - dist  # cosine distance -> similarity
        chunks.append({
            "text": text,
            "source": meta.get("source", "unknown"),
            "page": meta.get("page", "?"),
            "similarity": similarity,
        })

    return chunks


def _format_context(chunks):
    """Turn retrieved chunks into a labeled context block for the prompt."""
    blocks = []
    for i, c in enumerate(chunks, start=1):
        blocks.append(
            f"[Source {i}: {c['source']}, page {c['page']}]\n{c['text']}"
        )
    return "\n\n".join(blocks)


def _generate_with_fallback(prompt: str) -> str:
    """
    Call Gemini with a plain prompt, trying each model in
    GENERATION_MODEL_FALLBACKS in order until one succeeds. Raises the last
    error if every candidate fails. Shared by both the question-condensing
    step and the final answer-generation step.
    """
    last_error = None
    for model_name in GENERATION_MODEL_FALLBACKS:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(prompt)
            return response.text
        except Exception as e:
            last_error = e
            continue
    raise RuntimeError(f"All candidate models failed: {last_error}")


def _format_history(chat_history):
    """
    Turn recent chat messages into a plain-text transcript for the
    condense-question prompt. chat_history is a list of
    {"role": "user"|"assistant", "content": str} dicts, oldest first.
    Only the last MAX_HISTORY_TURNS*2 messages are used.
    """
    if not chat_history:
        return ""
    recent = chat_history[-(MAX_HISTORY_TURNS * 2):]
    lines = []
    for msg in recent:
        speaker = "User" if msg.get("role") == "user" else "Assistant"
        content = (msg.get("content") or "").strip()
        if content:
            lines.append(f"{speaker}: {content}")
    return "\n".join(lines)


def condense_question(user_question: str, chat_history=None) -> str:
    """
    Resolve follow-up questions (e.g. "What did it weigh?") into standalone
    questions (e.g. "What did Chandrayaan-3 weigh?") using recent chat
    history. Falls back to the original question unchanged if there's no
    history yet, or if the resolution call fails for any reason — a failure
    here should never block the user from getting an answer.
    """
    history_text = _format_history(chat_history)
    if not history_text:
        return user_question

    prompt = CONDENSE_QUESTION_PROMPT_TEMPLATE.format(
        history=history_text,
        question=user_question,
    )
    try:
        resolved = _generate_with_fallback(prompt).strip()
        return resolved if resolved else user_question
    except Exception:
        return user_question


def compute_confidence(relevant_chunks):
    """
    Derive a simple High/Medium/Low confidence label from the best
    similarity score among the chunks actually used to answer. This is a
    rough signal, not a calibrated probability — it just tells the user how
    strongly the retrieved context matched their question.
    """
    if not relevant_chunks:
        return {"label": "Low", "score": 0.0}

    top_score = max(c["similarity"] for c in relevant_chunks)
    if top_score >= CONFIDENCE_HIGH_THRESHOLD:
        label = "High"
    elif top_score >= CONFIDENCE_MEDIUM_THRESHOLD:
        label = "Medium"
    else:
        label = "Low"
    return {"label": label, "score": top_score}


def prepare_answer_context(user_question: str, api_key: str = None, chat_history=None):
    """
    Shared setup for both the sync (generate_answer) and streaming
    (stream_answer) paths: resolves follow-ups, retrieves chunks, and builds
    the grounded prompt. Returns a dict describing the outcome so callers
    can short-circuit on no_docs/low_relevance without ever calling Gemini.
    """
    if api_key:
        genai.configure(api_key=api_key)

    resolved_question = condense_question(user_question, chat_history)

    try:
        chunks = retrieve_chunks(resolved_question, top_k=TOP_K)
    except Exception as e:
        return {"status": "error", "error_message": f"Retrieval failed: {e}",
                "resolved_question": resolved_question, "sources": [], "prompt": None}

    if not chunks:
        return {"status": "no_docs", "error_message": None,
                "resolved_question": resolved_question, "sources": [], "prompt": None}

    relevant_chunks = [c for c in chunks if c["similarity"] >= MIN_SIMILARITY]
    if not relevant_chunks:
        return {"status": "low_relevance", "error_message": None,
                "resolved_question": resolved_question, "sources": chunks, "prompt": None}

    context_block = _format_context(relevant_chunks)
    prompt = GROUNDING_PROMPT_TEMPLATE.format(
        retrieved_chunks_with_metadata=context_block,
        user_question=resolved_question,
    )
    return {"status": "ready", "error_message": None,
            "resolved_question": resolved_question, "sources": relevant_chunks, "prompt": prompt}


def stream_answer(user_question: str, api_key: str = None, chat_history=None):
    """
    Generator used by the FastAPI SSE endpoint for real token-by-token
    streaming. Yields dicts of the form:
      {"type": "meta", ...}       — sent once, before any text (sources,
                                     confidence, resolved_question, status)
      {"type": "token", "text": str}  — one per streamed chunk of the answer
      {"type": "done"}                — sent once, after the last token
      {"type": "error", "message": str}

    Model fallback only applies to *starting* the stream — once tokens have
    begun arriving from a model, we commit to that stream rather than
    restarting mid-answer with a different model.
    """
    ctx = prepare_answer_context(user_question, api_key=api_key, chat_history=chat_history)

    if ctx["status"] != "ready":
        yield {
            "type": "meta",
            "status": ctx["status"],
            "resolved_question": ctx["resolved_question"],
            "sources": ctx["sources"],
            "confidence": compute_confidence(ctx["sources"]) if ctx["sources"] else None,
        }
        if ctx["status"] == "error":
            yield {"type": "error", "message": ctx["error_message"]}
        else:
            yield {"type": "done"}
        return

    yield {
        "type": "meta",
        "status": "ok",
        "resolved_question": ctx["resolved_question"],
        "sources": ctx["sources"],
        "confidence": compute_confidence(ctx["sources"]),
    }

    # Everything from here on is wrapped in an outer safety net: no matter
    # what goes wrong (a chunk with no accessible .text, a model producing
    # zero usable output, a totally unexpected exception), the frontend must
    # always eventually receive a "done" or "error" event. Without this, a
    # dropped/odd response leaves the UI stuck showing "..." forever with no
    # way to know anything went wrong.
    try:
        last_error = None
        for model_name in GENERATION_MODEL_FALLBACKS:
            got_any_token = False
            try:
                model = genai.GenerativeModel(model_name)
                stream = model.generate_content(ctx["prompt"], stream=True)
                for chunk in stream:
                    # chunk.text can itself raise (e.g. a chunk with no
                    # accessible text part yet, or a safety-filtered
                    # candidate) — skip that chunk rather than losing the
                    # whole stream over it.
                    try:
                        text = chunk.text
                    except Exception:
                        continue
                    if text:
                        got_any_token = True
                        yield {"type": "token", "text": text}

                if got_any_token:
                    yield {"type": "done"}
                    return
                last_error = f"{model_name} produced no usable output"
            except Exception as e:
                last_error = e
                continue

        yield {"type": "error", "message": f"Gemini streaming failed on all candidate models: {last_error}"}
    except Exception as e:
        # Absolute last resort — should be unreachable given the handling
        # above, but guarantees the frontend is never left hanging.
        yield {"type": "error", "message": f"Unexpected streaming failure: {e}"}


def generate_answer(user_question: str, api_key: str = None, chat_history=None):
    """
    Full RAG call used by app.py's chat loop.

    chat_history: optional list of {"role": "user"|"assistant", "content": str}
        dicts (oldest first) from earlier in the conversation. When provided,
        follow-up questions like "What did it weigh?" are first resolved into
        a standalone question (e.g. "What did Chandrayaan-3 weigh?") before
        retrieval, so pronouns referring to earlier turns still work.

    Returns a dict:
      {
        "answer": str,
        "sources": list[chunk dicts],
        "status": "ok" | "no_docs" | "low_relevance" | "error",
        "error_message": str | None,
        "confidence": {"label": "High"|"Medium"|"Low", "score": float} | None,
        "resolved_question": str,  # same as user_question if no rewrite happened
      }
    """
    if api_key:
        genai.configure(api_key=api_key)

    # --- Step 0: resolve follow-up questions using recent chat history ---
    resolved_question = condense_question(user_question, chat_history)

    # --- Step 1: retrieve (using the resolved, standalone question) ---
    try:
        chunks = retrieve_chunks(resolved_question, top_k=TOP_K)
    except Exception as e:
        return {
            "answer": None,
            "sources": [],
            "status": "error",
            "error_message": f"Retrieval failed: {e}",
            "confidence": None,
            "resolved_question": resolved_question,
        }

    if not chunks:
        return {
            "answer": None,
            "sources": [],
            "status": "no_docs",
            "error_message": None,
            "confidence": None,
            "resolved_question": resolved_question,
        }

    relevant_chunks = [c for c in chunks if c["similarity"] >= MIN_SIMILARITY]
    if not relevant_chunks:
        return {
            "answer": None,
            "sources": chunks,  # still show what was found, even if low relevance
            "status": "low_relevance",
            "error_message": None,
            "confidence": compute_confidence([]),
            "resolved_question": resolved_question,
        }

    # --- Step 2: build grounded prompt (using the resolved question) ---
    context_block = _format_context(relevant_chunks)
    prompt = GROUNDING_PROMPT_TEMPLATE.format(
        retrieved_chunks_with_metadata=context_block,
        user_question=resolved_question,
    )

    # --- Step 3: generate (tries GENERATION_MODEL_FALLBACKS in order; a
    # deprecated/retired model just falls through to the next candidate) ---
    try:
        answer_text = _generate_with_fallback(prompt)
    except Exception as e:
        return {
            "answer": None,
            "sources": relevant_chunks,
            "status": "error",
            "error_message": f"Gemini generation failed on all candidate models: {e}",
            "confidence": compute_confidence(relevant_chunks),
            "resolved_question": resolved_question,
        }

    return {
        "answer": answer_text,
        "sources": relevant_chunks,
        "status": "ok",
        "error_message": None,
        "confidence": compute_confidence(relevant_chunks),
        "resolved_question": resolved_question,
    }