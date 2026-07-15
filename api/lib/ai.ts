import { GoogleGenAI } from '@google/genai';

// ----------------------------------------------------------------
// Centralized Configuration Constants
// ----------------------------------------------------------------
const CACHE_DURATION = 60 * 60 * 1000; // 1 Hour cache duration

// Keywords used to filter out non-chat models
const EXCLUDED_KEYWORDS = [
  'embedding',
  'imagen',
  'veo',
  'robotics',
  'computer-use',
  'tts',
  'deep-research',
  'antigravity'
];

// Helper to check environment variables securely without logging keys
function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '') return null;
  return key;
}

// ----------------------------------------------------------------
// Dynamic Model Discovery & Capability Scoring Service
// ----------------------------------------------------------------
export class GeminiService {
  private static ai: GoogleGenAI | null = null;
  private static cachedModel: string | null = null;
  private static lastSelectedTime = 0;
  private static initPromise: Promise<string> | null = null;

  // Initialize and get the GoogleGenAI instance
  public static getClient(): GoogleGenAI {
    if (!this.ai) {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error('MISSING_API_KEY');
      }
      this.ai = new GoogleGenAI({ apiKey });
      console.info(`[Gemini SDK] Initialized GoogleGenAI client (SDK Version: 2.11.0, API Key Present: true)`);
    }
    return this.ai;
  }

  // Get the selected model, with thread-safe promise locking
  public static async getSelectedModel(): Promise<string> {
    const now = Date.now();
    
    // If cached model is valid and not expired, return immediately
    if (this.cachedModel && (now - this.lastSelectedTime < CACHE_DURATION)) {
      return this.cachedModel;
    }

    // Lock thread-safe promise to prevent duplicate API requests
    if (!this.initPromise) {
      this.initPromise = this.discoverBestModel();
    }

    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  // Clear cached model to trigger rediscovery
  public static clearCache() {
    console.info('[Gemini SDK] Cache evicted. Model selection will reinitialize.');
    this.cachedModel = null;
    this.lastSelectedTime = 0;
  }

  // Capability scoring selection logic
  private static async discoverBestModel(): Promise<string> {
    console.info('[Gemini SDK] Discovering available models...');
    const client = this.getClient();
    let response: any;
    try {
      response = await client.models.list();
    } catch (err: any) {
      console.error('[Gemini SDK] Failed to fetch model list:', err.message);
      if (err.status === 401 || err.status === 403 || err.message?.includes('API_KEY_INVALID') || err.message?.includes('invalid API key')) {
        throw new Error('INVALID_API_KEY');
      }
      throw err;
    }

    const modelsList: any[] = [];
    try {
      for await (const m of response) {
        modelsList.push(m);
      }
    } catch (err: any) {
      console.error('[Gemini SDK] Failed to iterate model list iterator:', err.message);
      throw err;
    }

    if (modelsList.length === 0) {
      console.warn('[Gemini SDK] Discover response returned 0 models.');
      throw new Error('NO_MODELS_DISCOVERED');
    }

    console.info(`[Gemini SDK] Discovered ${modelsList.length} models. Evaluating compatibility...`);

    const scoredModels = modelsList.map((m: any) => {
      const name = m.name || '';
      const lowerName = name.toLowerCase();
      const displayName = m.displayName || '';
      const lowerDisplay = displayName.toLowerCase();
      const description = m.description || '';
      const lowerDesc = description.toLowerCase();

      // Heuristic checks using SDK fields
      const supportsChat = m.supportedActions && m.supportedActions.includes('generateContent');
      const isExcluded = EXCLUDED_KEYWORDS.some(k => lowerName.includes(k) || lowerDesc.includes(k) || lowerDisplay.includes(k));

      if (!supportsChat) {
        return { model: m, compatible: false, reason: 'Does not support generateContent', score: -1000 };
      }
      if (isExcluded) {
        return { model: m, compatible: false, reason: 'Excluded keyword (non-chat/specialized model)', score: -1000 };
      }

      let score = 0;
      let reasons: string[] = [];

      // Check if it is Flash
      const isFlash = lowerName.includes('flash') || lowerDisplay.includes('flash');
      if (isFlash) {
        score += 1000;
        reasons.push('Flash model (+1000)');
      } else {
        reasons.push('Non-Flash model (+0)');
      }

      // Check stability (not preview, experimental, exp, alpha)
      const isStable = !lowerName.includes('preview') && 
                       !lowerName.includes('experimental') && 
                       !lowerName.includes('exp') && 
                       !lowerName.includes('alpha') &&
                       !lowerDisplay.includes('preview') &&
                       !lowerDisplay.includes('experimental');
      if (isStable) {
        score += 500;
        reasons.push('Stable model (+500)');
      } else {
        reasons.push('Preview/Experimental model (+0)');
      }

      // Check standard (not lite)
      const isLite = lowerName.includes('lite') || lowerDisplay.includes('lite');
      if (!isLite) {
        score += 100;
        reasons.push('Standard model (+100)');
      } else {
        reasons.push('Lite model (+0)');
      }

      // Check image/tts specialized
      const isImageOrTts = lowerName.includes('image') || lowerName.includes('tts') || lowerDisplay.includes('image') || lowerDisplay.includes('tts');
      if (!isImageOrTts) {
        score += 50;
        reasons.push('No image/tts (+50)');
      } else {
        reasons.push('Specialized image/tts (+0)');
      }

      return {
        model: m,
        compatible: true,
        reasons: reasons.join(', '),
        score
      };
    });

    // Filter compatible ones
    const compatible = scoredModels.filter(item => item.compatible && item.score >= 0);

    if (compatible.length === 0) {
      console.warn('[Gemini SDK] Dynamic filtering returned 0 models. Relaxing filters to use any text generation model...');
      const fallbackList = scoredModels.filter(item => item.model.supportedActions && item.model.supportedActions.includes('generateContent'));
      if (fallbackList.length === 0) {
        console.error('[Gemini SDK] Even relaxed filters returned 0 models. Full discovered list:', modelsList.map(m => m.name));
        throw new Error('NO_COMPATIBLE_MODELS');
      }
      
      // Put fallback models into compatible list
      fallbackList.forEach(item => {
        item.compatible = true;
        if (item.score < 0) item.score = 0; // reset negative penalty
        compatible.push(item);
      });
    }

    // Sort descending by score, tie-break by version descending, then name alphabetical
    compatible.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      // Version tie-breaker
      const verA = getModelVersion(a.model.name);
      const verB = getModelVersion(b.model.name);
      const majorDiff = verB[0] - verA[0];
      if (majorDiff !== 0) return majorDiff;
      const minorDiff = verB[1] - verA[1];
      if (minorDiff !== 0) return minorDiff;

      return a.model.name.localeCompare(b.model.name);
    });

    // Logging detailed evaluations for every candidate to aid debugging
    console.info('=== Gemini Model Selection Pipeline Evaluation ===');
    scoredModels.forEach((item) => {
      const status = item.compatible ? `ACCEPTED (Score: ${item.score}, Reasons: ${item.reasons})` : `REJECTED (${item.reason})`;
      console.info(`- Model: ${item.model.name} -> ${status}`);
    });
    console.info('==================================================');

    const chosen = compatible[0].model;
    const cleanName = chosen.name.startsWith('models/') ? chosen.name : `models/${chosen.name}`;

    console.info(`[Gemini SDK] Selected Gemini model: ${cleanName}
Reason: Highest compatible score (Score: ${compatible[0].score}).`);

    this.cachedModel = cleanName;
    this.lastSelectedTime = Date.now();
    return cleanName;
  }

  // Call the actual model generation API
  public static async callGenerate(model: string, promptText: string): Promise<string> {
    const client = this.getClient();
    const response = await client.models.generateContent({
      model: model,
      contents: promptText,
      config: {
        maxOutputTokens: 100,
        temperature: 0.7
      }
    });

    const reply = response.text || '';
    return reply.trim();
  }
}

