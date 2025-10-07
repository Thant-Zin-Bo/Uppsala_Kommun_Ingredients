import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const app = express();
const PORT = 5000;
const CACHE_FILE = path.join(process.cwd(), 'public', 'translation_cache.json');
const USER_MATCHES_FILE = path.join(process.cwd(), 'public', 'user_matches.json');

app.use(cors());
app.use(express.json());

// Load translation cache from file
let translationCache = {};
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    translationCache = JSON.parse(data);
    console.log(`📚 Loaded ${Object.keys(translationCache).length} cached translations`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📝 No translation cache file found, starting fresh');
      translationCache = {};
    } else {
      console.error('Error loading translation cache:', err);
      translationCache = {};
    }
  }
}

// Save translation cache to file
async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(translationCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving translation cache:', err);
  }
}

// Load user matches from file
let userMatches = {};
async function loadUserMatches() {
  try {
    const data = await fs.readFile(USER_MATCHES_FILE, 'utf-8');
    userMatches = JSON.parse(data);
    console.log(`🎯 Loaded ${Object.keys(userMatches).length} user-selected matches`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📝 No user matches file found, starting fresh');
      userMatches = {};
    } else {
      console.error('Error loading user matches:', err);
      userMatches = {};
    }
  }
}

// Save user matches to file
async function saveUserMatches() {
  try {
    await fs.writeFile(USER_MATCHES_FILE, JSON.stringify(userMatches, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving user matches:', err);
  }
}

app.post("/translate", async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  const cacheKey = text.toLowerCase().trim();

  // Check cache first
  if (translationCache[cacheKey]) {
    console.log(`✅ Cache hit for: "${text}" -> "${translationCache[cacheKey].translatedText}"`);
    return res.json(translationCache[cacheKey]);
  }

  console.log(`🔄 Translating: "${text}"`);

  try {
    const response = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        auth_key: process.env.DEEPL_API_KEY,
        text,
        source_lang: "SV", // Swedish source
        target_lang: "EN"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("DeepL API error:", data);
      return res.status(response.status).json({ error: data.message || "Translation failed" });
    }

    const result = {
      translatedText: data.translations[0].text,
      detectedLanguage: data.translations[0].detected_source_language,
      originalText: text
    };

    // Save to cache
    translationCache[cacheKey] = result;
    await saveCache();

    console.log(`✅ Translated & cached: "${text}" -> "${result.translatedText}"`);

    res.json(result);
  } catch (err) {
    console.error("Translation error:", err);
    res.status(500).json({ error: "Translation failed." });
  }
});

// Get all user matches
app.get("/user-matches", (req, res) => {
  res.json(userMatches);
});

// Get user match for a specific ingredient
app.get("/user-matches/:ingredient", (req, res) => {
  const ingredient = decodeURIComponent(req.params.ingredient).toLowerCase().trim();

  if (userMatches[ingredient]) {
    res.json(userMatches[ingredient]);
  } else {
    res.status(404).json({ error: "No match found for this ingredient" });
  }
});

// Save or update user match
app.post("/user-matches", async (req, res) => {
  const { ingredient, selectedMatch } = req.body;

  if (!ingredient || !selectedMatch) {
    return res.status(400).json({ error: "Ingredient and selectedMatch are required" });
  }

  const key = ingredient.toLowerCase().trim();

  userMatches[key] = {
    selectedMatch: {
      ...selectedMatch,
      timestamp: new Date().toISOString(),
      canEdit: true
    }
  };

  await saveUserMatches();

  console.log(`💾 Saved user match: "${ingredient}" → "${selectedMatch.matchedName}"`);

  res.json({ success: true, match: userMatches[key] });
});

// Delete user match (to reset/remove a selection)
app.delete("/user-matches/:ingredient", async (req, res) => {
  const ingredient = decodeURIComponent(req.params.ingredient).toLowerCase().trim();

  if (userMatches[ingredient]) {
    delete userMatches[ingredient];
    await saveUserMatches();
    console.log(`🗑️ Deleted user match for: "${ingredient}"`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "No match found for this ingredient" });
  }
});

app.listen(PORT, async () => {
  await loadCache();
  await loadUserMatches();
  console.log(`🚀 Translation server running at http://localhost:${PORT}`);
});
