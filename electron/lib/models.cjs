// モデル一覧の取得キャッシュと、タスク別モデルルーティング(§8.4)用の軽量モデル選定。
const { getKey } = require("./keys.cjs");

const providerPaths = {
  anthropic: "./providers/anthropic.cjs",
  openai: "./providers/openai.cjs",
  google: "./providers/google.cjs",
};

const providers = new Map();

// 数百モジュールある各社SDKは、実際にそのプロバイダを使うまで読み込まない。
function getProvider(name) {
  const providerPath = providerPaths[name];
  if (!providerPath) return undefined;
  if (!providers.has(name)) providers.set(name, require(providerPath));
  return providers.get(name);
}

const cache = new Map(); // provider -> { models, error }

async function listModels(providerName, force = false) {
  if (!force && cache.has(providerName)) return cache.get(providerName);
  const provider = getProvider(providerName);
  if (!provider) return { models: [], error: "unknown provider" };
  const apiKey = getKey(providerName);
  if (!apiKey) return { models: [], error: "no_key" };
  try {
    const models = await provider.listModels(apiKey);
    const result = { models, error: null };
    cache.set(providerName, result);
    return result;
  } catch (err) {
    return { models: [], error: String(err?.message || err) };
  }
}

// 精度より量のタスク(要約・検知・ブリーフィング)用の軽量モデルを選ぶ。
// モデル一覧から名前の傾向で選定し、見つからなければ fallback を返す。
const CHEAP_PATTERNS = {
  anthropic: [/haiku/i],
  openai: [/nano/i, /mini/i],
  google: [/flash-lite/i, /flash(?!.*(pro))/i],
};

async function pickCheapModel(providerName, fallback) {
  const { models } = await listModels(providerName);
  const patterns = CHEAP_PATTERNS[providerName] || [];
  for (const pat of patterns) {
    // 新しいモデルが先頭に来る並びなので、最初にマッチしたものを使う
    const m = models.find((x) => pat.test(x.id));
    if (m) return m.id;
  }
  return fallback;
}

module.exports = { listModels, pickCheapModel, getProvider };
