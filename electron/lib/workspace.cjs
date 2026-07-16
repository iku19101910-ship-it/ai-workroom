// ワークスペース(同期フォルダ)の読み書き。仕様書§6のファイル構成に従う。
// 会話は1件1ファイル、usageは月別ファイル(同期衝突の最小化のため)。
const fs = require("fs");
const path = require("path");
const { getAppConfig } = require("./config.cjs");

function wsRoot() {
  const p = getAppConfig().workspacePath;
  if (!p) throw new Error("ワークスペースが未設定です");
  return p;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

function newId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

const DEFAULT_SETTINGS = {
  theme: {
    mode: "light",
    background: {
      type: "none",
      path: "",
      dim: 0.4,
      dim_color: "auto",
      panel_opacity: 0.85,
      panel_blur: true,
      pause_video_on_battery: true,
    },
  },
  scan: { folders: [], interval_minutes: 30 },
  usage_prices: {},
  chat: { history_pairs: 10, max_tokens: 4096 },
};

// ---- 初期化 ----
function initWorkspace() {
  const root = wsRoot();
  fs.mkdirSync(root, { recursive: true });
  for (const dir of ["role_cards", "shared_memory", "conversations", "pipelines", "media", "usage"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const settingsFile = path.join(root, "settings.json");
  if (!fs.existsSync(settingsFile)) writeJson(settingsFile, DEFAULT_SETTINGS);
  const tasksFile = path.join(root, "tasks.json");
  if (!fs.existsSync(tasksFile)) writeJson(tasksFile, { tasks: [] });
  const smIndex = path.join(root, "shared_memory", "index.json");
  if (!fs.existsSync(smIndex)) writeJson(smIndex, { docs: [] });
  const convIndex = path.join(root, "conversations", "index.json");
  if (!fs.existsSync(convIndex)) writeJson(convIndex, { conversations: [] });
  return true;
}

// 例示用の役割カードを初回のみ投入(ユーザーが削除したら復活させない)
const EXAMPLE_CARDS = [
  {
    name: "執筆担当",
    provider: "anthropic",
    system_prompt:
      "あなたは小説の執筆担当です。ユーザーの指示とプロットに従って、情景描写と会話のバランスが取れた日本語の小説本文を書いてください。文体は依頼に合わせ、設定を勝手に追加しないでください。実行に必要な情報が不足している場合は、推測で補完せず質問してください。",
  },
  {
    name: "整合性チェック",
    provider: "openai",
    system_prompt:
      "あなたは小説の整合性チェック担当です。渡された本文について、設定・時系列・人物の言動の矛盾を洗い出し、箇条書きで指摘してください。各指摘には該当箇所の引用と簡潔な修正案を添えてください。本文の書き直しは、求められない限り行わないでください。",
  },
  {
    name: "秘書役",
    provider: "google",
    system_prompt:
      "あなたは有能な秘書です。予定やタスクの整理、文章の要約、アイデアの壁打ちなどを簡潔にサポートしてください。回答は要点から先に述べ、必要以上に長くしないでください。",
  },
];

function seedExampleCards() {
  const settings = getSettings();
  if (settings.examples_seeded) return false;
  if (listRoleCards().length === 0) {
    for (const c of EXAMPLE_CARDS) saveRoleCard({ ...c });
  }
  updateSettings({ examples_seeded: true });
  return true;
}

// ---- 設定 ----
function getSettings() {
  const s = readJson(path.join(wsRoot(), "settings.json"), DEFAULT_SETTINGS);
  // 欠けたキーはデフォルトで補完(後方互換)
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    theme: { ...DEFAULT_SETTINGS.theme, ...(s.theme || {}), background: { ...DEFAULT_SETTINGS.theme.background, ...((s.theme || {}).background || {}) } },
    scan: { ...DEFAULT_SETTINGS.scan, ...(s.scan || {}) },
    chat: { ...DEFAULT_SETTINGS.chat, ...(s.chat || {}) },
  };
}

function updateSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  writeJson(path.join(wsRoot(), "settings.json"), next);
  return next;
}

// ---- 役割カード ----
function listRoleCards() {
  const dir = path.join(wsRoot(), "role_cards");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

function saveRoleCard(card) {
  const now = new Date().toISOString();
  if (!card.id) card.id = newId("rc");
  if (!card.created_at) card.created_at = now;
  card.updated_at = now;
  const full = {
    id: card.id,
    name: card.name || "無名カード",
    provider: card.provider || "anthropic",
    model: card.model || "",
    system_prompt: card.system_prompt || "",
    shared_memory_refs: card.shared_memory_refs || [],
    color: card.color ?? null,
    tools: card.tools || { web_fetch: false, folder_scan: false },
    triggers: card.triggers || [],
    created_at: card.created_at,
    updated_at: card.updated_at,
  };
  writeJson(path.join(wsRoot(), "role_cards", full.id + ".json"), full);
  return full;
}

function deleteRoleCard(id) {
  const file = path.join(wsRoot(), "role_cards", id + ".json");
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

function getRoleCard(id) {
  return readJson(path.join(wsRoot(), "role_cards", id + ".json"), null);
}

// ---- 共有バイブル(共有メモリ) ----
function smIndexFile() {
  return path.join(wsRoot(), "shared_memory", "index.json");
}

function listSharedDocs() {
  return readJson(smIndexFile(), { docs: [] }).docs;
}

function getSharedDoc(id) {
  const meta = listSharedDocs().find((d) => d.id === id);
  if (!meta) return null;
  const content = (() => {
    try {
      return fs.readFileSync(path.join(wsRoot(), "shared_memory", id + ".md"), "utf8");
    } catch {
      return "";
    }
  })();
  return { ...meta, content };
}

function saveSharedDoc(doc) {
  const now = new Date().toISOString();
  const idx = readJson(smIndexFile(), { docs: [] });
  if (!doc.id) doc.id = newId("sm");
  const meta = { id: doc.id, title: doc.title || "無題", updated_at: now };
  const pos = idx.docs.findIndex((d) => d.id === doc.id);
  if (pos >= 0) idx.docs[pos] = { ...idx.docs[pos], ...meta };
  else idx.docs.push({ ...meta, created_at: now });
  writeJson(smIndexFile(), idx);
  fs.writeFileSync(path.join(wsRoot(), "shared_memory", doc.id + ".md"), doc.content || "", "utf8");
  return getSharedDoc(doc.id);
}

function deleteSharedDoc(id) {
  const idx = readJson(smIndexFile(), { docs: [] });
  idx.docs = idx.docs.filter((d) => d.id !== id);
  writeJson(smIndexFile(), idx);
  const file = path.join(wsRoot(), "shared_memory", id + ".md");
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

// ---- 会話(メッセージはツリー構造 §4.5/§6.2) ----
function convIndexFile() {
  return path.join(wsRoot(), "conversations", "index.json");
}

function listConversations() {
  return readJson(convIndexFile(), { conversations: [] }).conversations.sort(
    (a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")
  );
}

function convFile(id) {
  return path.join(wsRoot(), "conversations", id + ".json");
}

function getConversation(id) {
  return readJson(convFile(id), null);
}

function createConversation(title) {
  const now = new Date().toISOString();
  const conv = {
    id: newId("conv"),
    title: title || "新しい会話",
    active_leaf_id: null,
    messages: [],
    created_at: now,
    updated_at: now,
  };
  writeJson(convFile(conv.id), conv);
  const idx = readJson(convIndexFile(), { conversations: [] });
  idx.conversations.push({ id: conv.id, title: conv.title, created_at: now, updated_at: now });
  writeJson(convIndexFile(), idx);
  return conv;
}

function touchConvIndex(conv) {
  const idx = readJson(convIndexFile(), { conversations: [] });
  const pos = idx.conversations.findIndex((c) => c.id === conv.id);
  const meta = { id: conv.id, title: conv.title, created_at: conv.created_at, updated_at: conv.updated_at };
  if (pos >= 0) idx.conversations[pos] = meta;
  else idx.conversations.push(meta);
  writeJson(convIndexFile(), idx);
}

function saveConversation(conv) {
  conv.updated_at = new Date().toISOString();
  writeJson(convFile(conv.id), conv);
  touchConvIndex(conv);
  return conv;
}

// メッセージ追加(parent_id方式)。active_leaf_id を新メッセージに付け替える。
function appendMessage(convId, msg) {
  const conv = getConversation(convId);
  if (!conv) throw new Error("会話が見つかりません: " + convId);
  const full = {
    id: newId("msg"),
    parent_id: msg.parent_id !== undefined ? msg.parent_id : conv.active_leaf_id ?? null,
    author: msg.author,
    role_card_id: msg.role_card_id ?? null,
    model_override: msg.model_override ?? null,
    model: msg.model ?? null,
    content: msg.content ?? "",
    tokens: msg.tokens ?? null,
    error: msg.error ?? null,
    clarification: msg.clarification ?? null,
    created_at: new Date().toISOString(),
  };
  conv.messages.push(full);
  conv.active_leaf_id = full.id;
  saveConversation(conv);
  return full;
}

function updateMessage(convId, msgId, patch) {
  const conv = getConversation(convId);
  if (!conv) throw new Error("会話が見つかりません: " + convId);
  const m = conv.messages.find((x) => x.id === msgId);
  if (!m) throw new Error("メッセージが見つかりません: " + msgId);
  Object.assign(m, patch);
  saveConversation(conv);
  return m;
}

// 履歴要約のキャッシュ(§8.2: 毎回作り直さない)
function setSummaryCache(convId, cache) {
  const conv = getConversation(convId);
  conv.summary_cache = cache;
  saveConversation(conv);
  return conv;
}

function setActiveLeaf(convId, msgId) {
  const conv = getConversation(convId);
  conv.active_leaf_id = msgId;
  saveConversation(conv);
  return conv;
}

function renameConversation(convId, title) {
  const conv = getConversation(convId);
  conv.title = title;
  saveConversation(conv);
  return conv;
}

function deleteConversation(convId) {
  const idx = readJson(convIndexFile(), { conversations: [] });
  idx.conversations = idx.conversations.filter((c) => c.id !== convId);
  writeJson(convIndexFile(), idx);
  const file = convFile(convId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

// 本線復元: active_leaf_id から parent_id を根まで辿る
function mainlineMessages(conv) {
  const byId = new Map(conv.messages.map((m) => [m.id, m]));
  const line = [];
  let cur = conv.active_leaf_id ? byId.get(conv.active_leaf_id) : null;
  while (cur) {
    line.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return line;
}

// ---- 成果物保管庫(Artifacts)。AIが作った資料・コード等の完成品を保管する場所。
// AIのプロンプトには注入しない(共有バイブルとは別物)。本文は {id}.md の普通のファイルとして
// 保存するので、エクスプローラーからも直接開ける。 ----
function artifactsDir() {
  const dir = path.join(wsRoot(), "artifacts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function artifactsIndexFile() {
  return path.join(artifactsDir(), "index.json");
}

// 保存元の文脈(会話タイトル+その応答を生んだユーザー指示の冒頭)を導出する。
// 保存時にスナップショットするので、後で会話が削除されても保管庫側に残る。
function deriveArtifactContext(conversationId, messageId) {
  if (!conversationId || !messageId) return null;
  const conv = getConversation(conversationId);
  if (!conv) return null;
  const byId = new Map(conv.messages.map((m) => [m.id, m]));
  let cur = byId.get(messageId);
  // 保存対象(アシスタント)から親を辿り、直近のユーザーメッセージを探す
  while (cur && cur.author !== "user") {
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  const promptLine = cur ? (cur.content || "").split("\n")[0].trim() : "";
  return {
    conversation_title: conv.title || "",
    prompt_excerpt: promptLine.length > 60 ? promptLine.slice(0, 60) + "…" : promptLine,
  };
}

function listArtifacts() {
  const idx = readJson(artifactsIndexFile(), { items: [] });
  // 旧データ移行: context 未記録で会話情報があるものは、その場で解決して保存
  let dirty = false;
  for (const meta of idx.items) {
    if (meta.context === undefined && meta.conversation_id) {
      meta.context = deriveArtifactContext(meta.conversation_id, meta.message_id);
      dirty = true;
    }
  }
  if (dirty) writeJson(artifactsIndexFile(), idx);
  return idx.items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

function getArtifact(id) {
  const meta = listArtifacts().find((a) => a.id === id);
  if (!meta) return null;
  let content = "";
  try {
    content = fs.readFileSync(path.join(artifactsDir(), meta.file), "utf8");
  } catch {}
  return { ...meta, content };
}

function saveArtifact(art) {
  const idx = readJson(artifactsIndexFile(), { items: [] });
  const now = new Date().toISOString();
  if (!art.id) {
    art.id = newId("art");
    const meta = {
      id: art.id,
      title: art.title || "無題の成果物",
      tags: Array.isArray(art.tags) ? art.tags.filter(Boolean) : [],
      provider: art.provider || null,
      model: art.model || null,
      role_card_id: art.role_card_id || null,
      card_name: art.card_name || null,
      conversation_id: art.conversation_id || null,
      message_id: art.message_id || null,
      context: deriveArtifactContext(art.conversation_id, art.message_id),
      file: art.id + ".md",
      created_at: now,
      updated_at: now,
    };
    idx.items.push(meta);
    fs.writeFileSync(path.join(artifactsDir(), meta.file), art.content || "", "utf8");
    writeJson(artifactsIndexFile(), idx);
    return meta;
  }
  // 既存の更新(タイトル・タグ・本文)
  const pos = idx.items.findIndex((a) => a.id === art.id);
  if (pos < 0) throw new Error("成果物が見つかりません: " + art.id);
  const meta = idx.items[pos];
  if (art.title !== undefined) meta.title = art.title;
  if (art.tags !== undefined) meta.tags = art.tags.filter(Boolean);
  meta.updated_at = now;
  if (art.content !== undefined) {
    fs.writeFileSync(path.join(artifactsDir(), meta.file), art.content, "utf8");
  }
  idx.items[pos] = meta;
  writeJson(artifactsIndexFile(), idx);
  return meta;
}

function deleteArtifact(id) {
  const idx = readJson(artifactsIndexFile(), { items: [] });
  const meta = idx.items.find((a) => a.id === id);
  idx.items = idx.items.filter((a) => a.id !== id);
  writeJson(artifactsIndexFile(), idx);
  if (meta) {
    const f = path.join(artifactsDir(), meta.file);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  return true;
}

// キーワード検索(タイトル・タグ・本文を対象)。ヒットしたメタ一覧を返す。
function searchArtifacts(query) {
  const q = (query || "").trim().toLowerCase();
  const items = listArtifacts();
  if (!q) return items;
  return items.filter((meta) => {
    if (meta.title.toLowerCase().includes(q)) return true;
    if ((meta.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
    try {
      const content = fs.readFileSync(path.join(artifactsDir(), meta.file), "utf8");
      return content.toLowerCase().includes(q);
    } catch {
      return false;
    }
  });
}

function artifactAbsPath(id) {
  const meta = listArtifacts().find((a) => a.id === id);
  return meta ? path.join(artifactsDir(), meta.file) : null;
}

// ---- タスク(§4.6)。tasks.json は確定タスクのみ(仕様スキーマ準拠)。
// 検知候補(確認待ち)は task_suggestions.json に分離し、確認UIを必ず挟む。 ----
function tasksFile() {
  return path.join(wsRoot(), "tasks.json");
}

function listTasks() {
  return readJson(tasksFile(), { tasks: [] }).tasks;
}

function saveTask(task) {
  const data = readJson(tasksFile(), { tasks: [] });
  if (!task.id) {
    task.id = newId("task");
    task.created_at = new Date().toISOString();
    data.tasks.push(task);
  } else {
    const pos = data.tasks.findIndex((t) => t.id === task.id);
    if (pos >= 0) data.tasks[pos] = { ...data.tasks[pos], ...task };
    else data.tasks.push(task);
  }
  writeJson(tasksFile(), data);
  return task;
}

function deleteTask(id) {
  const data = readJson(tasksFile(), { tasks: [] });
  data.tasks = data.tasks.filter((t) => t.id !== id);
  writeJson(tasksFile(), data);
  return true;
}

function suggestionsFile() {
  return path.join(wsRoot(), "task_suggestions.json");
}

function listSuggestions() {
  return readJson(suggestionsFile(), { suggestions: [] }).suggestions;
}

function addSuggestions(items) {
  const data = readJson(suggestionsFile(), { suggestions: [] });
  const tasks = listTasks();
  const suggestionKeys = new Set(
    data.suggestions.map((x) => `${x.file}\u0000${x.due_date}\u0000${x.title}`)
  );
  const taskKeys = new Set(
    tasks
      .filter((t) => t.source?.file)
      .map((t) => `${t.source.file}\u0000${t.due_date}\u0000${t.title}`)
  );
  const added = [];
  for (const s of items) {
    // 同一ファイル・同一日付・同一内容の重複候補は追加しない
    const key = `${s.file}\u0000${s.due_date}\u0000${s.title}`;
    if (suggestionKeys.has(key) || taskKeys.has(key)) continue;
    const full = { id: newId("sug"), created_at: new Date().toISOString(), ...s };
    data.suggestions.push(full);
    suggestionKeys.add(key);
    added.push(full);
  }
  writeJson(suggestionsFile(), data);
  return added;
}

// 確認UI: 追加(→tasks.json) or 無視(候補から削除するが、無視記録は残して再検知を防ぐ)
function resolveSuggestion(id, accept) {
  const data = readJson(suggestionsFile(), { suggestions: [] });
  const s = data.suggestions.find((x) => x.id === id);
  if (!s) return null;
  data.suggestions = data.suggestions.filter((x) => x.id !== id);
  writeJson(suggestionsFile(), data);
  if (accept) {
    return saveTask({
      id: null,
      title: s.title,
      due_date: s.due_date,
      status: "open",
      source: {
        type: "detected",
        file: s.file,
        excerpt: s.excerpt,
        confidence: s.confidence,
        confirmed_by_user: true,
      },
      completed_at: null,
    });
  } else {
    // 無視済みとしてタスクに記録(status: ignored)し、同じ候補の再提示を防ぐ
    return saveTask({
      id: null,
      title: s.title,
      due_date: s.due_date,
      status: "ignored",
      source: {
        type: "detected",
        file: s.file,
        excerpt: s.excerpt,
        confidence: s.confidence,
        confirmed_by_user: true,
      },
      completed_at: null,
    });
  }
}

// ---- パイプライン(§4.4) ----
function listPipelines() {
  const dir = path.join(wsRoot(), "pipelines");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

function getPipeline(id) {
  return readJson(path.join(wsRoot(), "pipelines", id + ".json"), null);
}

function savePipeline(pl) {
  const now = new Date().toISOString();
  if (!pl.id) pl.id = newId("pl");
  if (!pl.created_at) pl.created_at = now;
  const full = {
    id: pl.id,
    name: pl.name || "無名パイプライン",
    allow_clarification: pl.allow_clarification !== false,
    steps: (pl.steps || []).map((s) => ({
      role_card_id: s.role_card_id,
      input_from: s.input_from || "previous",
      instruction: s.instruction || "",
    })),
    created_at: pl.created_at,
    updated_at: now,
  };
  writeJson(path.join(wsRoot(), "pipelines", full.id + ".json"), full);
  return full;
}

function deletePipeline(id) {
  const file = path.join(wsRoot(), "pipelines", id + ".json");
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

// ---- トークン記録(usage/{YYYY-MM}.json、日×カード×モデルで集約) ----
function usageFile(ym) {
  return path.join(wsRoot(), "usage", ym + ".json");
}

function recordUsage({ role_card_id, provider, model, input, output, cache_read = 0, cache_write = 0 }) {
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const date = now.toISOString().slice(0, 10);
  const data = readJson(usageFile(ym), { records: [] });
  const rec = data.records.find(
    (r) => r.date === date && r.role_card_id === role_card_id && r.model === model
  );
  if (rec) {
    rec.input += input;
    rec.output += output;
    rec.cache_read = (rec.cache_read || 0) + cache_read;
    rec.cache_write = (rec.cache_write || 0) + cache_write;
    rec.count += 1;
    if (provider && !rec.provider) rec.provider = provider;
  } else {
    data.records.push({ date, role_card_id, provider: provider || null, model, input, output, cache_read, cache_write, count: 1 });
  }
  writeJson(usageFile(ym), data);
}

function getUsage(ym) {
  return readJson(usageFile(ym), { records: [] });
}

function listUsageMonths() {
  const dir = path.join(wsRoot(), "usage");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
}

module.exports = {
  initWorkspace,
  seedExampleCards,
  getSettings,
  updateSettings,
  listRoleCards,
  saveRoleCard,
  deleteRoleCard,
  getRoleCard,
  listSharedDocs,
  getSharedDoc,
  saveSharedDoc,
  deleteSharedDoc,
  listConversations,
  getConversation,
  createConversation,
  appendMessage,
  updateMessage,
  setSummaryCache,
  setActiveLeaf,
  renameConversation,
  deleteConversation,
  mainlineMessages,
  listPipelines,
  getPipeline,
  savePipeline,
  deletePipeline,
  listArtifacts,
  getArtifact,
  saveArtifact,
  deleteArtifact,
  searchArtifacts,
  artifactAbsPath,
  listTasks,
  saveTask,
  deleteTask,
  listSuggestions,
  addSuggestions,
  resolveSuggestion,
  recordUsage,
  getUsage,
  listUsageMonths,
};
