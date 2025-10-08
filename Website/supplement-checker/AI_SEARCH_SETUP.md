# AI Semantic Search Setup

The website now supports AI-powered semantic search for ingredients using SentenceTransformers! This provides much better matching than traditional fuzzy search.

## How It Works

1. **Tier 1**: Exact match (hash map lookup) - fastest
2. **Tier 2**: User-selected matches from previous searches
3. **Tier 3**: AI Semantic Search using multilingual embeddings (NEW!)
4. **Tier 4**: Falls back to traditional fuzzy search if AI is unavailable

## Setup Instructions

### 1. Install Python Dependencies

```bash
cd AI_Check_Ingredient
pip install -r requirement.txt
```

Required packages:
- flask
- flask-cors
- sentence-transformers
- scikit-learn
- pandas
- numpy
- rapidfuzz
- faiss-cpu (optional but recommended for speed)

### 2. Prepare the Data

The AI model needs preprocessed data files. You should already have:
- `Data/novel_foods_cards.csv`
- `Data/novel_foods_multivectors.csv`

If these don't exist, run the data preprocessing notebook first:
```bash
jupyter notebook notebooks/data_processing.ipynb
```

### 3. Start the AI Search API Server

```bash
cd AI_Check_Ingredient
python api_server.py
```

You should see:
```
🚀 Initializing AI Search Model...
⚙️ Loading model: sentence-transformers/distiluse-base-multilingual-cased-v2
🔁 Loading cached embeddings...
✅ FAISS index loaded.
✅ Model initialized with 1821 embeddings

🚀 Starting AI Search API Server...
📍 Server will be available at: http://localhost:5001
📝 Endpoint: POST /search
💚 Health check: GET /health
```

The first time you run it, it will build embeddings (takes ~1-2 minutes). After that, it loads instantly from cache.

### 4. Start the Website

In a separate terminal:

```bash
cd Website/supplement-checker
npm run dev
```

The website will automatically use AI search when available, and fall back to fuzzy search if the AI API is not running.

## Testing the AI Search

### Test the API Directly

```bash
curl -X POST http://localhost:5001/search \
  -H "Content-Type: application/json" \
  -d '{"query": "vitamin c", "top_k": 5}'
```

### Check Health Status

```bash
curl http://localhost:5001/health
```

### Test Through the Website

1. Start both the AI API server and the website
2. Open http://localhost:5173/Uppsala_Kommun_Ingredients/
3. Enter an ingredient like "Vitamin C" or "Acacia"
4. Check the browser console - you should see: `🤖 AI Search found X matches`

## How AI Search Improves Results

### Traditional Fuzzy Search
- "Vitamin" matches "Vitis vinifera" with 52% confidence ❌
- "ovinu" matches "Curcumin" with 63% confidence ❌

### AI Semantic Search
- "Vitamin" matches "Liposomal vitamin C" with 81% confidence ✅
- "senticosus" matches "Acanthopanax senticosus" with 82% confidence ✅
- Understands multilingual synonyms (English, Swedish, Latin)
- Better handles misspellings and partial matches

## Configuration

Edit `api_server.py` to adjust:

```python
TOP_K_DEFAULT = 10        # Number of results to return
ALPHA_SEM = 0.75          # Weight for semantic vs lexical (0.75 = 75% semantic)
MIN_CONFIDENCE = 0.50     # Minimum confidence threshold (50%)
```

## Model Options

Default model: `distiluse-base-multilingual-cased-v2` (fast, good quality)

For better accuracy (slower):
```python
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
```

If you change the model, delete the cache files in `indices_v2/` and restart the server.

## Troubleshooting

### "AI search API not available"
- Make sure the API server is running on port 5001
- Check for port conflicts

### "Model not initialized"
- Restart the API server
- Check that the data files exist in `AI_Check_Ingredient/Data/`

### Slow first startup
- Normal! Building embeddings takes 1-2 minutes the first time
- Subsequent starts load from cache in seconds

### Low quality matches
- Try adjusting `ALPHA_SEM` (increase for more semantic weight)
- Try adjusting `MIN_CONFIDENCE` threshold
- Consider using the mpnet model for better quality

## Performance

- **First search**: ~100-200ms (with FAISS)
- **Cached embeddings load**: ~1-2 seconds
- **Embedding build**: ~1-2 minutes (one time only)
- **Memory usage**: ~500MB (model + embeddings)

## Running in Production

For production deployment:

1. Use gunicorn instead of Flask dev server:
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5001 api_server:app
```

2. Consider using GPU if available (change `faiss-cpu` to `faiss-gpu`)

3. Set up proper logging and monitoring

4. Cache the embeddings to persistent storage
