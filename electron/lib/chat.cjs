// チャット実行オーケストレーション。
// ユーザーメッセージ追記 → プロンプト組み立て(§8.1順序) → プロバイダ呼び出し(ストリーミング)
// → アシスタントメッセージ追記 → トークン記録(§4.11)。
// §8.2 履歴の窓+要約圧縮、§4.9 Web取得、§4.16 確認質問プロトコル対応。
const { getKey } = require("./keys.cjs");
const ws = require("./workspace.cjs");
const {
  buildSystemText,
  buildBibleText,
  splitHistory,
  toApiMessages,
  tryParseClarification,
} = require("./prompt.cjs");
const { listModels, pickCheapModel, getProvider } = require("./models.cjs");
const { buildWebContext } = require("./webfetch.cjs");

// 実行中リクエストの中断用
const activeControllers = new Map();

// ---- §8.2 履歴要約(軽量モデルで生成し会話ファイルにキャッシュ) ----
const SUMMARY_REGEN_MARGIN = 6; // 古い区間がこの件数以上伸びたら再生成

async function summarizeOld(card, apiKey, oldMsgs, signal) {
  const model = await pickCheapModel(card.provider, card.model);
  const provider = getProvider(card.provider);
  const transcript = oldMsgs
    .map((m) => `${m.author === "user" ? "ユーザー" : "AI"}: ${m.content}`)
    .join("\n\n");
  const result = await provider.sendMessage({
    apiKey,
    model,
    systemText:
      "あなたは会話履歴の要約担当です。以下の会話を、決定事項・設定・固有名詞・未解決の論点が失われないように日本語で簡潔に要約してください。共有資料に書かれている内容と重複する説明は省いてください。要約のみを出力してください。",
    bibleText: "",
    messages: [{ role: "user", content: transcript }],
    maxTokens: 1024,
    signal,
    onDelta: () => {},
  });
  return { text: result.text, model, usage: result.usage };
}

// 履歴を構築(必要なら要約を生成・キャッシュ)。返り値はAPI用メッセージ配列。
async function buildHistoryWithSummary(conv, card, apiKey, settings, signal, meta) {
  const pairs = settings.chat.history_pairs;
  const { line } = splitHistory(conv, pairs);
  const maxRecent = pairs * 2;

  if (line.length <= maxRecent) return toApiMessages(line);

  const cache = conv.summary_cache || null;
  let coveredIdx = -1;
  if (cache && cache.boundary_msg_id) {
    coveredIdx = line.findIndex((m) => m.id === cache.boundary_msg_id);
  }

  const rawLenIfReuse = coveredIdx >= 0 ? line.length - (coveredIdx + 1) : Infinity;
  let summaryText;
  let boundaryIdx;

  if (coveredIdx >= 0 && rawLenIfReuse <= maxRecent + SUMMARY_REGEN_MARGIN) {
    // キャッシュ再利用: 要約 + キャッシュ境界以降の原文
    summaryText = cache.text;
    boundaryIdx = coveredIdx;
  } else {
    // 再生成: 直近N往復を残して古い区間を要約
    boundaryIdx = line.length - maxRecent - 1;
    const oldMsgs = line.slice(0, boundaryIdx + 1);
    const s = await summarizeOld(card, apiKey, oldMsgs, signal);
    summaryText = s.text;
    ws.setSummaryCache(conv.id, {
      boundary_msg_id: line[boundaryIdx].id,
      text: summaryText,
      model: s.model,
      created_at: new Date().toISOString(),
    });
    // 要約生成分もトークン記録
    ws.recordUsage({
      role_card_id: card.id,
      provider: card.provider,
      model: s.model,
      input: s.usage.input,
      output: s.usage.output,
      cache_read: s.usage.cache_read,
      cache_write: s.usage.cache_write,
    });
    if (meta) meta.summarized = true;
  }

  const recent = line.slice(boundaryIdx + 1);
  return [
    { role: "user", content: "【これまでの会話の要約】\n" + summaryText },
    { role: "assistant", content: "(要約を確認しました。続きをどうぞ)" },
    ...toApiMessages(recent),
  ];
}

