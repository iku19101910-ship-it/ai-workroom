// 役割仕分けウィザード(§4.10)。
// 接続済み全プロバイダに同一プロンプトで「タスクを役割に分割し、適任モデルを理由付きで提案せよ」と送信。
const { getKey } = require("./keys.cjs");
const ws = require("./workspace.cjs");
const { listModels, getProvider } = require("./models.cjs");

function parseJson(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askOne(providerName, goal, modelCatalog) {
  const apiKey = getKey(providerName);
  const provider = getProvider(providerName);
  const { models } = await listModels(providerName);
  if (models.length === 0) throw new Error("モデル一覧を取得できません");
  // 提案の生成には各社の先頭(最新上位)モデルを使う
  const model = models[0].id;

  const prompt = [
    "ユーザーのやりたいこと:",
    goal,
    "",
    "上記のタスクを、AIに任せる「役割」に分割してください。各役割について、以下から適任のモデルを理由付きで選んでください。",
    "精度より量のタスク(要約・定型処理)には軽量モデルを、品質が重要なタスクには上位モデルを推奨してください(コスト効率のため §8.4)。",
    "",
    "利用可能なモデル:",
    modelCatalog,
    "",
    "次のJSON形式のみで出力してください:",
    '{"roles":[{"name":"役割名(短く)","provider":"anthropic|openai|google","model":"モデルID","reason":"このモデルが適任な理由(簡潔に)","system_prompt":"この役割カードのシステムプロンプト下書き(日本語)"}]}',
  ].join("\n");

  const result = await provider.sendMessage({
    apiKey,
    model,
    systemText:
      "あなたはAIチーム編成のコンサルタントです。ユーザーのタスクを役割に分割し、指定されたJSON形式のみで提案してください。",
    bibleText: "",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
    onDelta: () => {},
  });

  ws.recordUsage({
    role_card_id: "system_wizard",
    provider: providerName,
    model,
    input: result.usage.input,
    output: result.usage.output,
    cache_read: result.usage.cache_read,
    cache_write: result.usage.cache_write,
  });

  const parsed = parseJson(result.text);
  if (!parsed || !Array.isArray(parsed.roles)) {
    return { provider: providerName, model, roles: [], raw: result.text, error: "JSON解析に失敗(原文を表示)" };
  }
  return {
    provider: providerName,
    model,
    roles: parsed.roles.map((r) => ({
      name: String(r.name || "無名の役割"),
      provider: ["anthropic", "openai", "google"].includes(r.provider) ? r.provider : providerName,
      model: String(r.model || ""),
      reason: String(r.reason || ""),
      system_prompt: String(r.system_prompt || ""),
    })),
    raw: null,
    error: null,
  };
}

// 3社に並列で提案を依頼。キー未設定のプロバイダはスキップ。
async function runWizard(goal) {
  const configured = ["anthropic", "openai", "google"].filter((p) => getKey(p));
  if (configured.length === 0) throw new Error("APIキーが1つも設定されていません");

  // 全社共通のモデルカタログ(提案の材料)
  const catalogParts = [];
  for (const p of configured) {
    const { models } = await listModels(p);
    catalogParts.push(`${p}: ${models.slice(0, 12).map((m) => m.id).join(", ")}`);
  }
  const modelCatalog = catalogParts.join("\n");

  const results = await Promise.allSettled(configured.map((p) => askOne(p, goal, modelCatalog)));
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { provider: configured[i], model: null, roles: [], raw: null, error: String(r.reason?.message || r.reason) }
  );
}

module.exports = { runWizard };
