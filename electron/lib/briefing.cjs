// 朝ブリーフィング(§4.8)。1日の最初の起動時に、秘書役カードが
// 「タスク一覧+締め切りが近い順+着手推奨コメント」を生成する。軽量モデル使用(§8.4)。
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const ws = require("./workspace.cjs");
const { getKey } = require("./keys.cjs");
const { pickCheapModel, getProvider } = require("./models.cjs");
const { atomicWriteFile } = require("./fsutil.cjs");

function briefingFile() {
  return path.join(app.getPath("userData"), "briefing.json");
}

function loadCached() {
  try {
    return JSON.parse(fs.readFileSync(briefingFile(), "utf8"));
  } catch {
    return null;
  }
}

// 秘書役: on_app_start トリガーのカード優先、なければ名前に「秘書」を含むカード、なければキーのある先頭
function pickSecretary() {
  const cards = ws.listRoleCards();
  return (
    cards.find((c) => (c.triggers || []).includes("on_app_start") && getKey(c.provider)) ||
    cards.find((c) => c.name.includes("秘書") && getKey(c.provider)) ||
    cards.find((c) => getKey(c.provider)) ||
    null
  );
}

async function generate() {
  const tasks = ws.listTasks().filter((t) => t.status === "open");
  if (tasks.length === 0) return { text: null, reason: "no_tasks" };
  const card = pickSecretary();
  if (!card) return { text: null, reason: "no_key" };

  const model = await pickCheapModel(card.provider, card.model);
  if (!model) return { text: null, reason: "no_model" };
  const provider = getProvider(card.provider);
  const today = new Date().toISOString().slice(0, 10);

  const taskList = tasks
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
    .map((t) => `- ${t.title}(期限: ${t.due_date || "未設定"})`)
    .join("\n");

  const result = await provider.sendMessage({
    apiKey: getKey(card.provider),
    model,
    systemText:
      "あなたは有能な秘書です。ユーザーの1日の始まりに、タスクの状況を簡潔にブリーフィングしてください。",
    bibleText: "",
    messages: [
      {
        role: "user",
        content: `今日は ${today} です。以下が現在のタスク一覧です。締め切りが近い順に整理し、今日どれから着手すべきかの推奨コメントを添えて、簡潔な朝ブリーフィングを作成してください。\n\n${taskList}`,
      },
    ],
    maxTokens: 1024,
    onDelta: () => {},
  });

  ws.recordUsage({
    role_card_id: card.id,
    provider: card.provider,
    model,
    input: result.usage.input,
    output: result.usage.output,
    cache_read: result.usage.cache_read,
    cache_write: result.usage.cache_write,
  });

  return { text: result.text, reason: null, cardName: card.name };
}

// 今日のブリーフィングを取得(未生成なら生成してキャッシュ)。force で作り直し。
async function getTodayBriefing({ force = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const cached = loadCached();
  if (!force && cached && cached.date === today) return cached;
  try {
    const r = await generate();
    const entry = { date: today, text: r.text, reason: r.reason, cardName: r.cardName || null };
    atomicWriteFile(briefingFile(), JSON.stringify(entry), "utf8");
    return entry;
  } catch (err) {
    return { date: today, text: null, reason: String(err?.message || err) };
  }
}

module.exports = { getTodayBriefing };
