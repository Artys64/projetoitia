import math
import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

PROFILE = "multilingual-e5-small-v1"
MODEL_PATH = os.environ.get("EMBEDDING_MODEL_PATH", "/models/multilingual-e5-small")
MODEL_REVISION = os.environ.get(
    "EMBEDDING_MODEL_REVISION",
    "fd1525a9fd15316a2d503bf26ab031a61d056e98",
)
MAX_TOKENS = 512
DIMENSIONS = 384

model = SentenceTransformer(
    MODEL_PATH,
    revision=MODEL_REVISION,
    local_files_only=True,
    trust_remote_code=False,
)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class EmbedRequest(BaseModel):
    profile: Literal["multilingual-e5-small-v1"]
    kind: Literal["query", "passage"]
    texts: list[str] = Field(min_length=1, max_length=32)


@app.get("/health")
def health():
    probe = model.encode(["query: saúde"], normalize_embeddings=True)
    if probe.shape != (1, DIMENSIONS):
        raise HTTPException(status_code=503, detail="invalid_dimension")
    return {"status": "ok", "profile": PROFILE, "dimensions": DIMENSIONS}


@app.post("/embed")
def embed(request: EmbedRequest):
    prefix = "query: " if request.kind == "query" else "passage: "
    prepared = [prefix + text.strip() for text in request.texts]
    if any(not text.strip() or len(text) > 12_000 for text in request.texts):
        raise HTTPException(status_code=422, detail="invalid_input")
    encoded = model.tokenizer(prepared, add_special_tokens=True, truncation=False)
    token_counts = [len(ids) for ids in encoded["input_ids"]]
    if any(count > MAX_TOKENS for count in token_counts):
        raise HTTPException(status_code=422, detail="input_too_long")
    vectors = model.encode(
        prepared,
        batch_size=min(16, len(prepared)),
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    ).tolist()
    if any(len(item) != DIMENSIONS or any(not math.isfinite(value) for value in item) for item in vectors):
        raise HTTPException(status_code=503, detail="invalid_embedding")
    return {"profile": PROFILE, "vectors": vectors, "tokenCounts": token_counts}
