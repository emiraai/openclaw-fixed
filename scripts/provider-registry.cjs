#!/usr/bin/env node
/**
 * provider-registry.cjs - Registry of free LLM API providers.
 *
 * Defines all known free providers with their API details, models, and auth.
 * Merges with existing openclaw.json config to build a flat testable model list.
 *
 * Key functions:
 *  - getKnownProviders()      - All hardcoded free providers
 *  - mergeWithConfig(cfg)     - Merge known providers with config
 *  - getTestableModels(cfg)   - Flat deduped model list ready for benchmarking
 *  - isModelFree(model)       - Check if a model has zero cost
 *  - generateProviderConfig() - Generate config snippet for new providers
 */
"use strict";

/**
 * Known free model providers.
 * Each entry follows the architecture spec schema.
 */
var KNOWN_PROVIDERS = [
  {
    name: "nvidia",
    displayName: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "NVIDIA_API_KEY",
    rateLimit: { requestsPerMinute: 5, tokensPerMinute: 100000 },
    signupUrl: "https://build.nvidia.com/explore/discover",
    models: [
      { id: "nvidia/llama-3.3-nemotron-super-49b-v1", name: "Nemotron Super 49B", free: true, contextWindow: 131072, maxTokens: 16384, reasoning: true, input: ["text"] },
      { id: "stepfun-ai/step-3.5-flash", name: "Step 3.5 Flash", free: true, contextWindow: 262144, maxTokens: 16384, reasoning: false, input: ["text"] },
      { id: "nvidia/nemotron-3-nano-30b-a3b", name: "Nemotron Nano 30B", free: true, contextWindow: 1048576, maxTokens: 16384, reasoning: false, input: ["text"] },
      { id: "minimaxai/minimax-m2", name: "MiniMax M2", free: true, contextWindow: 262144, maxTokens: 16384, reasoning: false, input: ["text"] },
      { id: "deepseek-ai/deepseek-v3.2", name: "DeepSeek V3.2", free: true, contextWindow: 131072, maxTokens: 16384, reasoning: false, input: ["text"] },
      { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", free: true, contextWindow: 262000, maxTokens: 16384, reasoning: true, input: ["text", "image"] },
      { id: "qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B", free: true, contextWindow: 262144, maxTokens: 16384, reasoning: false, input: ["text"] },
      { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B", free: true, contextWindow: 131072, maxTokens: 16384, reasoning: false, input: ["text"] },
    ],
  },
  {
    name: "groq",
    displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "GROQ_API_KEY",
    rateLimit: { requestsPerMinute: 30, tokensPerMinute: 100000 },
    signupUrl: "https://console.groq.com/keys",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", free: true, contextWindow: 131072, maxTokens: 32768 },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", free: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "gemma2-9b-it", name: "Gemma2 9B IT", free: true, contextWindow: 8192, maxTokens: 8192 },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", free: true, contextWindow: 32768, maxTokens: 32768 },
    ],
  },
  {
    name: "cerebras",
    displayName: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "CEREBRAS_API_KEY",
    rateLimit: { requestsPerMinute: 30, tokensPerMinute: 1000000 },
    signupUrl: "https://cloud.cerebras.ai/",
    models: [
      { id: "llama-3.3-70b", name: "Llama 3.3 70B (Cerebras)", free: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "llama-3.1-8b", name: "Llama 3.1 8B (Cerebras)", free: true, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    name: "sambanova",
    displayName: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "SAMBANOVA_API_KEY",
    rateLimit: { requestsPerMinute: 10, tokensPerMinute: 100000 },
    signupUrl: "https://cloud.sambanova.ai/",
    models: [
      { id: "Meta-Llama-3.3-70B-Instruct", name: "Llama 3.3 70B (SambaNova)", free: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "DeepSeek-R1-Distill-Llama-70B", name: "DeepSeek R1 Distill 70B", free: true, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    name: "together",
    displayName: "Together.ai",
    baseUrl: "https://api.together.xyz/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "TOGETHER_API_KEY",
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000 },
    signupUrl: "https://api.together.xyz/",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", free: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B Turbo", free: true, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    name: "huggingface",
    displayName: "HuggingFace",
    baseUrl: "https://router.huggingface.co/v1",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "HF_TOKEN",
    rateLimit: { requestsPerMinute: 30, tokensPerMinute: 100000 },
    signupUrl: "https://huggingface.co/settings/tokens",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B (HF)", free: true, contextWindow: 131072, maxTokens: 8192 },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B (HF)", free: true, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    name: "github_models",
    displayName: "GitHub Models",
    baseUrl: "https://models.inference.ai.azure.com",
    api: "openai-completions",
    authType: "bearer",
    requiresKey: true,
    envVar: "GITHUB_TOKEN",
    rateLimit: { requestsPerMinute: 15, tokensPerMinute: 150000 },
    signupUrl: "https://github.com/marketplace/models",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini (GitHub)", free: true, contextWindow: 128000, maxTokens: 16384 },
      { id: "Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B (GitHub)", free: true, contextWindow: 131072, maxTokens: 8192 },
    ],
  },
];

/**
 * Get all known free providers.
 * @returns {Array<Object>}
 */
function getKnownProviders() {
  return KNOWN_PROVIDERS;
}

/**
 * Check if a model has zero cost.
 * @param {Object} model - model with cost field
 * @returns {boolean}
 */
function isModelFree(model) {
  if (!model) return false;
  if (model.free === true) return true;
  if (model.free === false) return false;
  var cost = model.cost;
  if (!cost) return false; // no cost info = assume paid (safer default)
  return (cost.input || 0) === 0 && (cost.output || 0) === 0;
}

/**
 * Merge known providers with existing openclaw.json config.
 * - If a known provider exists in config: use config's apiKey, merge new models
 * - If a known provider is NOT in config: add if env var is set or authType is "none"
 * - Config providers not in known list are kept as-is
 *
 * @param {Object} cfg - full openclaw.json config
 * @param {Object} [envKeys] - { providerName: apiKey } overrides
 * @returns {Object} merged providers map keyed by name
 */
function mergeWithConfig(cfg, envKeys) {
  var configProviders = (cfg && cfg.models && cfg.models.providers) || {};
  var merged = {};

  // Copy all config providers first
  var configNames = Object.keys(configProviders);
  for (var i = 0; i < configNames.length; i++) {
    var name = configNames[i];
    merged[name] = JSON.parse(JSON.stringify(configProviders[name]));
  }

  // Merge in known providers
  for (var j = 0; j < KNOWN_PROVIDERS.length; j++) {
    var kp = KNOWN_PROVIDERS[j];
    var apiKey = (envKeys && envKeys[kp.name]) || process.env[kp.envVar] || "";

    if (merged[kp.name]) {
      // Provider exists in config - merge any new models not already listed
      var existing = merged[kp.name];
      var existingIds = new Set((existing.models || []).map(function(m) { return m.id; }));

      for (var k = 0; k < kp.models.length; k++) {
        if (!existingIds.has(kp.models[k].id)) {
          if (!existing.models) existing.models = [];
          existing.models.push({
            id: kp.models[k].id,
            name: kp.models[k].name,
            reasoning: kp.models[k].reasoning || false,
            input: kp.models[k].input || ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: kp.models[k].contextWindow || 131072,
            maxTokens: kp.models[k].maxTokens || 8192,
          });
        }
      }
    } else if (apiKey || kp.authType === "none") {
      // New provider - add it
      merged[kp.name] = {
        baseUrl: kp.baseUrl,
        apiKey: apiKey,
        api: kp.api,
        models: kp.models.map(function(m) {
          return {
            id: m.id,
            name: m.name,
            reasoning: m.reasoning || false,
            input: m.input || ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow || 131072,
            maxTokens: m.maxTokens || 8192,
          };
        }),
      };
    }
  }

  return merged;
}

/**
 * Get flat list of testable models from config, deduplicating by provider/model.id.
 * @param {Object} cfg - full openclaw.json config
 * @param {Object} [envKeys] - optional key overrides
 * @returns {Array<Object>} flat model list with connection details
 */
function getTestableModels(cfg, envKeys) {
  var providers = mergeWithConfig(cfg, envKeys);
  var models = [];
  var seen = new Set();

  var names = Object.keys(providers);
  for (var i = 0; i < names.length; i++) {
    var provName = names[i];
    var prov = providers[provName];
    if (!prov.baseUrl) continue;

    var provModels = prov.models || [];
    for (var j = 0; j < provModels.length; j++) {
      var m = provModels[j];
      var key = provName + "/" + m.id;
      if (seen.has(key)) continue;
      seen.add(key);

      models.push({
        provider: provName,
        id: m.id,
        name: m.name || m.id,
        baseUrl: prov.baseUrl,
        apiKey: prov.apiKey || "",
        api: prov.api || "openai-completions",
        free: isModelFree(m),
        cost: m.cost || { input: 0, output: 0 },
        contextWindow: m.contextWindow || 0,
        maxTokens: m.maxTokens || 0,
        reasoning: m.reasoning || false,
      });
    }
  }

  return models;
}

/**
 * Generate config snippet for a newly discovered provider.
 * @param {string} providerName
 * @param {string} apiKey
 * @returns {Object|null}
 */
function generateProviderConfig(providerName, apiKey) {
  var prov = null;
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    if (KNOWN_PROVIDERS[i].name === providerName) {
      prov = KNOWN_PROVIDERS[i];
      break;
    }
  }
  if (!prov) return null;

  return {
    baseUrl: prov.baseUrl,
    apiKey: apiKey,
    api: prov.api,
    models: prov.models.map(function(m) {
      return {
        id: m.id,
        name: m.name,
        reasoning: m.reasoning || false,
        input: m.input || ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow || 131072,
        maxTokens: m.maxTokens || 8192,
      };
    }),
  };
}

/**
 * Get all known providers as a map keyed by name (legacy compat).
 * @returns {Object}
 */
function getAllProviders() {
  var map = {};
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    map[KNOWN_PROVIDERS[i].name] = KNOWN_PROVIDERS[i];
  }
  return map;
}

module.exports = {
  KNOWN_PROVIDERS: KNOWN_PROVIDERS,
  getKnownProviders: getKnownProviders,
  mergeWithConfig: mergeWithConfig,
  getTestableModels: getTestableModels,
  isModelFree: isModelFree,
  generateProviderConfig: generateProviderConfig,
  getAllProviders: getAllProviders,
};
