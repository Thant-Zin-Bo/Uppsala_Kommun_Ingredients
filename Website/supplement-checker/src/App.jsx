import { useState, useEffect, useRef } from 'react';
import './App.css';
import Fuse from 'fuse.js';
import AuthModal from './components/AuthModal';
import ManualLabelModal from './components/ManualLabelModal';
import ManualLabelsDisplay from './components/ManualLabelsDisplay';
import MatchSelector from './components/MatchSelector';
import LavaLampBackground from './components/LavaLampBackground';
import { supabase, getCurrentUser, signOut, getManualLabels } from './supabaseClient';

// Smart normalization helper
const normalizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    // Normalize diacritics (Swedish: å→a, ä→a, ö→o, etc.)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Normalize common variations
    .replace(/\s+/g, ' ')  // Multiple spaces to single space
    .replace(/-/g, ' ')    // Hyphens to spaces for matching
    .replace(/'/g, '')     // Remove apostrophes
    .replace(/,/g, '');    // Remove commas
};

function App() {
  const [novelFoods, setNovelFoods] = useState([]);
  const [pharmaceuticals, setPharmaceuticals] = useState([]);
  const [ingredientsList, setIngredientsList] = useState('');
  const [analyzedIngredients, setAnalyzedIngredients] = useState([]);
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [analysisTime, setAnalysisTime] = useState(null);
  const [novelFoodsMap, setNovelFoodsMap] = useState(null);
  const [pharmaMap, setPharmaMap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const searchCacheRef = useRef(new Map());
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [labelingIngredient, setLabelingIngredient] = useState(null);
  const [editingLabel, setEditingLabel] = useState(null);
  const [manualLabelsCache, setManualLabelsCache] = useState(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ step: '', current: 0, total: 0 });
  const [showMatchSelector, setShowMatchSelector] = useState(false);
  const [matchSelectorData, setMatchSelectorData] = useState(null);

  // Common safe minerals/vitamins that may not be in the pharmaceutical database
  // but are standard approved nutritional ingredients
  const knownSafeMinerals = useRef(new Set([
    'kalcium', 'calcium',
    'magnesium',
    'järn', 'iron', 'jarn',
    'zink', 'zinc',
    'koppar', 'copper',
    'mangan', 'manganese',
    'krom', 'chromium', 'chrome',
    'molybden', 'molybdenum',
    'jod', 'iodine', 'iodid',
    'selen', 'selenium',
    'fosfor', 'phosphorus',
    'kalium', 'potassium',
    'natrium', 'sodium',
    'klor', 'chloride',
    'bor', 'boron'
  ]));

  // Auto-resize textarea
  const handleTextareaChange = (e) => {
    setIngredientsList(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    e.target.style.height = 'auto';
    // Set height to scrollHeight to fit content (with max of 400px)
    const newHeight = Math.min(e.target.scrollHeight, 400);
    e.target.style.height = newHeight + 'px';
    // Show scrollbar only when max height is reached
    e.target.style.overflowY = e.target.scrollHeight > 400 ? 'auto' : 'hidden';
  };

  // Check for user session
  useEffect(() => {
    getCurrentUser().then(user => {
      setUser(user)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => {
      authListener?.subscription?.unsubscribe()
    }
  }, [])

  // Disable body scroll when modal is open
  useEffect(() => {
    if (showHelp || showAuthModal || showLabelModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [showHelp, showAuthModal, showLabelModal])

  // Load manual labels for an ingredient
  const loadManualLabelsForIngredient = async (ingredientName) => {
    const normalizedName = ingredientName.toLowerCase().trim()
    if (manualLabelsCache.has(normalizedName)) {
      return manualLabelsCache.get(normalizedName)
    }

    const labels = await getManualLabels(ingredientName)
    setManualLabelsCache(prev => new Map(prev).set(normalizedName, labels))
    return labels
  }

  // Handle creating a label
  const handleCreateLabel = (ingredient) => {
    if (!user) {
      setShowAuthModal(true)
      return
    }
    setLabelingIngredient(ingredient)
    setEditingLabel(null)
    setShowLabelModal(true)
  }

  // Handle editing a label
  const handleEditLabel = (label, ingredient) => {
    if (!user) {
      setShowAuthModal(true)
      return
    }
    setLabelingIngredient(ingredient)
    setEditingLabel(label)
    setShowLabelModal(true)
  }

  // Refresh a single ingredient's status after label changes
  const refreshIngredientStatus = async (ingredientName) => {
    const normalizedName = ingredientName.toLowerCase().trim()

    // Reload labels for this ingredient
    const labels = await getManualLabels(ingredientName)
    setManualLabelsCache(prev => new Map(prev).set(normalizedName, labels))

    // Update the analyzed ingredients list
    setAnalyzedIngredients(prev => prev.map(ing => {
      if (ing.name.toLowerCase().trim() !== normalizedName) {
        return ing // Keep other ingredients unchanged
      }

      // Recalculate status for this ingredient
      const topLabel = labels.length > 0 ? labels[0] : null
      const hasManualLabel = labels.length > 0

      let status = ing.status
      let statusText = ing.statusText
      let details = ing.details

      if (topLabel) {
        // Community label exists - override automatic results
        status = topLabel.status
        statusText = topLabel.status === 'safe'
          ? 'Approved (Community Override)'
          : topLabel.status === 'danger'
            ? 'Non-Approved (Community Override)'
            : 'Unknown (Community Label)'
        details = {
          source: 'community',
          topLabel,
          databaseMatches: ing.details?.matches || ing.details?.databaseMatches
        }
      } else if (ing.details?.databaseMatches) {
        // No community label anymore - revert to automatic database results
        const allMatches = ing.details.databaseMatches
        const pharmaMatch = allMatches.pharma?.find(m => m.result.item.is_medicine)
        const safePharmaMatch = allMatches.pharma?.find(m => !m.result.item.is_medicine)

        if (pharmaMatch) {
          status = 'danger'
          statusText = 'Non-Approved (Pharmaceutical Medicine)'
          details = { source: 'multiple', matches: allMatches, primaryMatch: pharmaMatch }
        } else if (safePharmaMatch) {
          if (allMatches.novel?.length > 0) {
            const novelStatus = allMatches.novel[0].result.item.novel_food_status
            const isActuallyNovel = novelStatus === 'Novel food'
            const isAuthorized = novelStatus === 'Authorised novel food' ||
                                 novelStatus === 'Not novel in food' ||
                                 novelStatus === 'Not novel in food supplements'

            if (isActuallyNovel) {
              status = 'danger'
              statusText = 'Non-Approved (Novel Food - Requires Authorization)'
            } else if (isAuthorized) {
              status = 'safe'
              statusText = 'Approved'
            } else {
              status = 'unknown'
              statusText = 'Unknown (Novel Food Under Review)'
            }
          } else {
            status = 'safe'
            statusText = 'Approved'
          }
          details = { source: 'multiple', matches: allMatches, primaryMatch: safePharmaMatch }
        } else if (allMatches.novel?.length > 0) {
          const novelStatus = allMatches.novel[0].result.item.novel_food_status
          const isActuallyNovel = novelStatus === 'Novel food'

          if (isActuallyNovel) {
            status = 'danger'
            statusText = 'Non-Approved (Novel Food - Requires Authorization)'
          } else {
            status = 'unknown'
            statusText = 'Unknown (Not in Substance Guide)'
          }
          details = { source: 'multiple', matches: allMatches, primaryMatch: allMatches.novel[0] }
        }
      }

      return {
        ...ing,
        status,
        statusText,
        details,
        hasManualLabel,
        manualLabels: labels,
        topLabel
      }
    }))
  }

  const handleLabelSuccess = async () => {
    // Refresh manual labels for this ingredient without re-analyzing
    if (labelingIngredient) {
      await refreshIngredientStatus(labelingIngredient.name)
    }
  }

  // Handle match selection from MatchSelector
  const handleMatchSelection = async (selectedMatch) => {
    if (matchSelectorData) {
      const { ingredient } = matchSelectorData;

      // Save the user's match selection
      await saveUserMatch(ingredient, selectedMatch);

      // Re-analyze this specific ingredient to update its status
      await refreshIngredientStatus(ingredient);

      // Close the match selector
      setShowMatchSelector(false);
      setMatchSelectorData(null);
    }
  };

  const handleMatchCancel = () => {
    setShowMatchSelector(false);
    setMatchSelectorData(null);
  };

  // Load both datasets
  useEffect(() => {
    const loadData = async () => {
      try {
        const base = import.meta.env.BASE_URL;
        const [novelResponse, pharmaResponse] = await Promise.all([
          fetch(`${base}novel_foods_catalogue.json`),
          fetch(`${base}pharmaceutical_data.json`)
        ]);

        // Check if responses are ok
        if (!novelResponse.ok || !pharmaResponse.ok) {
          throw new Error('Failed to load database files');
        }

        const novelData = await novelResponse.json();
        const pharmaData = await pharmaResponse.json();

        // Validate data structure
        if (!Array.isArray(novelData) || !Array.isArray(pharmaData)) {
          throw new Error('Invalid data format');
        }

        setNovelFoods(novelData);
        setPharmaceuticals(pharmaData);

        // Create hash maps for O(1) exact lookups with smart preprocessing
        const novelMap = new Map();
        novelData.forEach(food => {
          const addToMap = (key, item) => {
            if (!key || typeof key !== 'string') return;
            const normalizedKey = normalizeText(key);
            if (!normalizedKey) return;
            if (!novelMap.has(normalizedKey)) {
              novelMap.set(normalizedKey, []);
            }
            novelMap.get(normalizedKey).push(item);
          };

          // Helper to create and add multiple variants
          const addWithVariants = (text, item) => {
            if (!text || typeof text !== 'string') return;

            // Add original normalized
            addToMap(text, item);

            // Remove language tags like (DE), (EN), (SV), etc.
            const withoutLangTag = text.replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
            if (withoutLangTag !== text) {
              addToMap(withoutLangTag, item);
            }

            // Remove any parentheses content for broader matching
            const withoutParens = text.replace(/\s*\([^)]*\)\s*/g, '').trim();
            if (withoutParens && withoutParens !== text) {
              addToMap(withoutParens, item);
            }
          };

          if (food && food.novel_food_name) {
            addWithVariants(food.novel_food_name, food);
            if (food.common_name) addWithVariants(food.common_name, food);
            if (food.synonyms) addWithVariants(food.synonyms, food);
          }
        });

        const pharmaMapInstance = new Map();
        pharmaData.forEach(pharma => {
          const addToMap = (key, item) => {
            if (!key || typeof key !== 'string') return;
            const normalizedKey = normalizeText(key);
            if (!normalizedKey) return;
            if (!pharmaMapInstance.has(normalizedKey)) {
              pharmaMapInstance.set(normalizedKey, []);
            }
            pharmaMapInstance.get(normalizedKey).push(item);
          };

          // Helper to create and add multiple variants
          const addWithVariants = (text, item) => {
            if (!text || typeof text !== 'string') return;

            // Add original normalized
            addToMap(text, item);

            // Remove language tags
            const withoutLangTag = text.replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
            if (withoutLangTag !== text) {
              addToMap(withoutLangTag, item);
            }

            // Remove any parentheses content
            const withoutParens = text.replace(/\s*\([^)]*\)\s*/g, '').trim();
            if (withoutParens && withoutParens !== text) {
              addToMap(withoutParens, item);
            }
          };

          if (pharma && pharma.name) {
            addWithVariants(pharma.name, pharma);
            if (pharma.synonyms && Array.isArray(pharma.synonyms)) {
              pharma.synonyms.forEach(syn => addWithVariants(syn, pharma));
            }
          }
        });

        setNovelFoodsMap(novelMap);
        setPharmaMap(pharmaMapInstance);
        setLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        setLoadError(error.message || 'Failed to load databases');
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Translate text using DeepL API (server handles caching)
  const translateText = async (text) => {
    try {
      const response = await fetch('http://localhost:5000/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        console.error('Translation failed:', response.statusText);
        return null;
      }

      const data = await response.json();
      return {
        translatedText: data.translatedText,
        originalText: data.originalText,
        detectedLanguage: data.detectedLanguage
      };
    } catch (error) {
      console.error('Translation error:', error);
      return null; // Return null if translation fails
    }
  };

  // Fuzzy search helper using Fuse.js
  const fuzzySearch = (searchTerm, database, databaseType) => {
    const fuseOptions = {
      keys: ['name', 'name_normalized', 'novel_food_name', 'synonyms'],
      threshold: 0.2, // Much stricter: 0.0 = exact match, 1.0 = match anything (was 0.4)
      includeScore: true,
      minMatchCharLength: 4, // Require at least 4 characters to match (was 3)
      ignoreLocation: true,
      distance: 50 // Limit how far apart matches can be
    };

    const fuse = new Fuse(database, fuseOptions);
    const results = fuse.search(searchTerm);

    // Convert Fuse.js results to our format with confidence scores
    // Filter out results below 80% confidence to avoid bad matches
    const MIN_CONFIDENCE = 80;
    return results
      .map(result => ({
        item: result.item,
        score: result.score, // Lower is better in Fuse.js (0 = perfect match)
        confidence: Math.round((1 - result.score) * 100), // Convert to percentage (100% = perfect)
        matchType: 'fuzzy',
        database: databaseType
      }))
      .filter(result => result.confidence >= MIN_CONFIDENCE) // Only keep high-quality matches
      .slice(0, 5);
  };

  // Check for user-selected match
  const checkUserMatch = async (searchTerm) => {
    try {
      const response = await fetch(`http://localhost:5000/user-matches/${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const data = await response.json();
        return data.selectedMatch;
      }
      return null;
    } catch (error) {
      console.error('Error checking user match:', error);
      return null;
    }
  };

  // Save user-selected match
  const saveUserMatch = async (ingredient, selectedMatch) => {
    try {
      const response = await fetch('http://localhost:5000/user-matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient, selectedMatch })
      });

      if (response.ok) {
        console.log(`Saved user match for "${ingredient}"`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving user match:', error);
      return false;
    }
  };

  // Analyze ingredients when user enters them
  const analyzeIngredients = async () => {
    if (ingredientsList.trim() === '') {
      setAnalyzedIngredients([]);
      setAnalysisTime(null);
      setSelectedIngredient(null); // Clear selection when clearing results
      return;
    }

    // Clear selected ingredient when re-analyzing
    setSelectedIngredient(null);
    setAnalyzing(true);
    setAnalysisProgress({ step: 'Preparing analysis...', current: 0, total: 0 });

    const startTime = performance.now();

    // Split by comma, semicolon, or newline, but NOT if inside parentheses
    const ingredients = [];
    let current = '';
    let parenDepth = 0;

    for (let i = 0; i < ingredientsList.length; i++) {
      const char = ingredientsList[i];

      if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        // Prevent negative depth from unmatched parentheses
        if (parenDepth > 0) {
          parenDepth--;
        }
        current += char;
      } else if ((char === ',' || char === ';' || char === '\n') && parenDepth === 0) {
        // Split here only if we're not inside parentheses
        if (current.trim()) {
          ingredients.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    // Add the last ingredient
    if (current.trim()) {
      ingredients.push(current.trim());
    }

    setAnalysisProgress({ step: 'Parsing ingredients...', current: 0, total: ingredients.length });

    const analyzed = await Promise.all(ingredients.map(async (ingredient, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 ANALYZING INGREDIENT [${index + 1}/${ingredients.length}]: "${ingredient}"`);
      console.log(`${'='.repeat(80)}`);

      setAnalysisProgress({ step: 'Analyzing ingredients...', current: index + 1, total: ingredients.length });
      // Parse ingredient to extract main name and parenthetical name
      const match = ingredient.match(/^([^(]+)(?:\(([^)]+)\))?/);
      const mainName = match ? match[1].trim() : ingredient;
      const parentheticalContent = match && match[2] ? match[2].trim() : null;

      console.log(`📝 Parsed: mainName="${mainName}", parenthetical="${parentheticalContent}"`);

      // Translation result - declare at top scope so it's accessible in fuzzy search tier
      let translationResult = null;

      // Build search terms
      const searchTerms = [];

      if (parentheticalContent) {
        // Check if parenthetical content has multiple items separated by commas
        if (parentheticalContent.includes(',')) {
          // Multiple items in parentheses - treat each as a separate search term
          // The text before parentheses is likely descriptive (e.g., "Klumpförebyggande medel")
          const parentheticalItems = parentheticalContent
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0);
          searchTerms.push(...parentheticalItems);
          console.log(`🔢 Multiple items in parentheses, using: [${searchTerms.join(', ')}]`);
        } else {
          // Single item in parentheses - search both main name and parenthetical
          searchTerms.push(mainName);
          searchTerms.push(parentheticalContent);
          console.log(`🔢 Single item in parentheses, searching both: ["${mainName}", "${parentheticalContent}"]`);
        }
      } else {
        // No parentheses - just search the ingredient name
        searchTerms.push(mainName);
        console.log(`🔢 No parentheses, using main name: "${mainName}"`);
      }

      // Collect all matches for both search terms
      const allMatches = {
        novel: [],
        pharma: []
      };

      console.log(`\n🎯 TIER 1: EXACT MATCH (Hash Map Lookup)`);
      searchTerms.forEach(term => {
        // Normalize search term the same way as database entries
        const normalizedTerm = term
          .toLowerCase()
          .trim()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/-/g, ' ')
          .replace(/'/g, '')
          .replace(/,/g, '');

        const cacheKey = normalizedTerm;
        console.log(`  🔎 Searching term: "${term}" (normalized: "${normalizedTerm}")`);

        // Check cache first
        if (searchCacheRef.current.has(cacheKey)) {
          const cached = searchCacheRef.current.get(cacheKey);
          console.log(`  💾 Cache hit!`);
          if (cached.novel) allMatches.novel.push({ term, ...cached.novel });
          if (cached.pharma) allMatches.pharma.push({ term, ...cached.pharma });
          return;
        }

        const cacheEntry = {};

        // First try exact matching using hash map (O(1) lookup)
        const exactNovelMatches = novelFoodsMap ? novelFoodsMap.get(normalizedTerm) : null;
        const exactPharmaMatches = pharmaMap ? pharmaMap.get(normalizedTerm) : null;

        // Check if it's a known safe mineral/vitamin
        const isKnownSafeMineral = knownSafeMinerals.current.has(normalizedTerm);

        // If exact match found, use it
        if (exactNovelMatches && exactNovelMatches.length > 0) {
          const match = {
            result: { item: exactNovelMatches[0], score: 0 },
            matchType: 'exact'
          };
          allMatches.novel.push({ term, ...match });
          cacheEntry.novel = match;
          console.log(`  ✅ Novel Food EXACT match: "${exactNovelMatches[0].novel_food_name}"`);
        }

        if (exactPharmaMatches && exactPharmaMatches.length > 0) {
          const match = {
            result: { item: exactPharmaMatches[0], score: 0 },
            matchType: 'exact'
          };
          allMatches.pharma.push({ term, ...match });
          cacheEntry.pharma = match;
          console.log(`  ✅ Substance Guide EXACT match: "${exactPharmaMatches[0].name}" (is_medicine: ${exactPharmaMatches[0].is_medicine})`);
        } else if (isKnownSafeMineral) {
          // If not in database but is a known safe mineral, add it as safe
          const match = {
            result: {
              item: {
                name: term,
                is_medicine: false,
                comment: 'Standard nutritional mineral/vitamin',
                synonyms: []
              },
              score: 0
            },
            matchType: 'known_safe'
          };
          allMatches.pharma.push({ term, ...match });
          cacheEntry.pharma = match;
          console.log(`  ✅ Known safe mineral/vitamin: "${term}"`);
        }

        if (!exactNovelMatches && !exactPharmaMatches && !isKnownSafeMineral) {
          console.log(`  ❌ No exact match found`);
        }

        // Store in cache with size limit to prevent memory leaks
        const MAX_CACHE_SIZE = 1000;
        if (searchCacheRef.current.size >= MAX_CACHE_SIZE) {
          // Clear oldest entries when cache gets too large
          const firstKey = searchCacheRef.current.keys().next().value;
          searchCacheRef.current.delete(firstKey);
        }
        searchCacheRef.current.set(cacheKey, cacheEntry);
      });

      // Check for manual labels
      const manualLabels = await loadManualLabelsForIngredient(ingredient)
      const topLabel = manualLabels.length > 0 ? manualLabels[0] : null
      const hasManualLabel = manualLabels.length > 0;

      // IMPORTANT: Community labels ALWAYS override automatic results
      // If there's a community label, use it regardless of database matches
      let status = 'unknown';
      let statusText = 'No information';
      let details = null;

      if (topLabel) {
        // Community label exists - use it and override any automatic results
        status = topLabel.status;
        statusText = topLabel.status === 'safe'
          ? 'Approved (Community Override)'
          : topLabel.status === 'danger'
            ? 'Non-Approved (Community Override)'
            : 'Unknown (Community Label)';
        details = {
          source: 'community',
          topLabel,
          databaseMatches: allMatches // Keep database matches for reference
        };
      } else {
        // No community label - use automatic flowchart logic:
        // 1. Check Substance Guide (pharma) - if medicine → NOT APPROVED
        // 2. If Substance Guide OK → Check Novel Food - if found → NOT APPROVED
        // 3. If both OK (pharma approved + no novel food) → APPROVED
        const pharmaMatch = allMatches.pharma.find(m => m.result.item.is_medicine);
        const safePharmaMatch = allMatches.pharma.find(m => !m.result.item.is_medicine);

        // Step 1: Substance Guide Check
        if (pharmaMatch) {
          // Found as pharmaceutical medicine → NOT APPROVED (RED)
          status = 'danger';
          statusText = 'Non-Approved (Pharmaceutical Medicine)';
          details = {
            source: 'multiple',
            matches: allMatches,
            primaryMatch: pharmaMatch
          };
        }
        else if (safePharmaMatch) {
          // Step 2: Found in Substance Guide as safe, now check Novel Food
          if (allMatches.novel.length > 0) {
            // Check the novel food status - not all novel food entries mean "not approved"
            const novelStatus = allMatches.novel[0].result.item.novel_food_status;
            const isActuallyNovel = novelStatus === 'Novel food';
            const needsConsultation = novelStatus === 'Subject to a consultation request';
            const isAuthorized = novelStatus === 'Authorised novel food' ||
                                 novelStatus === 'Not novel in food' ||
                                 novelStatus === 'Not novel in food supplements';

            if (isActuallyNovel) {
              // Truly novel food requiring authorization → NOT APPROVED (RED)
              status = 'danger';
              statusText = 'Non-Approved (Novel Food - Requires Authorization)';
              details = {
                source: 'multiple',
                matches: allMatches,
                primaryMatch: safePharmaMatch
              };
            } else if (isAuthorized) {
              // Authorized or not actually novel → APPROVED (GREEN)
              status = 'safe';
              statusText = 'Approved';
              details = {
                source: 'multiple',
                matches: allMatches,
                primaryMatch: safePharmaMatch
              };
            } else if (needsConsultation || !novelStatus) {
              // Under consultation or unknown status → UNKNOWN
              status = 'unknown';
              statusText = 'Unknown (Novel Food Under Review)';
              details = {
                source: 'multiple',
                matches: allMatches,
                primaryMatch: safePharmaMatch
              };
            }
          } else {
            // Passed both checks → APPROVED (GREEN)
            status = 'safe';
            statusText = 'Approved';
            details = {
              source: 'multiple',
              matches: allMatches,
              primaryMatch: safePharmaMatch
            };
          }
        }
        else if (allMatches.novel.length > 0) {
          // Not in Substance Guide but found in Novel Food
          const novelStatus = allMatches.novel[0].result.item.novel_food_status;
          const isActuallyNovel = novelStatus === 'Novel food';
          const needsConsultation = novelStatus === 'Subject to a consultation request';
          const isAuthorized = novelStatus === 'Authorised novel food' ||
                               novelStatus === 'Not novel in food' ||
                               novelStatus === 'Not novel in food supplements';

          if (isActuallyNovel) {
            // Novel food requiring authorization → NOT APPROVED (RED)
            status = 'danger';
            statusText = 'Non-Approved (Novel Food - Requires Authorization)';
            details = {
              source: 'multiple',
              matches: allMatches,
              primaryMatch: allMatches.novel[0]
            };
          } else if (isAuthorized) {
            // Authorized or not novel → UNKNOWN (not in pharma guide, but novel food says OK)
            status = 'unknown';
            statusText = 'Unknown (Not in Substance Guide)';
            details = {
              source: 'multiple',
              matches: allMatches,
              primaryMatch: allMatches.novel[0]
            };
          } else {
            // Under consultation or unknown
            status = 'unknown';
            statusText = 'Unknown (Novel Food Under Review)';
            details = {
              source: 'multiple',
              matches: allMatches,
              primaryMatch: allMatches.novel[0]
            };
          }
        }
      }

      // If still unknown and no matches, try translating from Swedish to English
      // Only translate the main name (Swedish common name), not the Latin name in parentheses
      if (status === 'unknown' && allMatches.pharma.length === 0 && allMatches.novel.length === 0 && !topLabel) {
        console.log(`\n🌐 TIER 2: TRANSLATION + EXACT MATCH`);
        console.log(`  📝 Translating "${mainName}"...`);

        setAnalysisProgress({
          step: `Translating "${mainName}"...`,
          current: index + 1,
          total: ingredients.length
        });

        translationResult = await translateText(mainName);

        if (translationResult && translationResult.translatedText.toLowerCase() !== ingredient.toLowerCase()) {
          console.log(`  ✅ Translated: "${mainName}" → "${translationResult.translatedText}"`);
          console.log(`  🔎 Searching databases with translated term...`);
          // Search again with translated term
          const translatedNormalized = normalizeText(translationResult.translatedText);
          const translatedCacheKey = translatedNormalized;

          // Check cache first for translated term
          let translatedCacheEntry = searchCacheRef.current.get(translatedCacheKey);

          if (!translatedCacheEntry) {
            translatedCacheEntry = {};

            // Search databases with translated term using hash maps (same as original logic)
            const exactNovelMatchesTranslated = novelFoodsMap ? novelFoodsMap.get(translatedNormalized) : null;
            const exactPharmaMatchesTranslated = pharmaMap ? pharmaMap.get(translatedNormalized) : null;

            // Check if translated term is a known safe mineral
            const isKnownSafeMineralTranslated = knownSafeMinerals.current.has(translatedNormalized);

            if (exactNovelMatchesTranslated && exactNovelMatchesTranslated.length > 0) {
              const match = {
                result: { item: exactNovelMatchesTranslated[0], score: 0 },
                matchType: 'exact',
                translatedFrom: ingredient,
                translatedTo: translationResult.translatedText
              };
              allMatches.novel.push({ term: translationResult.translatedText, ...match });
              translatedCacheEntry.novel = match;
              console.log(`  ✅ Novel Food match found: "${exactNovelMatchesTranslated[0].novel_food_name}"`);
            }

            if (exactPharmaMatchesTranslated && exactPharmaMatchesTranslated.length > 0) {
              const match = {
                result: { item: exactPharmaMatchesTranslated[0], score: 0 },
                matchType: 'exact',
                translatedFrom: ingredient,
                translatedTo: translationResult.translatedText
              };
              allMatches.pharma.push({ term: translationResult.translatedText, ...match });
              translatedCacheEntry.pharma = match;
              console.log(`  ✅ Substance Guide match found: "${exactPharmaMatchesTranslated[0].name}" (is_medicine: ${exactPharmaMatchesTranslated[0].is_medicine})`);
            } else if (isKnownSafeMineralTranslated) {
              const match = {
                result: {
                  item: {
                    name: translationResult.translatedText,
                    is_medicine: false,
                    comment: 'Standard nutritional mineral/vitamin',
                    synonyms: []
                  },
                  score: 0
                },
                matchType: 'known_safe',
                translatedFrom: ingredient,
                translatedTo: translationResult.translatedText
              };
              allMatches.pharma.push({ term: translationResult.translatedText, ...match });
              translatedCacheEntry.pharma = match;
              console.log(`  ✅ Known safe mineral/vitamin: "${translationResult.translatedText}"`);
            }

            if (!exactNovelMatchesTranslated && !exactPharmaMatchesTranslated && !isKnownSafeMineralTranslated) {
              console.log(`  ❌ No match found with translated term`);
            }

            searchCacheRef.current.set(translatedCacheKey, translatedCacheEntry);
          } else {
            // Use cached results but mark as translated
            if (translatedCacheEntry.novel) {
              allMatches.novel.push({
                term: translationResult.translatedText,
                ...translatedCacheEntry.novel,
                translatedFrom: ingredient,
                translatedTo: translationResult.translatedText
              });
            }
            if (translatedCacheEntry.pharma) {
              allMatches.pharma.push({
                term: translationResult.translatedText,
                ...translatedCacheEntry.pharma,
                translatedFrom: ingredient,
                translatedTo: translationResult.translatedText
              });
            }
          }

          // Re-evaluate status with translated matches
          if (allMatches.pharma.length > 0 || allMatches.novel.length > 0) {
            const pharmaMatch = allMatches.pharma.find(m => m.result.item.is_medicine);
            const safePharmaMatch = allMatches.pharma.find(m => !m.result.item.is_medicine);

            if (pharmaMatch) {
              status = 'danger';
              statusText = `Non-Approved (Pharmaceutical Medicine) - Translated from "${ingredient}"`;
              details = {
                source: 'multiple',
                matches: allMatches,
                primaryMatch: pharmaMatch,
                wasTranslated: true,
                originalTerm: ingredient,
                translatedTerm: translationResult.translatedText
              };
            } else if (safePharmaMatch) {
              if (allMatches.novel.length > 0) {
                const novelStatus = allMatches.novel[0].result.item.novel_food_status;
                const isActuallyNovel = novelStatus === 'Novel food';
                const isAuthorized = novelStatus === 'Authorised novel food' ||
                                     novelStatus === 'Not novel in food' ||
                                     novelStatus === 'Not novel in food supplements';

                if (isActuallyNovel) {
                  status = 'danger';
                  statusText = `Non-Approved (Novel Food) - Translated from "${ingredient}"`;
                  details = {
                    source: 'multiple',
                    matches: allMatches,
                    primaryMatch: safePharmaMatch,
                    wasTranslated: true,
                    originalTerm: ingredient,
                    translatedTerm: translationResult.translatedText
                  };
                } else if (isAuthorized) {
                  status = 'safe';
                  statusText = `Approved - Translated from "${ingredient}"`;
                  details = {
                    source: 'multiple',
                    matches: allMatches,
                    primaryMatch: safePharmaMatch,
                    wasTranslated: true,
                    originalTerm: ingredient,
                    translatedTerm: translationResult.translatedText
                  };
                } else {
                  status = 'unknown';
                  statusText = `Unknown (Novel Food Under Review) - Translated from "${ingredient}"`;
                  details = {
                    source: 'multiple',
                    matches: allMatches,
                    primaryMatch: safePharmaMatch,
                    wasTranslated: true,
                    originalTerm: ingredient,
                    translatedTerm: translationResult.translatedText
                  };
                }
              } else {
                status = 'safe';
                statusText = `Approved - Translated from "${ingredient}"`;
                details = {
                  source: 'multiple',
                  matches: allMatches,
                  primaryMatch: safePharmaMatch,
                  wasTranslated: true,
                  originalTerm: ingredient,
                  translatedTerm: translationResult.translatedText
                };
              }
            } else if (allMatches.novel.length > 0) {
              const novelStatus = allMatches.novel[0].result.item.novel_food_status;
              const isActuallyNovel = novelStatus === 'Novel food';
              const isAuthorized = novelStatus === 'Authorised novel food' ||
                                   novelStatus === 'Not novel in food' ||
                                   novelStatus === 'Not novel in food supplements';

              if (isActuallyNovel) {
                status = 'danger';
                statusText = `Non-Approved (Novel Food) - Translated from "${ingredient}"`;
                details = {
                  source: 'multiple',
                  matches: allMatches,
                  primaryMatch: allMatches.novel[0],
                  wasTranslated: true,
                  originalTerm: ingredient,
                  translatedTerm: translationResult.translatedText
                };
              } else {
                status = 'unknown';
                statusText = `Unknown (Not in Substance Guide) - Translated from "${ingredient}"`;
                details = {
                  source: 'multiple',
                  matches: allMatches,
                  primaryMatch: allMatches.novel[0],
                  wasTranslated: true,
                  originalTerm: ingredient,
                  translatedTerm: translationResult.translatedText
                };
              }
            }
          } else {
            // Translation succeeded but no NEW matches found
            // Check if we already had matches from other search terms (e.g., Latin name)
            if (allMatches.pharma.length > 0 || allMatches.novel.length > 0) {
              // We already have matches, just add translation info to existing details
              if (details && details.source === 'multiple') {
                details.translationAttempted = true;
                details.translatedTerm = translationResult.translatedText;
              }
            } else {
              // No matches at all - show translation attempt
              statusText = `No information (Tried translating to "${translationResult.translatedText}")`;
              details = {
                source: 'multiple',
                matches: allMatches,
                wasTranslated: true,
                originalTerm: ingredient,
                translatedTerm: translationResult.translatedText,
                noMatchesFound: true
              };
            }
          }
        }
      }

      // TIER 3 & 4: Fuzzy search as last resort (after exact match and translation failed)
      if (status === 'unknown' && allMatches.pharma.length === 0 && allMatches.novel.length === 0 && !topLabel) {
        setAnalysisProgress({
          step: `Fuzzy searching "${ingredient}"...`,
          current: index + 1,
          total: ingredients.length
        });

        // First check if user has previously selected a match for this ingredient
        const userMatch = await checkUserMatch(ingredient);

        if (userMatch) {
          // Use the user-selected match
          const matchedItem = userMatch.database === 'novel_food'
            ? novelFoods.find(item => item.policy_item_code === userMatch.policy_item_code)
            : pharmaceuticals.find(item => item.name === userMatch.matchedName);

          if (matchedItem) {
            const isNovel = userMatch.database === 'novel_food';
            const match = {
              result: { item: matchedItem, score: 0 },
              matchType: 'user_selected',
              confidence: 100,
              database: userMatch.database
            };

            if (isNovel) {
              allMatches.novel.push({ term: ingredient, ...match });
            } else {
              allMatches.pharma.push({ term: ingredient, ...match });
            }

            // Re-evaluate status with user match
            if (isNovel) {
              const novelStatus = matchedItem.novel_food_status;
              const isActuallyNovel = novelStatus === 'Novel food';
              const isAuthorized = novelStatus === 'Authorised novel food' ||
                                   novelStatus === 'Not novel in food' ||
                                   novelStatus === 'Not novel in food supplements';

              if (isActuallyNovel) {
                status = 'danger';
                statusText = 'Non-Approved (Novel Food) - User Match';
              } else if (isAuthorized) {
                status = 'safe';
                statusText = 'Approved - User Match';
              } else {
                status = 'unknown';
                statusText = 'Unknown (Novel Food Under Review) - User Match';
              }
            } else {
              if (matchedItem.is_medicine) {
                status = 'danger';
                statusText = 'Non-Approved (Pharmaceutical Medicine) - User Match';
              } else {
                status = 'safe';
                statusText = 'Approved - User Match';
              }
            }

            details = {
              source: 'user_match',
              matches: allMatches,
              userMatch: userMatch,
              primaryMatch: match
            };
          }
        } else {
          // No user match - perform fuzzy search
          console.log(`\n🔮 TIER 3 & 4: FUZZY SEARCH`);
          const fuzzyMatches = [];

          // Tier 3: Fuzzy search on original terms
          console.log(`  🔎 Tier 3: Fuzzy searching original terms...`);
          searchTerms.forEach(term => {
            console.log(`    Searching: "${term}"`);
            const pharmaFuzzy = fuzzySearch(term, pharmaceuticals, 'pharma');
            const novelFuzzy = fuzzySearch(term, novelFoods, 'novel_food');

            if (pharmaFuzzy.length > 0) {
              console.log(`      Found ${pharmaFuzzy.length} pharma fuzzy matches (best: ${pharmaFuzzy[0].confidence}%)`);
            }
            if (novelFuzzy.length > 0) {
              console.log(`      Found ${novelFuzzy.length} novel food fuzzy matches (best: ${novelFuzzy[0].confidence}%)`);
            }

            pharmaFuzzy.forEach(match => fuzzyMatches.push({ term, ...match, searchedTerm: term, wasTranslated: false }));
            novelFuzzy.forEach(match => fuzzyMatches.push({ term, ...match, searchedTerm: term, wasTranslated: false }));
          });

          // Tier 4: Fuzzy search on translated term (if we translated earlier)
          if (translationResult && translationResult.translatedText) {
            console.log(`  🔎 Tier 4: Fuzzy searching translated term "${translationResult.translatedText}"...`);
            const pharmaFuzzyTranslated = fuzzySearch(translationResult.translatedText, pharmaceuticals, 'pharma');
            const novelFuzzyTranslated = fuzzySearch(translationResult.translatedText, novelFoods, 'novel_food');

            if (pharmaFuzzyTranslated.length > 0) {
              console.log(`    Found ${pharmaFuzzyTranslated.length} pharma fuzzy matches (best: ${pharmaFuzzyTranslated[0].confidence}%)`);
            }
            if (novelFuzzyTranslated.length > 0) {
              console.log(`    Found ${novelFuzzyTranslated.length} novel food fuzzy matches (best: ${novelFuzzyTranslated[0].confidence}%)`);
            }

            pharmaFuzzyTranslated.forEach(match => fuzzyMatches.push({
              term: translationResult.translatedText,
              ...match,
              searchedTerm: translationResult.translatedText,
              wasTranslated: true,
              translatedFrom: mainName
            }));
            novelFuzzyTranslated.forEach(match => fuzzyMatches.push({
              term: translationResult.translatedText,
              ...match,
              searchedTerm: translationResult.translatedText,
              wasTranslated: true,
              translatedFrom: mainName
            }));
          }

          // Sort by confidence (highest first) and remove duplicates
          fuzzyMatches.sort((a, b) => b.confidence - a.confidence);
          const uniqueMatches = [];
          const seen = new Set();

          for (const match of fuzzyMatches) {
            const key = match.database === 'novel_food'
              ? match.item.policy_item_code
              : match.item.name;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueMatches.push(match);
            }
          }

          if (uniqueMatches.length > 0) {
            const topMatch = uniqueMatches[0];
            console.log(`\n  📊 Fuzzy Match Results:`);
            console.log(`    Total unique matches: ${uniqueMatches.length}`);
            console.log(`    Top match: "${topMatch.database === 'novel_food' ? topMatch.item.novel_food_name : topMatch.item.name}"`);
            console.log(`    Confidence: ${topMatch.confidence}%`);
            console.log(`    Database: ${topMatch.database}`);

            // Auto-accept if confidence >= 90%
            if (topMatch.confidence >= 90) {
              console.log(`  ✅ AUTO-ACCEPTING (confidence >= 90%)`);
              const match = {
                result: { item: topMatch.item, score: topMatch.score },
                matchType: 'fuzzy_auto',
                confidence: topMatch.confidence,
                database: topMatch.database
              };

              if (topMatch.database === 'novel_food') {
                allMatches.novel.push({ term: topMatch.searchedTerm, ...match });

                const novelStatus = topMatch.item.novel_food_status;
                const isActuallyNovel = novelStatus === 'Novel food';
                const isAuthorized = novelStatus === 'Authorised novel food' ||
                                     novelStatus === 'Not novel in food' ||
                                     novelStatus === 'Not novel in food supplements';

                if (isActuallyNovel) {
                  status = 'danger';
                  statusText = `Non-Approved (Novel Food) - ${topMatch.confidence}% fuzzy match`;
                } else if (isAuthorized) {
                  status = 'safe';
                  statusText = `Approved - ${topMatch.confidence}% fuzzy match`;
                } else {
                  status = 'unknown';
                  statusText = `Unknown - ${topMatch.confidence}% fuzzy match`;
                }
              } else {
                allMatches.pharma.push({ term: topMatch.searchedTerm, ...match });

                if (topMatch.item.is_medicine) {
                  status = 'danger';
                  statusText = `Non-Approved (Pharmaceutical) - ${topMatch.confidence}% fuzzy match`;
                } else {
                  status = 'safe';
                  statusText = `Approved - ${topMatch.confidence}% fuzzy match`;
                }
              }

              details = {
                source: 'fuzzy_auto',
                matches: allMatches,
                primaryMatch: match,
                fuzzyMatches: uniqueMatches.slice(0, 5)
              };
            } else {
              // Confidence < 90% - show matches for user selection
              console.log(`  ⚠️ REQUIRES USER SELECTION (confidence < 90%)`);
              console.log(`    Showing ${Math.min(uniqueMatches.length, 5)} matches for user to choose from`);
              status = 'unknown';
              statusText = 'Fuzzy matches found - Select correct match';
              details = {
                source: 'fuzzy_manual',
                fuzzyMatches: uniqueMatches.slice(0, 5),
                requiresUserSelection: true
              };
            }
          } else {
            console.log(`  ❌ No fuzzy matches found`);
          }
        }
      }

      // Ensure all ingredients have source: 'multiple' for consistent display
      if (!details || !details.source) {
        details = {
          source: 'multiple',
          matches: allMatches
        };
      }

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`✨ FINAL RESULT: ${status.toUpperCase()}`);
      console.log(`   Status Text: ${statusText}`);
      console.log(`   Has Manual Label: ${hasManualLabel}`);
      if (details?.source) {
        console.log(`   Data Source: ${details.source}`);
      }
      console.log(`${'='.repeat(80)}\n`);

      return {
        name: ingredient,
        status,
        statusText,
        details,
        hasManualLabel,
        manualLabels,
        topLabel
      };
    }));

    setAnalysisProgress({ step: 'Finalizing results...', current: ingredients.length, total: ingredients.length });

    const endTime = performance.now();
    const timeTaken = ((endTime - startTime) / 1000).toFixed(3); // Convert to seconds

    setAnalyzedIngredients(analyzed);
    setAnalysisTime(timeTaken);
    setAnalyzing(false);
  };

  // Safely strip HTML tags without using innerHTML (prevents XSS)
  const stripHtml = (html) => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  };

  return (
    <div className="app-container">
      <LavaLampBackground />
      <div className="max-width">
        {/* Header and Input Combined */}
        <div className="card header-input-combined">
          <div className="header-content">
            <div>
              <h1>Ingredient Safety Checker</h1>
              <p>
                Search the EU Novel Foods Catalogue and Pharmaceutical Database for compliance checking
              </p>
            </div>
            <div className="header-actions">
              {user ? (
                <div className="user-info">
                  <span className="user-email">{user.email}</span>
                  <button
                    className="btn-logout"
                    onClick={async () => {
                      await signOut()
                      setUser(null)
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  className="btn-login"
                  onClick={() => setShowAuthModal(true)}
                >
                  Sign In
                </button>
              )}
              <button
                className="help-button"
                onClick={() => setShowHelp(true)}
                title="Help - Color Guide"
              >
                ?
              </button>
            </div>
          </div>

          <div className="input-section">
            <label className="label">
              Enter Ingredients List
            </label>
            <textarea
              placeholder="Paste ingredients list here... (e.g., NAC, Vitamin C, Spirulina, Melatonin)"
              value={ingredientsList}
              onChange={handleTextareaChange}
              className="textarea"
              rows="1"
            />
            <div className="input-footer">
              <div className="status-text">
                {loading ? (
                  <span>⏳ Loading databases...</span>
                ) : loadError ? (
                  <span style={{ color: '#ef4444' }}>❌ {loadError}</span>
                ) : (
                  <span>
                    <strong>{novelFoods.length}</strong> novel foods and <strong>{pharmaceuticals.length}</strong> pharmaceutical ingredients loaded
                  </span>
                )}
              </div>
              <button
                onClick={analyzeIngredients}
                disabled={loading || !ingredientsList.trim() || analyzing}
                className="btn-analyze"
              >
                {analyzing ? (
                  <span className="analyzing-text">
                    <span className="spinner"></span>
                    {analysisProgress.step}
                    {analysisProgress.total > 0 && ` (${analysisProgress.current}/${analysisProgress.total})`}
                  </span>
                ) : (
                  'Analyze'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Full Screen Help Modal */}
        {showHelp && (
          <div className="modal-overlay" onClick={() => setShowHelp(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>How to Use the Ingredient Safety Checker</h2>
                <button onClick={() => setShowHelp(false)} className="modal-close">×</button>
              </div>

              <div className="modal-body">
                <section className="modal-section">
                  <h3>📋 How It Works</h3>
                  <p>This tool automatically analyzes dietary supplement ingredients using a 2-step verification process based on Swedish and EU regulations:</p>

                  <div className="process-explanation">
                    <div className="process-step-explanation">
                      <div className="step-number-large">1</div>
                      <div>
                        <h4>Substance Guide Check (Ämnesguiden)</h4>
                        <p>Checks Läkemedelsverket's database to see if the ingredient is a pharmaceutical medicine.</p>
                        <ul>
                          <li>✓ If found and NOT a medicine → Continue to Step 2</li>
                          <li>❌ If IS a pharmaceutical medicine → <strong>NON-APPROVED</strong></li>
                          <li>→ If not found → Continue to Step 2</li>
                        </ul>
                      </div>
                    </div>

                    <div className="process-step-explanation">
                      <div className="step-number-large">2</div>
                      <div>
                        <h4>EU Novel Food Catalogue Check</h4>
                        <p>Checks if the ingredient requires special authorization.</p>
                        <ul>
                          <li>✓ If "Not novel" or "Authorized" → <strong>APPROVED</strong></li>
                          <li>❌ If "Novel food" (requires authorization) → <strong>NON-APPROVED</strong></li>
                          <li>❓ If not found anywhere → <strong>UNKNOWN</strong></li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="modal-section">
                  <h3>🌐 Automatic Translation</h3>
                  <p>Swedish ingredient names are automatically translated to English using DeepL AI and searched again. Translations are cached to save resources.</p>
                  <p className="info-note">Example: "gurkmeja" → "turmeric" → finds match in database</p>
                </section>

                <section className="modal-section">
                  <h3>👥 Community Labels</h3>
                  <p>Signed-in users can add community labels to ingredients marked as "Unknown". These labels:</p>
                  <ul className="tips-list">
                    <li>Override automatic results when voted on by the community</li>
                    <li>Can have custom statuses with custom colors (e.g., "Conditional", "Sometimes")</li>
                    <li>Include notes explaining the reasoning</li>
                    <li>Update in real-time for all users</li>
                  </ul>
                </section>

                <section className="modal-section">
                  <h3>🎨 Status Colors</h3>
                  <div className="color-guide-grid">
                    <div className="color-guide-item">
                      <span className="help-badge ingredient-danger">Example</span>
                      <div>
                        <h4>🔴 Red - Non-Approved</h4>
                        <p>Ingredient is <strong>NOT APPROVED</strong> because it's either:</p>
                        <ul>
                          <li>A pharmaceutical medicine (Läkemedelsverket)</li>
                          <li>A "Novel food" requiring authorization (EU)</li>
                        </ul>
                      </div>
                    </div>

                    <div className="color-guide-item">
                      <span className="help-badge ingredient-safe">Example</span>
                      <div>
                        <h4>🟢 Green - Approved</h4>
                        <p>Ingredient is <strong>APPROVED</strong>:</p>
                        <ul>
                          <li>Found in Substance Guide as non-medicine, AND</li>
                          <li>Either not in Novel Food Catalogue or marked "Not novel"/"Authorized"</li>
                        </ul>
                      </div>
                    </div>

                    <div className="color-guide-item">
                      <span className="help-badge ingredient-unknown">Example</span>
                      <div>
                        <h4>⚪ Purple - Unknown</h4>
                        <p><strong>No information</strong> found in databases (even after translation attempt). You can add a community label to help others!</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="modal-section">
                  <h3>💡 Tips</h3>
                  <ul className="tips-list">
                    <li>Click any ingredient badge to see detailed analysis with step-by-step verification</li>
                    <li>Paste full ingredient lists - the system handles Swedish names, Latin names, and parentheses</li>
                    <li>Sign in to add community labels for unknown ingredients</li>
                    <li>Look for the <span className="material-symbols-rounded" style={{fontSize: '1rem', verticalAlign: 'middle'}}>group</span> icon - it means there are community labels</li>
                    <li>Translated ingredients show a 🌐 icon with the translation used</li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {analyzedIngredients.length > 0 && (
          <div className="card results-card">
            <h2 className="results-header">
              Analysis Results ({analyzedIngredients.length} ingredients{analysisTime ? ` in ${analysisTime}s` : ''})
            </h2>

            {/* Ingredients flow like text */}
            <div className="ingredients-flow">
              {analyzedIngredients.map((ingredient, idx) => (
                <span key={idx}>
                  <span
                    className={`ingredient-badge ${
                      ingredient.status === 'danger'
                        ? 'ingredient-danger'
                        : ingredient.status === 'safe'
                        ? 'ingredient-safe'
                        : ingredient.status === 'info'
                        ? 'ingredient-info'
                        : 'ingredient-unknown'
                    }`}
                    onClick={() => setSelectedIngredient(
                      selectedIngredient === idx ? null : idx
                    )}
                  >
                    {ingredient.name}
                    {ingredient.hasManualLabel && (
                      <span className="material-symbols-rounded manual-label-indicator" title="Has community labels">
                        group
                      </span>
                    )}
                  </span>
                </span>
              ))}
            </div>

            {/* Details panel below */}
            {selectedIngredient !== null && (
              <div className="details-panel">
                <div className="details-header">
                  <div className="details-title">
                    <span className="details-icon">
                      {analyzedIngredients[selectedIngredient].status === 'danger' ? '🔴' :
                       analyzedIngredients[selectedIngredient].status === 'safe' ? '🟢' :
                       analyzedIngredients[selectedIngredient].status === 'info' ? 'ℹ️' : '❓'}
                    </span>
                    <h3>
                      {analyzedIngredients[selectedIngredient].name}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedIngredient(null)}
                    className="btn-close"
                  >
                    ×
                  </button>
                </div>

                <div className={`status-badge ${
                  analyzedIngredients[selectedIngredient].status === 'danger'
                    ? 'status-badge-danger'
                    : analyzedIngredients[selectedIngredient].status === 'safe'
                    ? 'status-badge-safe'
                    : analyzedIngredients[selectedIngredient].status === 'info'
                    ? 'status-badge-info'
                    : 'status-badge-unknown'
                }`}>
                  {analyzedIngredients[selectedIngredient].statusText}
                </div>

                <div className="details-content">
                  {/* Process Flow Visualization */}
                  <div className="process-flow">
                    {analyzedIngredients[selectedIngredient].details && (analyzedIngredients[selectedIngredient].details.source === 'multiple' || (analyzedIngredients[selectedIngredient].details.source === 'community' && analyzedIngredients[selectedIngredient].details.databaseMatches)) ? (
                      <>
                        <div>
                          {/* Group by search term */}
                          {(() => {
                            const matches = analyzedIngredients[selectedIngredient].details.source === 'community'
                              ? analyzedIngredients[selectedIngredient].details.databaseMatches
                              : analyzedIngredients[selectedIngredient].details.matches;

                            // If we have matches, show them
                            if (matches && (matches.pharma.concat(matches.novel).length > 0)) {
                              const allTerms = new Set();
                              matches.pharma.forEach(m => allTerms.add(m.term));
                              matches.novel.forEach(m => allTerms.add(m.term));

                              return Array.from(allTerms).map((searchTerm, termIdx) => {
                                const pharmaForTerm = matches.pharma.find(m => m.term === searchTerm);
                                const novelForTerm = matches.novel.find(m => m.term === searchTerm);
                                const wasTranslated = pharmaForTerm?.translatedFrom || novelForTerm?.translatedFrom;
                                const originalTerm = pharmaForTerm?.translatedFrom || novelForTerm?.translatedFrom;

                                return (
                                  <div key={termIdx} className="term-process" style={{ marginBottom: termIdx < allTerms.size - 1 ? '2rem' : '0' }}>
                                    <h4 className="search-term-title">Search Term: "{searchTerm}"</h4>
                                    {wasTranslated && (
                                      <p className="translation-note" style={{ fontSize: '0.875rem', color: '#3b82f6', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                        🌐 Translated from "{originalTerm}"
                                      </p>
                                    )}

                                    {/* Step 1: Substance Guide (Pharmaceutical) Check */}
                                    <div className={`process-step ${pharmaForTerm ? (pharmaForTerm.result.item.is_medicine ? 'step-failed' : 'step-passed') : 'step-not-found'}`}>
                                      <div className="step-header">
                                        <span className="step-number">1</span>
                                        <span className="step-title">Compare with Substance Guide (Ämnesguiden)</span>
                                        <span className="step-status">
                                          {pharmaForTerm
                                            ? (pharmaForTerm.result.item.is_medicine ? '❌ Is Medicine' : '✓ Ingredients OK')
                                            : '✗ Not Found'}
                                        </span>
                                      </div>
                                      {pharmaForTerm && (
                                        <div className="step-details">
                                          <p><strong>Matched as:</strong> {pharmaForTerm.result.item.name}</p>
                                          {pharmaForTerm.matchType === 'known_safe' && (
                                            <p className="info-note">ℹ️ Recognized as a standard nutritional ingredient</p>
                                          )}
                                          <p><strong>Result:</strong> {pharmaForTerm.result.item.is_medicine ? '❌ Pharmaceutical Medicine → Non-Approved' : '✓ Non-Medicine Substance → Continue to Step 2'}</p>
                                          {pharmaForTerm.result.item.comment && (
                                            <p><strong>Notes:</strong> {pharmaForTerm.result.item.comment}</p>
                                          )}
                                          {pharmaForTerm.result.item.synonyms && pharmaForTerm.result.item.synonyms.length > 0 && (
                                            <p><strong>Also known as:</strong> {pharmaForTerm.result.item.synonyms.slice(0, 5).join(', ')}{pharmaForTerm.result.item.synonyms.length > 5 && '...'}</p>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Step 2: Novel Food Check - Only if passed Step 1 */}
                                    <div className={`process-step ${
                                      !pharmaForTerm || pharmaForTerm.result.item.is_medicine
                                        ? 'step-skipped'
                                        : novelForTerm
                                          ? (() => {
                                              const novelStatus = novelForTerm.result.item.novel_food_status;
                                              const isActuallyNovel = novelStatus === 'Novel food';
                                              const isAuthorized = novelStatus === 'Authorised novel food' ||
                                                                   novelStatus === 'Not novel in food' ||
                                                                   novelStatus === 'Not novel in food supplements';
                                              return isActuallyNovel ? 'step-failed' : isAuthorized ? 'step-passed' : 'step-warning';
                                            })()
                                          : 'step-passed'
                                    }`}>
                                      <div className="step-header">
                                        <span className="step-number">2</span>
                                        <span className="step-title">Compare with EU Novel Food Catalogue</span>
                                        <span className="step-status">
                                          {!pharmaForTerm || pharmaForTerm.result.item.is_medicine
                                            ? '⊘ Skipped'
                                            : novelForTerm
                                              ? (() => {
                                                  const novelStatus = novelForTerm.result.item.novel_food_status;
                                                  const isActuallyNovel = novelStatus === 'Novel food';
                                                  const isAuthorized = novelStatus === 'Authorised novel food' ||
                                                                       novelStatus === 'Not novel in food' ||
                                                                       novelStatus === 'Not novel in food supplements';
                                                  return isActuallyNovel ? '❌ Found (Non-Approved)' : isAuthorized ? '✓ Found (Approved)' : '❓ Found (Review Needed)';
                                                })()
                                              : '✓ Not Found (Approved)'}
                                        </span>
                                      </div>
                                      {pharmaForTerm && !pharmaForTerm.result.item.is_medicine && novelForTerm && (
                                        <div className="step-details">
                                          <p><strong>Matched as:</strong> {novelForTerm.result.item.novel_food_name}</p>
                                          {novelForTerm.result.item.common_name && (
                                            <p><strong>Common name:</strong> {novelForTerm.result.item.common_name}</p>
                                          )}
                                          <p><strong>Status:</strong> {stripHtml(novelForTerm.result.item.novel_food_status_desc)}</p>
                                          {(() => {
                                            const novelStatus = novelForTerm.result.item.novel_food_status;
                                            const isActuallyNovel = novelStatus === 'Novel food';
                                            const isAuthorized = novelStatus === 'Authorised novel food' ||
                                                                 novelStatus === 'Not novel in food' ||
                                                                 novelStatus === 'Not novel in food supplements';
                                            return isActuallyNovel
                                              ? <p className="error-note">❌ Novel Food found → Non-Approved</p>
                                              : isAuthorized
                                                ? <p className="success-note">✓ Not novel / Authorized → Approved</p>
                                                : <p className="warning-note">❓ Status unclear → Needs review</p>;
                                          })()}
                                        </div>
                                      )}
                                    </div>

                                    {/* Final Result */}
                                    <div className={`final-result ${
                                      pharmaForTerm && pharmaForTerm.result.item.is_medicine
                                        ? 'result-rejected'
                                        : pharmaForTerm && novelForTerm
                                          ? (() => {
                                              const novelStatus = novelForTerm.result.item.novel_food_status;
                                              const isActuallyNovel = novelStatus === 'Novel food';
                                              return isActuallyNovel ? 'result-rejected' : 'result-approved';
                                            })()
                                          : pharmaForTerm && !novelForTerm
                                            ? 'result-approved'
                                            : 'result-unknown'
                                    }`}>
                                      <strong>Final Result:</strong> {
                                        pharmaForTerm && pharmaForTerm.result.item.is_medicine
                                          ? '❌ NON-APPROVED (Pharmaceutical Medicine)'
                                          : pharmaForTerm && novelForTerm
                                            ? (() => {
                                                const novelStatus = novelForTerm.result.item.novel_food_status;
                                                const isActuallyNovel = novelStatus === 'Novel food';
                                                const isAuthorized = novelStatus === 'Authorised novel food' ||
                                                                     novelStatus === 'Not novel in food' ||
                                                                     novelStatus === 'Not novel in food supplements';
                                                return isActuallyNovel
                                                  ? '❌ NON-APPROVED (Novel Food - Requires Authorization)'
                                                  : isAuthorized
                                                    ? '✓ APPROVED'
                                                    : '❓ UNKNOWN (Novel Food Under Review)';
                                              })()
                                            : pharmaForTerm && !novelForTerm
                                              ? '✓ APPROVED'
                                              : '❓ UNKNOWN (Not in Substance Guide)'
                                      }
                                    </div>
                                  </div>
                                );
                              });
                            } else {
                              // No matches found - show "Not Found" for all search terms
                              const ingredient = analyzedIngredients[selectedIngredient].name;
                              const match = ingredient.match(/^([^(]+)(?:\(([^)]+)\))?/);
                              const mainName = match ? match[1].trim() : ingredient;

                              return (
                                <div className="term-process">
                                  <h4 className="search-term-title">Search Term: "{mainName}"</h4>

                                  {/* Step 1: Not found */}
                                  <div className="process-step step-not-found">
                                    <div className="step-header">
                                      <span className="step-number">1</span>
                                      <span className="step-title">Compare with Substance Guide (Ämnesguiden)</span>
                                      <span className="step-status">✗ Not Found</span>
                                    </div>
                                  </div>

                                  {/* Step 2: Not found */}
                                  <div className="process-step step-not-found">
                                    <div className="step-header">
                                      <span className="step-number">2</span>
                                      <span className="step-title">Compare with EU Novel Food Catalogue</span>
                                      <span className="step-status">✗ Not Found</span>
                                    </div>
                                  </div>

                                  {/* Final Result */}
                                  <div className="final-result result-unknown">
                                    <strong>Final Result:</strong> ❓ UNKNOWN (Not in Substance Guide)
                                  </div>
                                </div>
                              );
                            }
                          })()}
                        </div>

                        {/* Show fuzzy match button if fuzzy matches are available */}
                        {analyzedIngredients[selectedIngredient].details?.fuzzyMatches &&
                         analyzedIngredients[selectedIngredient].details.fuzzyMatches.length > 0 && (
                          <div style={{ textAlign: 'center', padding: '1rem', marginTop: '1rem' }}>
                            <button
                              className="btn-select-match"
                              onClick={() => {
                                setMatchSelectorData({
                                  ingredient: analyzedIngredients[selectedIngredient].name,
                                  fuzzyMatches: analyzedIngredients[selectedIngredient].details.fuzzyMatches
                                });
                                setShowMatchSelector(true);
                              }}
                            >
                              🔍 {analyzedIngredients[selectedIngredient].details?.requiresUserSelection
                                ? `Select from ${analyzedIngredients[selectedIngredient].details.fuzzyMatches.length} Fuzzy Matches`
                                : `View ${analyzedIngredients[selectedIngredient].details.fuzzyMatches.length} Alternative Matches`}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <p style={{ color: '#6b7280', textAlign: 'center', padding: '1rem' }}>
                          ❓ No information found for this ingredient in either the Substance Guide or Novel Food Catalogue.
                        </p>

                        {/* Show fuzzy match button if fuzzy matches are available */}
                        {analyzedIngredients[selectedIngredient].details?.fuzzyMatches &&
                         analyzedIngredients[selectedIngredient].details.fuzzyMatches.length > 0 && (
                          <div style={{ textAlign: 'center', padding: '1rem' }}>
                            <button
                              className="btn-select-match"
                              onClick={() => {
                                setMatchSelectorData({
                                  ingredient: analyzedIngredients[selectedIngredient].name,
                                  fuzzyMatches: analyzedIngredients[selectedIngredient].details.fuzzyMatches
                                });
                                setShowMatchSelector(true);
                              }}
                            >
                              🔍 {analyzedIngredients[selectedIngredient].details?.requiresUserSelection
                                ? `Select from ${analyzedIngredients[selectedIngredient].details.fuzzyMatches.length} Fuzzy Matches`
                                : `View ${analyzedIngredients[selectedIngredient].details.fuzzyMatches.length} Alternative Matches`}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual Labels Section */}
                  <ManualLabelsDisplay
                    labels={analyzedIngredients[selectedIngredient].manualLabels}
                    user={user}
                    onVoteUpdate={async () => {
                      // Refresh this ingredient's status without re-analyzing everything
                      await refreshIngredientStatus(analyzedIngredients[selectedIngredient].name)
                    }}
                    onEditLabel={(label) => handleEditLabel(label, analyzedIngredients[selectedIngredient])}
                  />

                  {/* Add Label Button */}
                  <div className="add-label-section">
                    <button
                      className="btn-add-label"
                      onClick={() => handleCreateLabel(analyzedIngredients[selectedIngredient])}
                    >
                      + Add Community Label
                    </button>
                    {!user && (
                      <p className="label-hint">Sign in to add labels and vote</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Auth Modal */}
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onSuccess={(user) => setUser(user)}
          />
        )}

        {/* Manual Label Modal */}
        {showLabelModal && labelingIngredient && (
          <ManualLabelModal
            ingredient={labelingIngredient}
            user={user}
            existingLabel={editingLabel}
            onClose={() => {
              setShowLabelModal(false)
              setLabelingIngredient(null)
              setEditingLabel(null)
            }}
            onSuccess={handleLabelSuccess}
          />
        )}

        {/* Match Selector Modal */}
        {showMatchSelector && matchSelectorData && (
          <MatchSelector
            ingredient={matchSelectorData.ingredient}
            fuzzyMatches={matchSelectorData.fuzzyMatches}
            onSelectMatch={handleMatchSelection}
            onCancel={handleMatchCancel}
          />
        )}

        {/* Footer */}
        <footer className="footer">
          <div className="footer-content">
            <div className="footer-section">
              <h3>About This Project</h3>
              <p>
                This project improves how dietary supplements are checked for safety and compliance.
                Today, food inspectors must manually compare ingredients and health claims against EU and Swedish databases,
                which is slow and means only a small number of supplements are reviewed.
              </p>
            </div>
            <div className="footer-section">
              <h3>The Solution</h3>
              <p>
                This tool automatically analyzes ingredient lists from e-commerce sites and cross-checks them with official databases.
                It helps inspectors save time, reduce unsafe supplements on the market, and simplify their work.
                Developed as part of a hackathon with <strong>UU AI Society</strong> for <strong>Uppsala Municipality</strong>.
              </p>
            </div>
            <div className="footer-section">
              <h3>Disclaimer</h3>
              <p>
                This tool is for informational purposes only. Always consult official regulatory
                sources for final compliance decisions.
              </p>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} UU AI Society Hackathon Project | Uppsala Municipality</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;