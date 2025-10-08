"""
AI-Powered Ingredient Search API
Flask server that provides semantic search for ingredients using SentenceTransformers
"""

import os
import json
import unicodedata
import re
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from rapidfuzz import fuzz

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend

# Configuration
MODE = "multivector"  # Use multivector mode for better accuracy
DATA_DIR = os.path.join(os.path.dirname(__file__), "Data")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "indices_v2")
os.makedirs(CACHE_DIR, exist_ok=True)

CARDS_PATH = os.path.join(DATA_DIR, "novel_foods_cards.csv")
MULTIV_PATH = os.path.join(DATA_DIR, "novel_foods_multivectors.csv")
MODEL_NAME = "sentence-transformers/distiluse-base-multilingual-cased-v2"

# Cache paths
EMB_MULTI = os.path.join(CACHE_DIR, "emb_multi.npy")
IDX_MULTI = os.path.join(CACHE_DIR, "index_multi.faiss")
LOOKUP_MULTI = os.path.join(CACHE_DIR, "lookup_multi.csv")
META_MULTI = os.path.join(CACHE_DIR, "meta_multi.json")

# Search parameters
TOP_K_DEFAULT = 10
RECALL_K = 200
ALPHA_SEM = 0.75
MIN_CONFIDENCE = 0.50

SECTION_BOOST = {
    "CANON_LAT": 1.05,
    "CANON_EN": 1.00,
    "SYN_LAT": 0.95,
}

# Global variables to store model and data
model = None
embeddings = None
faiss_index = None
lookup_df = None


