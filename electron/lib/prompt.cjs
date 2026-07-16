// プロンプト組み立て(§8.1 プロンプトキャッシュ最優先)。
// 構成順序を固定: ①システムプロンプト(役割定義+共通規約) → ②共有バイブル → ③会話履歴(要約+直近原文) → ④最新入力。
// ①②はタイムスタンプ等を含めず毎回同一内容に正規化し、キャッシュの先頭一致に乗せる。
const { getSharedDoc, mainlineMessages } = require("./workspace.cjs");

// §8.3 差分出力規約(全役割カード共通で注入)
const DIFF_RULE =
  "- 既存のコード・文書の修正を指示された場合、全文を再出力せず、変更箇所のみを「変更前→変更後」の形式で示すこと。全文が必要な場合はユーザーが明示的に要求する。";

// §4.16 確認質問プロトコル(通常モード)
const CLARIFICATION_RULE = [
  "- 実行に必要な情報が不足または曖昧な場合、推測で補完せず、次のJSON形式のみで質問を返すこと(前後に他のテキストを付けない):",
  '  {"type":"clarification","questions":[{"text":"質問文","options":["選択肢1","選択肢2"],"allow_free_text":true}]}',
  "  ※ options は任意。自由入力で良い場合は options を省略し allow_free_text を true にする。",
].join("\n");

// §4.16 パイプラインで allow_clarification=false のときの差し替え規約
const NO_CLARIFICATION_RULE =
  "- 情報が不足または曖昧な場合でも実行を止めず、不明点は保留事項として出力の末尾に「【保留事項】」として箇条書きで列挙すること。";

function normalize(text) {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

// カードのシステムプロンプト+共通規約(毎回同一内容)
// mode: "normal"(確認質問あり) | "no_clarification"(保留列挙)
function buildSystemText(card, mode = "normal") {
  const parts = [];
  const sp = normalize(card.system_prompt);
  if (sp) parts.push(sp);
  const rules = ["## 共通規約", DIFF_RULE];
  rules.push(mode === "no_clarification" ? NO_CLARIFICATION_RULE : CLARIFICATION_RULE);
  parts.push(rules.join("\n"));
  return parts.join("\n\n");
}

// 共有バイブル(shared_memory_refs の登録順で連結、毎回同一)
function buildBibleText(card) {
  const refs = card.shared_memory_refs || [];
  const sections = [];
  for (const id of refs) {
    const doc = getSharedDoc(id);
    if (!doc) continue;
    sections.push(`## 共有資料: ${normalize(doc.title)}\n\n${normalize(doc.content)}`);
  }
  return sections.join("\n\n");
}

// 本線の有効メッセージ(エラー・空を除く)
function mainlineForPrompt(conv) {
  return mainlineMessages(conv).filter((m) => !m.error && m.content);
}

// 会話履歴の窓分割(§8.2)。
// 返り値: { old: 要約対象の古い区間, recent: 原文のまま送る直近区間 }
// summary_cache が boundary までをカバーしていれば old はその続き以降が recent に含まれる。
function splitHistory(conv, historyPairs) {
  const line = mainlineForPrompt(conv);
  const maxRecent = historyPairs * 2;
  if (line.length <= maxRecent) {
    return { line, old: [], recent: line, needsSummary: false };
  }
  return {
    line,
    old: line.slice(0, line.length - maxRecent),
    recent: line.slice(line.length - maxRecent),
    needsSummary: true,
  };
}

function toApiMessages(msgs) {
  return msgs.map((m) => ({
    role: m.author === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

// §4.16: 応答がclarification JSONかを判定(フェイルセーフ: 失敗時はnull)
function tryParseClarification(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) return null;
  try {
    const obj = JSON.parse(t);
    if (
      obj &&
      obj.type === "clarification" &&
      Array.isArray(obj.questions) &&
      obj.questions.length > 0 &&
      obj.questions.every((q) => typeof q.text === "string")
    ) {
      return {
        type: "clarification",
        questions: obj.questions.map((q) => ({
          text: q.text,
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          allow_free_text: q.allow_free_text !== false,
        })),
      };
    }
  } catch {
    return null;
  }
  return null;
}

module.exports = {
  buildSystemText,
  buildBibleText,
  splitHistory,
  toApiMessages,
  mainlineForPrompt,
  tryParseClarification,
};
