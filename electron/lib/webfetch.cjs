// Web取得(§4.9)。ユーザーが明示したURLのみ取得。クロールはしない。
// - robots.txt を尊重(User-agent:* の Disallow を確認)
// - 取得結果はローカルにキャッシュし、同一ページの重複取得を避ける(複数カードへの配布用)
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteFile } = require("./fsutil.cjs");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const MAX_TEXT_LEN = 20000;

function cacheDir() {
  const dir = path.join(app.getPath("userData"), "cache", "web");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheFile(url) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  return path.join(cacheDir(), hash + ".json");
}

function extractUrls(text) {
  const m = text.match(/https?:\/\/[^\s<>"'()]+/g) || [];
  return [...new Set(m)].slice(0, 3); // 最大3件
}

// robots.txt の User-agent:* セクションの Disallow を素朴に判定
async function isAllowedByRobots(url) {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return true; // robots.txt が無い場合は許可扱い
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let applies = false;
    const disallows = [];
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      const k = key.toLowerCase().trim();
      if (k === "user-agent") {
        applies = value === "*";
      } else if (applies && k === "disallow" && value) {
        disallows.push(value);
      }
    }
    return !disallows.some((d) => u.pathname.startsWith(d));
  } catch {
    return true; // 判定不能時は取得を許可(タイムアウト等)
  }
}

function htmlToText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  t = t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return t.slice(0, MAX_TEXT_LEN);
}

async function fetchUrl(url) {
  // キャッシュ確認(1回取得の原則)
  const file = cacheFile(url);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - cached.fetched_at < CACHE_TTL_MS) return cached;
  } catch {}

  if (!(await isAllowedByRobots(url))) {
    return { url, error: "robots.txtにより取得が許可されていません", text: null, fetched_at: Date.now() };
  }
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "AI-Workroom/0.1 (personal desktop app)" },
    });
    if (!res.ok) {
      return { url, error: `HTTP ${res.status}`, text: null, fetched_at: Date.now() };
    }
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    const text = /html/i.test(ct) ? htmlToText(body) : body.slice(0, MAX_TEXT_LEN);
    const entry = { url, error: null, text, fetched_at: Date.now() };
    atomicWriteFile(file, JSON.stringify(entry), "utf8");
    return entry;
  } catch (err) {
    return { url, error: String(err?.message || err), text: null, fetched_at: Date.now() };
  }
}

// メッセージ本文からURLを取り出して取得し、プロンプト注入用テキストを返す
async function buildWebContext(text) {
  const urls = extractUrls(text);
  if (urls.length === 0) return null;
  const results = [];
  for (const url of urls) {
    const r = await fetchUrl(url);
    if (r.text) {
      results.push(`### 取得したページ: ${url}\n${r.text}`);
    } else {
      results.push(`### 取得失敗: ${url}(${r.error})`);
    }
  }
  return results.join("\n\n");
}

module.exports = { buildWebContext, extractUrls, fetchUrl };