def normalize_query_lex(s: str) -> str:
    """Normalize text for lexical matching"""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.casefold())
    s = re.sub(r"[\u2212\u2010-\u2015]", "-", s)
    s = re.sub(r"[^a-z0-9 \-\u00C0-\u017F]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def section_boost(section: str) -> float:
    """Apply boost based on section type"""
    if section in SECTION_BOOST:
        return SECTION_BOOST[section]
    if section.startswith("COMMON_"):
        return 1.00
    return 1.00


def load_multivectors():
    """Load multivector data"""
    mv = pd.read_csv(MULTIV_PATH, dtype={"policy_item_id": str})

    # Load canonical names if available
    if os.path.exists(CARDS_PATH):
        cards = pd.read_csv(CARDS_PATH, dtype={"policy_item_id": str})
        can_map = cards[["policy_item_id", "canonical"]].drop_duplicates()
    else:
        can_map = pd.DataFrame(columns=["policy_item_id", "canonical"])

    lookup = mv.merge(can_map, on="policy_item_id", how="left")
    return mv, lookup


def initialize_model():
    """Initialize the AI model and load/build embeddings"""
    global model, embeddings, faiss_index, lookup_df

    print("🚀 Initializing AI Search Model...")
    print(f"⚙️ Loading model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)

    mv, lookup = load_multivectors()
    texts = mv["text"].astype(str).tolist()

    # Check if we can use cached embeddings
    use_cache = (
        os.path.exists(EMB_MULTI) and
        os.path.exists(LOOKUP_MULTI) and
        os.path.exists(META_MULTI)
    )

    if use_cache:
        try:
            with open(META_MULTI, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if meta.get("row_count") == len(texts) and meta.get("model") == MODEL_NAME:
                print("🔁 Loading cached embeddings...")
                embeddings = np.load(EMB_MULTI)
                lookup_df = pd.read_csv(LOOKUP_MULTI, dtype={"policy_item_id": str})

                if FAISS_AVAILABLE and os.path.exists(IDX_MULTI):
                    faiss_index = faiss.read_index(IDX_MULTI)
                    print("✅ FAISS index loaded.")
                else:
                    print("⚠️ FAISS not available, using cosine similarity.")

                print(f"✅ Model initialized with {len(texts)} embeddings")
                return
        except Exception as e:
            print(f"♻️ Cache error: {e}. Rebuilding...")

    # Build embeddings
    print(f"⚙️ Building embeddings for {len(texts)} texts...")
    embeddings = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)

    # Save cache
    np.save(EMB_MULTI, embeddings)
    lookup.to_csv(LOOKUP_MULTI, index=False)
    with open(META_MULTI, "w", encoding="utf-8") as f:
        json.dump({"model": MODEL_NAME, "row_count": len(texts)}, f)

    if FAISS_AVAILABLE:
        faiss_index = faiss.IndexFlatIP(embeddings.shape[1])
        faiss_index.add(np.array(embeddings, dtype="float32"))
        faiss.write_index(faiss_index, IDX_MULTI)
        print("✅ FAISS index built and saved.")
    else:
        print("⚠️ FAISS not installed, using cosine similarity.")

    lookup_df = lookup
    print(f"✅ Model initialized with {len(texts)} embeddings")


def search_ai(query: str, top_k: int = TOP_K_DEFAULT):
    """Perform AI semantic search"""
    if model is None or embeddings is None or lookup_df is None:
        raise RuntimeError("Model not initialized")

    # Encode query
    q_emb = model.encode([query], normalize_embeddings=True)

    # Get candidates using FAISS or cosine similarity
    if FAISS_AVAILABLE and faiss_index is not None:
        scores, idx = faiss_index.search(
            np.array(q_emb, dtype="float32"),
            min(RECALL_K, len(lookup_df))
        )
        idx, scores = idx[0], scores[0]
    else:
        sims = cosine_similarity(q_emb, embeddings)[0]
        idx = np.argsort(sims)[::-1][:min(RECALL_K, len(lookup_df))]
        scores = sims[idx]

    # Blend semantic and lexical scores
    q_norm = normalize_query_lex(query)
    hits = []

    for i, sem_score in zip(idx, scores):
        row = lookup_df.iloc[i]
        text = str(row.get("text", ""))
        canon = str(row.get("canonical", ""))
        section = str(row.get("section", ""))
        lang = str(row.get("language", ""))

        # Lexical matching
        lex1 = fuzz.token_set_ratio(q_norm, normalize_query_lex(text)) / 100
        lex2 = fuzz.token_set_ratio(q_norm, normalize_query_lex(canon)) / 100 if canon else 0.0
        lex = max(lex1, lex2)

        # Apply section boost
        boosted_sem = float(sem_score) * section_boost(section)
        final_score = ALPHA_SEM * boosted_sem + (1 - ALPHA_SEM) * lex

        hits.append({
            "policy_item_id": str(row["policy_item_id"]),
            "canonical": canon,
            "matched_text": text,
            "section": section,
            "language": lang,
            "semantic_score": round(float(sem_score), 3),
            "lexical_score": round(lex, 3),
            "confidence": round(final_score * 100, 1),  # Convert to percentage
        })

    # Aggregate by entity (keep best per entity)
    best_by_entity = {}
    for h in hits:
        pid = h["policy_item_id"]
        conf_threshold = MIN_CONFIDENCE * 100  # Convert to percentage
        if (pid not in best_by_entity) or (h["confidence"] > best_by_entity[pid]["confidence"]):
            if h["confidence"] >= conf_threshold:
                best_by_entity[pid] = h

    # Sort by confidence
    results = sorted(best_by_entity.values(), key=lambda x: x["confidence"], reverse=True)
    return results[:top_k]


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "faiss_available": FAISS_AVAILABLE
    })


@app.route('/search', methods=['POST'])
def search_endpoint():
    """
    Search for ingredient using AI semantic search

    Request body:
    {
        "query": "vitamin c",
        "top_k": 5  // optional, default 10
    }

    Response:
    {
        "query": "vitamin c",
        "results": [
            {
                "policy_item_id": "123",
                "canonical": "Ascorbic acid",
                "matched_text": "Vitamin C",
                "confidence": 95.5,
                "semantic_score": 0.92,
                "lexical_score": 0.88
            }
        ]
    }
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        top_k = data.get('top_k', TOP_K_DEFAULT)

        if not query:
            return jsonify({"error": "Query parameter is required"}), 400

        results = search_ai(query, top_k)

        return jsonify({
            "query": query,
            "results": results,
            "count": len(results)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    # Initialize model on startup
    initialize_model()

    # Start Flask server
    print("\n🚀 Starting AI Search API Server...")
    print("📍 Server will be available at: http://localhost:5001")
    print("📝 Endpoint: POST /search")
    print("💚 Health check: GET /health\n")

    app.run(host='0.0.0.0', port=5001, debug=False)
