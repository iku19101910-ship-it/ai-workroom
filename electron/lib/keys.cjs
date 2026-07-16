// APIキー保存。Electron safeStorage(Windowsでは資格情報基盤=DPAPIで暗号化)を使い、
// userData 配下に暗号化済みで保存する。同期フォルダ(ワークスペース)には絶対に置かない。
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { atomicWriteFile } = require("./fsutil.cjs");

const PROVIDERS = ["anthropic", "openai", "google"];

function keysPath() {
  return path.join(app.getPath("userData"), "keys.enc.json");
}

function loadRaw() {
  try {
    return JSON.parse(fs.readFileSync(keysPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveRaw(obj) {
  atomicWriteFile(keysPath(), JSON.stringify(obj, null, 2), "utf8");
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function setKey(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new Error("unknown provider: " + provider);
  const raw = loadRaw();
  let stored = null;
  if (encryptionAvailable()) {
    try {
      stored = { enc: safeStorage.encryptString(key).toString("base64") };
    } catch {
      stored = null;
    }
  }
  // 暗号化不可の環境ではローカル平文フォールバック(同期フォルダ外)。UIで警告表示する。
  if (!stored) stored = { plain: key };
  raw[provider] = stored;
  saveRaw(raw);
}

function getKey(provider) {
  const raw = loadRaw();
  const entry = raw[provider];
  if (!entry) return null;
  if (entry.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(entry.enc, "base64"));
    } catch {
      return null;
    }
  }
  return entry.plain ?? null;
}

function deleteKey(provider) {
  const raw = loadRaw();
  delete raw[provider];
  saveRaw(raw);
}

// UI表示用: キー本体は返さず、末尾4文字のみのマスク表示を返す
function listKeysMasked() {
  return PROVIDERS.map((p) => {
    const key = getKey(p);
    return {
      provider: p,
      configured: !!key,
      masked: key ? "••••••••" + key.slice(-4) : null,
      encrypted: encryptionAvailable(),
    };
  });
}

module.exports = { setKey, getKey, deleteKey, listKeysMasked, PROVIDERS };
