// Google (Gemini) 公式APIクライアント (@google/genai)。
const { GoogleGenAI } = require("@google/genai");

function client(apiKey) {
  return new GoogleGenAI({ apiKey });
}

async function listModels(apiKey) {
  const c = client(apiKey);
  const models = [];
  const pager = await c.models.list();
  for await (const m of pager) {
    // チャット対応(generateContent)のみに絞る。SDK/RESTでフィールド名が異なるため両対応。
    const actions = m.supportedActions || m.supportedGenerationMethods || [];
    const ok = Array.isArray(actions) ? actions.includes("generateContent") : true;
    if (!ok) continue;
    const id = (m.name || "").replace(/^models\//, "");
    // チャット用途に不向きなモデル(画像・動画・音楽生成、ロボット、音声専用など)は除外
    if (!id || /embedding|aqa|imagen|veo|tts|image|lyria|banana|robotics|native-audio|live/i.test(id)) continue;
    models.push({ id, label: m.displayName || id, provider: "google" });
  }
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

async function sendMessage({ apiKey, model, systemText, bibleText, messages, maxTokens, onDelta, signal }) {
  const c = client(apiKey);
  const systemParts = [systemText, bibleText].filter(Boolean).join("\n\n");
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const stream = await c.models.generateContentStream({
    model,
    contents,
    config: {
      ...(systemParts ? { systemInstruction: systemParts } : {}),
      maxOutputTokens: maxTokens,
      abortSignal: signal,
    },
  });

  let text = "";
  let usage = null;
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) {
      text += t;
      onDelta(t);
    }
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }

  return {
    text,
    usage: {
      input: usage?.promptTokenCount || 0,
      output: (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0),
      cache_read: usage?.cachedContentTokenCount || 0,
      cache_write: 0,
    },
    stop_reason: null,
  };
}

module.exports = { listModels, sendMessage };