// Version parsing helper
function getModelVersion(name: string): number[] {
  const match = name.match(/(\d+)\.(\d+)/);
  if (match) {
    return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }
  const matchSingle = name.match(/(\d+)/);
  if (matchSingle) {
    return [parseInt(matchSingle[1], 10), 0];
  }
  return [0, 0];
}

// ----------------------------------------------------------------
// Centralized generateText Helper (Dynamic self-Healing)
// ----------------------------------------------------------------
export async function generateText(promptText: string): Promise<string> {
  let modelName = await GeminiService.getSelectedModel();

  try {
    const start = Date.now();
    const result = await GeminiService.callGenerate(modelName, promptText);
    console.info(`[Gemini SDK] Successfully generated text using ${modelName} in ${Date.now() - start}ms`);
    return result;
  } catch (error: any) {
    console.warn(`[Gemini SDK] Generation failed with model ${modelName}:`, error.message);

    // Identify if the failure is a recoverable model-selection/availability error
    const isRecoverableModelError = 
      error.message?.includes('NOT_FOUND') ||
      error.message?.includes('not found') ||
      error.message?.includes('unsupported') ||
      error.message?.includes('unavailable') ||
      error.status === 404 ||
      error.status === 503;

    if (isRecoverableModelError) {
      console.warn(`[Gemini SDK] Recoverable model failure detected. Clearing cache to trigger re-discovery...`);
      GeminiService.clearCache();

      // Resolve a new model dynamically
      modelName = await GeminiService.getSelectedModel();
      console.info(`[Gemini SDK] Retrying generation once with newly selected model: ${modelName}`);

      // Retry exactly once
      const start = Date.now();
      const result = await GeminiService.callGenerate(modelName, promptText);
      console.info(`[Gemini SDK] Retry successful using ${modelName} in ${Date.now() - start}ms`);
      return result;
    }

    // Re-throw authentication, permission, quota, or invalid-request errors
    throw error;
  }
}
