// 生成スタジオ(§4.14)。画像生成を先行実装(仕様: 画像→動画の順に対応)。
// Anthropic APIには画像生成がないため、OpenAI / Google のAPIを使用(§4.12注記)。
// 生成履歴は media/index.json、実体は media/{id}.png に保存(既定: 画像=同期対象)。
const fs = require("fs");
const path = require("path");
const { getKey } = require("./keys.cjs");
const { getAppConfig } = require("./config.cjs");
const { listModels } = require("./models.cjs");

function mediaDir() {
  const root = getAppConfig().workspacePath;
  const dir = path.join(root, "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexFile() {
  return path.join(mediaDir(), "index.json");
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8"));
  } catch {
    return { items: [] };
  }
}

function writeIndex(idx) {
  fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2), "utf8");
}

function newId() {
  return "media_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 生成対応モデルの一覧(画像)。一覧取得に失敗した場合は既知の既定値を返す。
async function listGenModels(providerName) {
  if (providerName === "openai") {
    const key = getKey("openai");
    if (!key) return { models: [], error: "no_key" };
    try {
      const OpenAI = require("openai");
      const c = new OpenAI.OpenAI({ apiKey: key });
      const models = [];
      for await (const m of c.models.list()) {
        if (/gpt-image|dall-e/i.test(m.id)) models.push({ id: m.id, label: m.id, provider: "openai" });
      }
      if (models.length === 0) models.push({ id: "gpt-image-1", label: "gpt-image-1", provider: "openai" });
      models.sort((a, b) => b.id.localeCompare(a.id));
      return { models, error: null };
    } catch (err) {
      return { models: [{ id: "gpt-image-1", label: "gpt-image-1", provider: "openai" }], error: null };
    }
  }
  if (providerName === "google") {
    const key = getKey("google");
    if (!key) return { models: [], error: "no_key" };
    try {
      const { GoogleGenAI } = require("@google/genai");
      const c = new GoogleGenAI({ apiKey: key });
      const models = [];
      const pager = await c.models.list();
      for await (const m of pager) {
        const id = (m.name || "").replace(/^models\//, "");
        if (/imagen/i.test(id)) models.push({ id, label: m.displayName || id, provider: "google" });
      }
      if (models.length === 0)
        models.push({ id: "imagen-3.0-generate-002", label: "imagen-3.0-generate-002", provider: "google" });
      models.sort((a, b) => b.id.localeCompare(a.id));
      return { models, error: null };
    } catch {
      return { models: [{ id: "imagen-3.0-generate-002", label: "imagen-3.0-generate-002", provider: "google" }], error: null };
    }
  }
  return { models: [], error: "画像生成は OpenAI / Google のみ対応です" };
}

async function generateImage({ provider, model, prompt }) {
  let b64 = null;
  if (provider === "openai") {
    const key = getKey("openai");
    if (!key) throw new Error("OpenAIのAPIキーが未設定です");
    const OpenAI = require("openai");
    const c = new OpenAI.OpenAI({ apiKey: key });
    const res = await c.images.generate({ model, prompt, n: 1 });
    b64 = res.data?.[0]?.b64_json;
    if (!b64 && res.data?.[0]?.url) {
      const r = await fetch(res.data[0].url);
      b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    }
  } else if (provider === "google") {
    const key = getKey("google");
    if (!key) throw new Error("GoogleのAPIキーが未設定です");
    const { GoogleGenAI } = require("@google/genai");
    const c = new GoogleGenAI({ apiKey: key });
    const res = await c.models.generateImages({
      model,
      prompt,
      config: { numberOfImages: 1 },
    });
    b64 = res.generatedImages?.[0]?.image?.imageBytes;
  } else {
    throw new Error("画像生成は OpenAI / Google のみ対応です");
  }
  if (!b64) throw new Error("画像データを取得できませんでした");

  const id = newId();
  const file = path.join(mediaDir(), id + ".png");
  fs.writeFileSync(file, Buffer.from(b64, "base64"));

  const idx = readIndex();
  const item = {
    id,
    type: "image",
    provider,
    model,
    prompt,
    file: id + ".png",
    created_at: new Date().toISOString(),
  };
  idx.items.unshift(item);
  writeIndex(idx);
  return { ...item, abs_path: file };
}

function listMedia() {
  const idx = readIndex();
  return idx.items.map((it) => ({ ...it, abs_path: path.join(mediaDir(), it.file) }));
}

function deleteMedia(id) {
  const idx = readIndex();
  const item = idx.items.find((x) => x.id === id);
  idx.items = idx.items.filter((x) => x.id !== id);
  writeIndex(idx);
  if (item) {
    const f = path.join(mediaDir(), item.file);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  return true;
}

module.exports = { listGenModels, generateImage, listMedia, deleteMedia };
