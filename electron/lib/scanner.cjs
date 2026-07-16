// 締め切り検知(§4.6)。指定フォルダを定期スキャンし、新規・更新された PDF/PPTX/DOCX から
// テキストを抽出、軽量モデル(§8.4)で「日付+行動を要する記述」をJSON抽出させる。
// 検知結果は候補(task_suggestions)として保存し、確認UIを必ず挟む(自動登録しない)。
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const ws = require("./workspace.cjs");
const { getKey } = require("./keys.cjs");
const { pickCheapModel, getProvider } = require("./models.cjs");
const { extractText, SUPPORTED_EXTS } = require("./extract.cjs");
const { notifyAll } = require("./notify.cjs");

function stateFile() {
  return path.join(app.getPath("userData"), "scan_state.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { files: {}, last_scan: 0 };
  }
}

function saveState(s) {
  fs.writeFileSync(stateFile(), JSON.stringify(s), "utf8");
}

function walkFiles(dir, depth = 0, out = []) {
  if (depth > 3) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name.startsWith("~$")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, depth + 1, out);
    else if (SUPPORTED_EXTS.includes(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

// 検知に使うプロバイダ: on_folder_scan トリガーのカード優先、なければキー設定済みの先頭
function pickDetector() {
  const cards = ws.listRoleCards();
  const trig = cards.find((c) => (c.triggers || []).includes("on_folder_scan") && getKey(c.provider));
  if (trig) return { provider: trig.provider, fallbackModel: trig.model, cardId: trig.id };
  for (const p of ["anthropic", "google", "openai"]) {
    if (getKey(p)) {
      const card = cards.find((c) => c.provider === p);
      return { provider: p, fallbackModel: card?.model || "", cardId: card?.id || "system_scan" };
    }
  }
  return null;
}

function parseJsonArray(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end < 0) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function detectDeadlines(fileName, text) {
  const det = pickDetector();
  if (!det) return { error: "APIキーが未設定のため検知できません", items: [] };
  const model = await pickCheapModel(det.provider, det.fallbackModel);
  if (!model) return { error: "検知用モデルを解決できません", items: [] };
  const provider = getProvider(det.provider);
  const today = new Date().toISOString().slice(0, 10);

  const prompt = [
    `今日は ${today} です。以下は「${fileName}」というファイルから抽出したテキストです。`,
    "この中から「提出・締め切り・試験・発表など、日付が決まっていて行動を要する記述」をすべて抽出し、次のJSON配列のみで出力してください。該当がなければ [] を出力してください。",
    '[{"date":"YYYY-MM-DD","task":"何をするか(簡潔に)","confidence":0.0〜1.0,"quote":"根拠となる原文の引用(短く)"}]',
    "注意: 年が書かれていない日付は、今日以降で最も近い年と解釈すること。過去の日付は含めないこと。",
    "",
    "----",
    text,
  ].join("\n");

  const result = await provider.sendMessage({
    apiKey: getKey(det.provider),
    model,
    systemText: "あなたは書類から締め切りを抽出する秘書です。指定されたJSON形式のみで出力してください。",
    bibleText: "",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2048,
    onDelta: () => {},
  });

  ws.recordUsage({
    role_card_id: det.cardId,
    provider: det.provider,
    model,
    input: result.usage.input,
    output: result.usage.output,
    cache_read: result.usage.cache_read,
    cache_write: result.usage.cache_write,
  });

  const items = parseJsonArray(result.text)
    .filter((x) => x && x.date && x.task)
    .map((x) => ({
      title: String(x.task).slice(0, 120),
      due_date: String(x.date).slice(0, 10),
      confidence: typeof x.confidence === "number" ? x.confidence : 0.5,
      file: fileName,
      excerpt: String(x.quote || "").slice(0, 300),
    }));
  return { error: null, items };
}

let scanning = false;

async function scanNow(emit, { manual = false } = {}) {
  if (scanning) return { skipped: true };
  scanning = true;
  try {
    const settings = ws.getSettings();
    const folders = settings.scan.folders || [];
    if (folders.length === 0) return { scanned: 0, detected: 0, error: manual ? "スキャン対象フォルダが未設定です(設定画面で追加)" : null };

    const state = loadState();
    const targets = [];
    for (const folder of folders) {
      for (const file of walkFiles(folder)) {
        let mtime;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        if (state.files[file] !== mtime) targets.push({ file, mtime });
      }
    }

    let detected = 0;
    for (const { file, mtime } of targets) {
      if (emit) emit("scan:progress", { file: path.basename(file) });
      try {
        const text = await extractText(file);
        if (text.length > 30) {
          const { items } = await detectDeadlines(path.basename(file), text);
          if (items.length > 0) {
            const added = ws.addSuggestions(items);
            detected += added.length;
          }
        }
        state.files[file] = mtime; // 成功時のみ既読化
      } catch (err) {
        state.files[file] = mtime; // 壊れたファイルの再試行ループを防ぐ
        if (emit) emit("scan:file-error", { file: path.basename(file), error: String(err?.message || err) });
      }
    }

    state.last_scan = Date.now();
    saveState(state);

    if (detected > 0) {
      notifyAll({
        title: "AI作業場: 締め切り候補を検知",
        body: `${detected}件の締め切り候補が見つかりました。タスク画面で確認してください。`,
      });
      if (emit) emit("scan:detected", { count: detected });
    }
    return { scanned: targets.length, detected, error: null };
  } finally {
    scanning = false;
  }
}

// 定期スキャン(間隔は設定から。1分ごとに経過確認)
let timer = null;
function startScheduler(emit) {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const settings = ws.getSettings();
      if ((settings.scan.folders || []).length === 0) return;
      const interval = (settings.scan.interval_minutes || 30) * 60 * 1000;
      if (Date.now() - loadState().last_scan >= interval) {
        await scanNow(emit);
      }
    } catch {}
  }, 60 * 1000);
}

module.exports = { scanNow, startScheduler };
