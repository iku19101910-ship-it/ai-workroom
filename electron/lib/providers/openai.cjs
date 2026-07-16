// OpenAI (GPT) 公式APIクライアント。プロンプトキャッシュは自動(先頭一致)なので順序固定のみ守る。
const OpenAI = require("openai");

function client(apiKey) {
  return new OpenAI.OpenAI({ apiKey });
}

// チャット非対応モデル(埋め込み・音声・画像等)を除外するフィルタ
const EXCLUDE = /embed|tts|whisper|audio|realtime|dall-e|image|moderation|transcribe|davinci|babbage|instruct/i;
const INCLUDE = /^(gpt|o\d|chatgpt)/i;

async function listModels(apiKey) {
  const c = client(apiKey);
  const models = [];
  for await (const m of c.models.list()) {
    if (INCLUDE.test(m.id) && !EXCLUDE.test(m.id)) {
      models.push({ id: m.id, label: m.id, provider: "openai" });
    }
  }
  models.sort((a, b) => b.id.localeCompare(a.id));
  return models;
}

async function sendMessage({ apiKey, model, systemText, bibleText, messages, maxTokens, onDelta, signal }) {
  const c = client(apiKey);
  const systemParts = [systemText, bibleText].filter(Boolean).join("\n\n");
  const fullMessages = [
    ...(systemParts ? [{ role: "system", content: systemParts }] : []),
    ...messages,
  ];

  const stream = await c.chat.completions.create(
    {
      model,
      messages: fullMessages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: maxTokens,
    },
    { signal }
  );

  let text = "";
  let usage = null;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    if (chunk.usage) usage = chunk.usage;
  }

  return {
    text,
    usage: {
      input: usage?.prompt_tokens || 0,
      output: usage?.completion_tokens || 0,
      cache_read: usage?.prompt_tokens_details?.cached_tokens || 0,
      cache_write: 0,
    },
    stop_reason: null,
  };
}

module.exports = { listModels, sendMessage };
