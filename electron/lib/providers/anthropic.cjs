// Anthropic (Claude) Messages API クライアント。
// プロンプトキャッシュ: system をブロック配列にし、安定部分(役割定義/バイブル)に cache_control を付ける。
const Anthropic = require("@anthropic-ai/sdk");

function client(apiKey) {
  return new Anthropic.Anthropic({ apiKey });
}

// モデル一覧の動的取得(GET /v1/models)。チャット非対応モデルは返らない。
async function listModels(apiKey) {
  const c = client(apiKey);
  const models = [];
  for await (const m of c.models.list()) {
    models.push({ id: m.id, label: m.display_name || m.id, provider: "anthropic" });
  }
  return models;
}

// messages: [{role, content}] / systemText, bibleText は安定文字列
async function sendMessage({ apiKey, model, systemText, bibleText, messages, maxTokens, onDelta, signal }) {
  const c = client(apiKey);
  const systemBlocks = [];
  if (systemText) {
    systemBlocks.push({
      type: "text",
      text: systemText,
      cache_control: { type: "ephemeral" },
    });
  }
  if (bibleText) {
    systemBlocks.push({
      type: "text",
      text: bibleText,
      cache_control: { type: "ephemeral" },
    });
  }

  const stream = c.messages.stream(
    {
      model,
      max_tokens: maxTokens,
      ...(systemBlocks.length ? { system: systemBlocks } : {}),
      messages,
    },
    { signal }
  );

  stream.on("text", (t) => onDelta(t));
  const final = await stream.finalMessage();

  const text = final.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const u = final.usage || {};
  return {
    text,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
    },
    stop_reason: final.stop_reason,
  };
}

module.exports = { listModels, sendMessage };