// ---- 通常チャット送信 ----
async function sendChat({ conversationId, cardId, modelOverride, text, requestId, parentId }, emit) {
  const card = ws.getRoleCard(cardId);
  if (!card) throw new Error("役割カードが見つかりません");
  const provider = getProvider(card.provider);
  if (!provider) throw new Error("未対応のプロバイダ: " + card.provider);
  const apiKey = getKey(card.provider);
  if (!apiKey) throw new Error(`${card.provider} のAPIキーが未設定です。設定画面から登録してください。`);

  const settings = ws.getSettings();
  const model = modelOverride || card.model;
  if (!model) throw new Error("モデルが未選択です。カード編集でモデルを選んでください。");

  // 1. ユーザーメッセージを追記(parentId指定時は分岐作成 §4.5)
  const userMsg = ws.appendMessage(conversationId, {
    author: "user",
    content: text,
    ...(parentId !== undefined ? { parent_id: parentId } : {}),
  });
  emit("chat:user-message", { requestId, conversationId, message: userMsg });

  const controller = new AbortController();
  activeControllers.set(requestId, controller);

  try {
    // 2. プロンプト組み立て(①システム → ②バイブル → ③要約+履歴 → ④最新入力)
    const conv = ws.getConversation(conversationId);
    const systemText = buildSystemText(card, "normal");
    const bibleText = buildBibleText(card);
    const meta = {};
    const history = await buildHistoryWithSummary(conv, card, apiKey, settings, controller.signal, meta);

    // §4.9 Web取得(許可カードのみ・ユーザーが明示したURLのみ)
    if (card.tools && card.tools.web_fetch) {
      emit("chat:status", { requestId, status: "web_fetch" });
      const webCtx = await buildWebContext(text);
      if (webCtx && history.length > 0) {
        const last = history[history.length - 1];
        last.content = last.content + "\n\n【ユーザー指定URLの取得内容】\n" + webCtx;
      }
    }

    emit("chat:status", { requestId, status: "generating" });
    const result = await provider.sendMessage({
      apiKey,
      model,
      systemText,
      bibleText,
      messages: history,
      maxTokens: settings.chat.max_tokens,
      signal: controller.signal,
      onDelta: (delta) => emit("chat:delta", { requestId, delta }),
    });

    // §4.16 確認質問の判定(パース失敗時は通常テキスト扱い)
    const clarification = tryParseClarification(result.text);

    // 3. アシスタントメッセージを追記
    const assistantMsg = ws.appendMessage(conversationId, {
      author: "assistant",
      role_card_id: card.id,
      model_override: modelOverride || null,
      model,
      content: result.text,
      tokens: { input: result.usage.input, output: result.usage.output },
      clarification,
    });

    // 4. トークン記録
    ws.recordUsage({
      role_card_id: card.id,
      provider: card.provider,
      model,
      input: result.usage.input,
      output: result.usage.output,
      cache_read: result.usage.cache_read,
      cache_write: result.usage.cache_write,
    });

    emit("chat:done", { requestId, conversationId, message: assistantMsg });
    return { userMsg, assistantMsg };
  } catch (err) {
    const aborted = controller.signal.aborted;
    const errText = aborted ? "(中断されました)" : String(err?.message || err);
    const assistantMsg = ws.appendMessage(conversationId, {
      author: "assistant",
      role_card_id: card.id,
      model_override: modelOverride || null,
      model,
      content: "",
      error: errText,
    });
    emit("chat:error", { requestId, conversationId, message: assistantMsg, error: errText, aborted });
    return { userMsg, assistantMsg, error: errText };
  } finally {
    activeControllers.delete(requestId);
  }
}

// ---- 複数モデル比較(§4.5: 同一プロンプトを複数カードに同時送信) ----
async function sendCompare({ conversationId, cardIds, text, requestId }, emit) {
  const settings = ws.getSettings();
  const cards = cardIds.map((id) => ws.getRoleCard(id)).filter(Boolean);
  if (cards.length === 0) throw new Error("カードが見つかりません");

  const userMsg = ws.appendMessage(conversationId, { author: "user", content: text });
  emit("chat:user-message", { requestId, conversationId, message: userMsg });

  const controller = new AbortController();
  activeControllers.set(requestId, controller);

  const conv = ws.getConversation(conversationId);

  const runOne = async (card) => {
    const provider = getProvider(card.provider);
    const apiKey = getKey(card.provider);
    if (!apiKey) throw new Error(`${card.provider} のAPIキー未設定`);
    if (!card.model) throw new Error(`${card.name}: モデル未選択`);
    const history = await buildHistoryWithSummary(conv, card, apiKey, settings, controller.signal, {});
    const result = await provider.sendMessage({
      apiKey,
      model: card.model,
      systemText: buildSystemText(card, "normal"),
      bibleText: buildBibleText(card),
      messages: history,
      maxTokens: settings.chat.max_tokens,
      signal: controller.signal,
      onDelta: (delta) => emit("compare:delta", { requestId, cardId: card.id, delta }),
    });
    ws.recordUsage({
      role_card_id: card.id,
      provider: card.provider,
      model: card.model,
      input: result.usage.input,
      output: result.usage.output,
      cache_read: result.usage.cache_read,
      cache_write: result.usage.cache_write,
    });
    return result;
  };

  try {
    const results = await Promise.allSettled(cards.map(runOne));
    const messages = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const r = results[i];
      const msg = ws.appendMessage(conversationId, {
        author: "assistant",
        role_card_id: card.id,
        model: card.model,
        parent_id: userMsg.id, // 全て同じ親=兄弟分岐として保存
        content: r.status === "fulfilled" ? r.value.text : "",
        tokens:
          r.status === "fulfilled"
            ? { input: r.value.usage.input, output: r.value.usage.output }
            : null,
        error: r.status === "rejected" ? String(r.reason?.message || r.reason) : null,
        clarification: r.status === "fulfilled" ? tryParseClarification(r.value.text) : null,
      });
      messages.push(msg);
    }
    // 本線は最初の応答に設定(比較UIで切替可能)
    if (messages.length > 0) ws.setActiveLeaf(conversationId, messages[0].id);
    emit("compare:done", { requestId, conversationId, messages });
    return { userMsg, messages };
  } finally {
    activeControllers.delete(requestId);
  }
}

function abortChat(requestId) {
  const c = activeControllers.get(requestId);
  if (c) c.abort();
  return !!c;
}

module.exports = { sendChat, sendCompare, abortChat, listModels };
