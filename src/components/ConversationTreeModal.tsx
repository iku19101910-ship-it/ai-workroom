import { useEffect, useMemo, useState } from "react";
import type { Conversation, Message, Provider, RoleCard } from "../types";
import { PROVIDER_LABELS } from "../types";

// 会話ツリーのモーダル(チャット画面から開く)。
// ツリー俯瞰・本線切替・兄弟の横並び比較(§4.5)。旧「分岐」ビューを部品化したもの。

function providerOf(m: Message, cards: RoleCard[]): Provider | null {
  const c = cards.find((x) => x.id === m.role_card_id);
  if (c) return c.provider;
  const mod = (m.model || "").toLowerCase();
  if (mod.includes("claude")) return "anthropic";
  if (mod.includes("gemini")) return "google";
  if (mod) return "openai";
  return null;
}

function authorLabel(m: Message, cards: RoleCard[]): string {
  if (m.author === "user") return "あなた";
  return cards.find((c) => c.id === m.role_card_id)?.name ?? "AI(削除済み)";
}

function TreeNode({
  message,
  childrenMap,
  mainlineIds,
  selectedId,
  onSelect,
  cards,
}: {
  message: Message;
  childrenMap: Map<string | null, Message[]>;
  mainlineIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  cards: RoleCard[];
}) {
  const kids = childrenMap.get(message.id) ?? [];
  const provider = message.author === "assistant" ? providerOf(message, cards) : null;
  const raw = message.content || "";
  const excerpt = raw.slice(0, 60) + (raw.length > 60 ? "…" : "");
  const isSelected = selectedId === message.id;

  return (
    <div>
      <div
        className={"tree-msg" + (mainlineIds.has(message.id) ? " on-mainline" : "")}
        style={
          isSelected
            ? { background: "var(--hover)", outline: "1px solid var(--accent)" }
            : undefined
        }
        onClick={() => onSelect(message.id)}
      >
        <span>{message.author === "user" ? "🧑" : "🤖"}</span>
        <span style={{ fontWeight: 600, flexShrink: 0 }}>{authorLabel(message, cards)}</span>
        {provider && (
          <span
            className="chart-chip"
            title={PROVIDER_LABELS[provider]}
            style={{ background: `var(--chart-${provider})` }}
          />
        )}
        <span className="tree-text">{excerpt || "(空)"}</span>
      </div>
      {kids.length > 0 && (
        <div className="tree-node">
          {kids.map((k) => (
            <TreeNode
              key={k.id}
              message={k}
              childrenMap={childrenMap}
              mainlineIds={mainlineIds}
              selectedId={selectedId}
              onSelect={onSelect}
              cards={cards}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConversationTreeModal({
  conversationId,
  cards,
  onClose,
  onChanged,
}: {
  conversationId: string;
  cards: RoleCard[];
  onClose: () => void;
  onChanged: () => Promise<void> | void; // 本線切替後にチャット側を再読込させる
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    window.api.getConversation(conversationId).then(setConv);
  }, [conversationId]);

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, Message[]>();
    for (const m of conv?.messages ?? []) {
      const arr = map.get(m.parent_id) ?? [];
      arr.push(m);
      map.set(m.parent_id, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    }
    return map;
  }, [conv]);

  const mainlineIds = useMemo(() => {
    const set = new Set<string>();
    if (!conv) return set;
    const byId = new Map(conv.messages.map((m) => [m.id, m]));
    let cur = conv.active_leaf_id ? byId.get(conv.active_leaf_id) : undefined;
    while (cur) {
      set.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return set;
  }, [conv]);

  const roots = childrenMap.get(null) ?? [];
  const selected = conv?.messages.find((m) => m.id === selectedId) ?? null;
  const siblings = selected ? childrenMap.get(selected.parent_id) ?? [] : [];

  const leafFromNode = (nodeId: string): string => {
    let curId = nodeId;
    for (;;) {
      const kids = childrenMap.get(curId) ?? [];
      if (kids.length === 0) return curId;
      curId = kids[kids.length - 1].id;
    }
  };

  const setMainline = async (nodeId: string) => {
    if (!conv) return;
    const leafId = leafFromNode(nodeId);
    const updated = await window.api.setActiveLeaf(conv.id, leafId);
    setConv(updated);
    await onChanged();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1100px, 96vw)" }}
      >
        <h2>🌿 会話ツリー — {conv?.title ?? ""}</h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          緑の左線が現在の本線です。ノードを選んで「この枝を本線にする」で切り替えられます。
        </p>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", minWidth: 320, maxHeight: "55vh", overflowY: "auto" }}>
            {roots.length === 0 && <div className="empty-state">メッセージがありません</div>}
            {roots.map((r) => (
              <TreeNode
                key={r.id}
                message={r}
                childrenMap={childrenMap}
                mainlineIds={mainlineIds}
                selectedId={selectedId}
                onSelect={setSelectedId}
                cards={cards}
              />
            ))}
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 280, maxHeight: "55vh", overflowY: "auto" }}>
            {!selected && <div className="empty-state">ノードを選択してください</div>}
            {selected && (
              <div>
                <div className="msg-meta" style={{ marginBottom: 8 }}>
                  <span className="msg-author">{authorLabel(selected, cards)}</span>
                  {selected.author === "assistant" &&
                    (() => {
                      const p = providerOf(selected, cards);
                      return (
                        <span className="badge">
                          {p && (
                            <span
                              className="chart-chip"
                              style={{ background: `var(--chart-${p})`, marginRight: 4 }}
                            />
                          )}
                          {p ? PROVIDER_LABELS[p] : "不明"}
                          {selected.model ? ` · ${selected.model}` : ""}
                        </span>
                      );
                    })()}
                  {mainlineIds.has(selected.id) && <span className="badge">本線上</span>}
                </div>
                <div className="msg-body" style={{ whiteSpace: "pre-wrap" }}>
                  {selected.content || "(空)"}
                </div>
                {selected.error && <div className="msg-error">⚠ {selected.error}</div>}
                <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
                  <button className="btn small" onClick={() => setMainline(selected.id)}>
                    この枝を本線にする
                  </button>
                  {siblings.length >= 2 && (
                    <button className="btn small secondary" onClick={() => setCompareOpen(true)}>
                      兄弟を横並び比較
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn secondary" onClick={onClose}>
            閉じる
          </button>
        </div>

        {compareOpen && selected && (
          <div className="modal-backdrop" onClick={() => setCompareOpen(false)}>
            <div
              className="modal"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "min(960px, 94vw)" }}
            >
              <h2>兄弟を比較</h2>
              <div className="compare-grid">
                {siblings.map((s) => {
                  const p = s.author === "assistant" ? providerOf(s, cards) : null;
                  return (
                    <div className="compare-col" key={s.id}>
                      <div className="compare-head">
                        {p && <span className="chart-chip" style={{ background: `var(--chart-${p})` }} />}
                        <span>{authorLabel(s, cards)}</span>
                        {mainlineIds.has(s.id) && <span className="badge">本線上</span>}
                      </div>
                      <div className="compare-body">{s.content || "(空)"}</div>
                      <div className="modal-actions">
                        <button
                          className="btn small"
                          onClick={async () => {
                            await setMainline(s.id);
                            setCompareOpen(false);
                          }}
                        >
                          これを本線にする
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="modal-actions">
                <button className="btn secondary" onClick={() => setCompareOpen(false)}>
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
