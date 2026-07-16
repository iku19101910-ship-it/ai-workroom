const { getKey, PROVIDERS } = require("./keys.cjs");
const { pickCheapModel, getProvider } = require("./models.cjs");
const { mainlineForPrompt } = require("./prompt.cjs");
const ws = require("./workspace.cjs");

const running = new Set();

function parseHandoff(text) {
  let source = String(text || "").trim();
  const fence = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) source = fence[1].trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("引き継ぎJSONを解析できませんでした");
  const obj = JSON.parse(source.slice(start, end + 1));
  const list = (value) => Array.isArray(value) ? value.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 5) : [];
  return { decisions: list(obj.decisions), open_issues: list(obj.open_issues), next_steps: list(obj.next_steps) };
}

function selectCard(conv) {
  const cards = ws.listRoleCards();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const line = mainlineForPrompt(conv);
  for (let i = line.length - 1; i >= 0; i -= 1) {
    const card = line[i].author === "assistant" && line[i].role_card_id ? byId.get(line[i].role_card_id) : null;
    if (card && getKey(card.provider)) return card;
  }
  return cards.find((c) => getKey(c.provider)) ?? null;
}

async function generateHandoff(conversationId) {
  const conv = ws.getConversation(conversationId);
  if (!conv) throw new Error("会話が見つかりません");
  const line = mainlineForPrompt(conv);
  if (!line.length) throw new Error("引き継ぐ会話内容がありません");
  const card = selectCard(conv);
  if (!card) throw new Error(`APIキー設定済みの役割カードがありません (${PROVIDERS.join(" / ")})`);
  const apiKey = getKey(card.provider);
  const model = await pickCheapModel(card.provider, card.model);
  if (!model) throw new Error("引き継ぎ生成に使うモデルがありません");
  const provider = getProvider(card.provider);
  const transcript = line.map((m) => `${m.author === "user" ? "ユーザー" : "AI"}: ${m.content}`).join("\n\n");
  const result = await provider.sendMessage({
    apiKey,
    model,
    systemText: "あなたは作業引き継ぎの整理担当です。事実だけを簡潔な日本語で抽出してください。",
    bibleText: "",
    messages: [{ role: "user", content: `次の会話から引き継ぎ情報を抽出してください。各配列は最大5項目、無い場合は空配列にし、次のJSONのみで出力してください。\n{\"decisions\":[],\"open_issues\":[],\"next_steps\":[]}\n\n${transcript}` }],
    maxTokens: 1024,
    onDelta: () => {},
  });
  const parsed = parseHandoff(result.text);
  const handoff = { id: `handoff_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString(), ...parsed, model };
  ws.addHandoff(conversationId, handoff);
  ws.recordUsage({ role_card_id: card.id, provider: card.provider, model, input: result.usage?.input || 0, output: result.usage?.output || 0, cache_read: result.usage?.cache_read || 0, cache_write: result.usage?.cache_write || 0 });
  return handoff;
}

async function maybeAutoHandoff(conversationId) {
  if (running.has(conversationId)) return null;
  const settings = ws.getSettings();
  if (!settings.handoff.auto) return null;
  const conv = ws.getConversation(conversationId);
  if (!conv) return null;
  const latest = Array.isArray(conv.handoffs) ? conv.handoffs[conv.handoffs.length - 1] : null;
  const newCount = mainlineForPrompt(conv).filter((m) => !latest || m.created_at > latest.created_at).length;
  if (newCount < settings.handoff.min_new_messages) return null;
  running.add(conversationId);
  try { return await generateHandoff(conversationId); }
  catch { return null; }
  finally { running.delete(conversationId); }
}

module.exports = { generateHandoff, maybeAutoHandoff, parseHandoff };
