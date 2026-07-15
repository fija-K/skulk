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

    const modelsList = response.models || [];
    if (modelsList.length === 0) {
      console.warn('[Gemini SDK] Discover response returned 0 models.');
      throw new Error('NO_MODELS_DISCOVERED');
    }

    // Filter compatible text generation models
    const compatible = modelsList.filter((m: any) => {
      // Must support generateContent
      const supportsChat = m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
      if (!supportsChat) return false;

      // Exclude specialized / non-chat models
      const lowerName = (m.name || '').toLowerCase();
      const lowerDesc = (m.description || '').toLowerCase();
      const hasExcludedKeyword = EXCLUDED_KEYWORDS.some(k => lowerName.includes(k) || lowerDesc.includes(k));
      if (hasExcludedKeyword) return false;

      return true;
    });

    if (compatible.length === 0) {
      console.error('[Gemini SDK] No compatible models found. Discovered list:', modelsList.map((m: any) => m.name));
      throw new Error('NO_COMPATIBLE_MODELS');
    }

    // Score models to determine the best choice
    const scoredModels = compatible.map((m: any) => {
      const name = m.name || '';
      const lowerName = name.toLowerCase();
      let score = 0;

      // Prefer Flash models
      if (lowerName.includes('flash')) {
        score += 100;
      }

      // Prefer stable models (exclude preview/experimental/exp/alpha)
      const isStable = !lowerName.includes('preview') && 
                       !lowerName.includes('experimental') && 
                       !lowerName.includes('exp') && 
                       !lowerName.includes('alpha');
      if (isStable) {
        score += 50;
      }

      // Prefer non-image and non-tts models
      if (!lowerName.includes('image') && !lowerName.includes('tts')) {
        score += 25;
      }

      // Prefer standard Flash over Flash-Lite
      if (!lowerName.includes('lite')) {
        score += 10;
      }

      return { model: m, score };
    });

    // Sort: score descending, then version descending as tie-breaker, then name alphabetical
    scoredModels.sort((a: any, b: any) => {
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

    const chosen = scoredModels[0].model;
    const cleanName = chosen.name.startsWith('models/') ? chosen.name : `models/${chosen.name}`;
    
    console.info(`[Gemini SDK] Model Discovery Diagnostics:
- Total Discovered: ${modelsList.length}
- Total Compatible: ${compatible.length}
- Chosen Model: ${cleanName} (Score: ${scoredModels[0].score})
- Initialization: Success`);

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
