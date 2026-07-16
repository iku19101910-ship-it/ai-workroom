import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ConversationMeta, Message, ModelInfo, Project, ProjectScope, Provider, RoleCard } from "../types";
import { matchesProject, projectIdForNew, PROVIDER_LABELS } from "../types";
import ModelPicker from "../components/ModelPicker";
import ConversationTreeModal from "../components/ConversationTreeModal";
import ProjectBadge from "../components/ProjectBadge";

// §保管庫: 本文の1行目を指定文字数以内に切り出す(タイトル初期値用)
function firstLinePreview(text: string, maxLen: number): string {
  const line = (text.split("\n")[0] || "").trim();
  return line.length > maxLen ? line.slice(0, maxLen) : line;
}

// 本線復元: active_leaf_id から parent_id を根まで辿る(§6.2)
function mainline(conv: Conversation): Message[] {
  const byId = new Map(conv.messages.map((m) => [m.id, m]));
  const line: Message[] = [];
  let cur = conv.active_leaf_id ? byId.get(conv.active_leaf_id) : undefined;
  while (cur) {
    line.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return line;
}

// 分岐ツリー用: parent_id → 子配列(created_at昇順)。ルート(parent_id=null)は ROOT_KEY にまとめる(§4.5)
const ROOT_KEY = "__root__";
function buildChildrenMap(conv: Conversation | null): Map<string, Message[]> {
  const map = new Map<string, Message[]>();
  if (!conv) return map;
  for (const m of conv.messages) {
    const key = m.parent_id ?? ROOT_KEY;
    const arr = map.get(key);
    if (arr) arr.push(m);
    else map.set(key, [m]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return map;
}

// 指定メッセージから「各階層で最後に作られた子」を辿って葉に到達する(§4.5 分岐切替)
function deepestLastDescendant(msg: Message, childrenMap: Map<string, Message[]>): Message {
  let cur = msg;
  for (;;) {
    const kids = childrenMap.get(cur.id);
    if (!kids || kids.length === 0) return cur;
    cur = kids[kids.length - 1];
  }
}

interface ClarifyDraft {
  selected: (number | null)[];
  free: string[];
}

interface CompareStream {
  requestId: string;
  conversationId: string;
  cardIds: string[];
  cols: Record<string, string>;
}

export default function ChatView({ cards, projects, projectScope, initialConversationId, focusMessageId, onTargetConsumed }: {
  cards: RoleCard[]; projects: Project[]; projectScope: ProjectScope;
  initialConversationId?: string; focusMessageId?: string; onTargetConsumed?: () => void;
}) {
  const [convList, setConvList] = useState<ConversationMeta[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [targetCardId, setTargetCardId] = useState<string>("");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState<{
    requestId: string;
    text: string;
    status: "web_fetch" | "generating";
  } | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const convRef = useRef<Conversation | null>(null);
  convRef.current = conv;

  // §4.5 編集して分岐: 対象ユーザーメッセージの親IDと冒頭プレビュー
  const [branchFrom, setBranchFrom] = useState<{ parentId: string | null; preview: string } | null>(null);

  // §4.16 確認質問カードの回答下書き(messageId単位)
  const [clarifyDraft, setClarifyDraft] = useState<Record<string, ClarifyDraft>>({});

  // §4.5 横並び比較モーダル(既存の兄弟アシスタントメッセージを見比べる)
  const [compareModalSiblings, setCompareModalSiblings] = useState<Message[] | null>(null);

  // §4.5 会話ツリーモーダル(旧「分岐」ビューを統合)
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeInitialSelectedId, setTreeInitialSelectedId] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  // §4.5 複数カード同時送信(比較モード)
  const [compareMode, setCompareMode] = useState(false);
  const [compareCardIds, setCompareCardIds] = useState<string[]>([]);
  const [compareStreaming, setCompareStreaming] = useState<CompareStream | null>(null);

  // 成果物保管庫: アシスタントメッセージを保存するモーダル
  const [saveTarget, setSaveTarget] = useState<Message | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveTags, setSaveTags] = useState("");
  const [saveDone, setSaveDone] = useState(false);

  const targetCard = cards.find((c) => c.id === targetCardId) ?? null;

  const refreshConvList = useCallback(async () => {
    const list = await window.api.listConversations();
    setConvList(list.filter((c) => matchesProject(c.project_id, projectScope)));
  }, [projectScope]);

  useEffect(() => {
    refreshConvList();
  }, [refreshConvList]);

  useEffect(() => {
    if (conv && !matchesProject(conv.project_id, projectScope)) setConv(null);
  }, [projectScope, conv]);

  useEffect(() => {
    if (!initialConversationId) return;
    (async () => {
      const target = await window.api.getConversation(initialConversationId);
      if (!target) return;
      setConv(target);
      setBranchFrom(null);
      if (focusMessageId) {
        if (mainline(target).some((m) => m.id === focusMessageId)) {
          setHighlightMessageId(focusMessageId);
          setTimeout(() => {
            document.querySelector(`[data-message-id="${focusMessageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 50);
          setTimeout(() => setHighlightMessageId(null), 2100);
        } else {
          setTreeInitialSelectedId(focusMessageId);
          setTreeOpen(true);
        }
      }
      onTargetConsumed?.();
    })();
  }, [initialConversationId, focusMessageId]);

  useEffect(() => {
    if (!targetCardId && cards.length > 0) setTargetCardId(cards[0].id);
  }, [cards, targetCardId]);

  // メッセージレベルのモデル上書き用: 宛先カードのプロバイダのモデル一覧を取得(§4.2)
  useEffect(() => {
    setModelOverride("");
    if (!targetCard) {
      setModels([]);
      return;
    }
    let cancelled = false;
    window.api.listModels(targetCard.provider).then((r) => {
      if (!cancelled) setModels(r.models);
    });
    return () => {
      cancelled = true;
    };
  }, [targetCard?.provider]);

  // イベント購読(onAppEvent): チャット・比較送信の両方を処理
  useEffect(() => {
    const off = window.api.onAppEvent(async (channel, payload) => {
      if (channel === "chat:delta") {
        setStreaming((s) =>
          s && s.requestId === payload.requestId ? { ...s, text: s.text + payload.delta } : s
        );
      } else if (channel === "chat:status") {
        setStreaming((s) =>
          s && s.requestId === payload.requestId ? { ...s, status: payload.status } : s
        );
      } else if (channel === "chat:done" || channel === "chat:error") {
        setStreaming(null);
        const cur = convRef.current;
        if (cur && payload.conversationId === cur.id) {
          setConv(await window.api.getConversation(cur.id));
        }
        refreshConvList();
      } else if (channel === "compare:delta") {
        setCompareStreaming((s) =>
          s && s.requestId === payload.requestId
            ? { ...s, cols: { ...s.cols, [payload.cardId]: (s.cols[payload.cardId] || "") + payload.delta } }
            : s
        );
      } else if (channel === "compare:done") {
        setCompareStreaming((s) => (s && s.requestId === payload.requestId ? null : s));
        const cur = convRef.current;
        if (cur && payload.conversationId === cur.id) {
          setConv(await window.api.getConversation(cur.id));
        }
        refreshConvList();
      }
    });
    return off;
  }, [refreshConvList]);

  // 自動スクロール
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv, streaming?.text, compareStreaming?.cols]);

  const openConversation = async (id: string) => {
    setConv(await window.api.getConversation(id));
    setBranchFrom(null);
  };

  const newConversation = async () => {
    const c = await window.api.createConversation(undefined, projectIdForNew(projectScope));
    await refreshConvList();
    setConv(c);
    setBranchFrom(null);
  };

  // @メンション候補(入力の末尾トークンが @… のとき表示)
  const mentionQuery = useMemo(() => {
    const m = text.match(/(^|\s)@([^\s@]*)$/);
    return m ? m[2] : null;
  }, [text]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    return cards.filter((c) => c.name.includes(mentionQuery));
  }, [cards, mentionQuery]);

  useEffect(() => {
    setMentionOpen(mentionQuery !== null && mentionCandidates.length > 0);
    setMentionIndex(0);
  }, [mentionQuery, mentionCandidates.length]);

  const applyMention = (card: RoleCard) => {
    setTargetCardId(card.id);
    setText(text.replace(/(^|\s)@([^\s@]*)$/, "$1@" + card.name + " "));
    setMentionOpen(false);
  };

  const toggleCompareCard = (id: string) => {
    setCompareCardIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 送信: 先頭の @カード名 でルーティング(§4.1)。本文からメンションは除去。比較モード時は sendCompare へ。
  const send = async () => {
    if (streaming || compareStreaming) return;
    let body = text.trim();
    if (!body) return;

    if (compareMode) {
      if (compareCardIds.length < 2) {
        alert("比較には2つ以上のカードを選択してください");
        return;
      }
      let c = conv;
      if (!c) {
        c = await window.api.createConversation(body.slice(0, 24), projectIdForNew(projectScope));
        await refreshConvList();
        setConv(c);
      }
      const requestId = "req_" + Date.now().toString(36);
      setText("");
      setCompareStreaming({ requestId, conversationId: c.id, cardIds: [...compareCardIds], cols: {} });
      window.api
        .sendCompare({ conversationId: c.id, cardIds: compareCardIds, text: body, requestId })
        .catch(() => setCompareStreaming(null));
      setTimeout(async () => {
        const latest = await window.api.getConversation(c!.id);
        if (latest) setConv(latest);
      }, 150);
      return;
    }

    let cardId = targetCardId;
    const m = body.match(/^@(\S+)\s*/);
    if (m) {
      const named = cards.find((c) => c.name === m[1]);
      if (named) {
        cardId = named.id;
        setTargetCardId(named.id);
        body = body.slice(m[0].length).trim();
        if (!body) return;
      }
    }
    if (!cardId) {
      alert("宛先の役割カードを選択してください(役割カード画面で作成できます)");
      return;
    }
    let c = conv;
    if (!c) {
      c = await window.api.createConversation(body.slice(0, 24), projectIdForNew(projectScope));
      await refreshConvList();
      setConv(c);
    }
    const requestId = "req_" + Date.now().toString(36);
    const parentId = branchFrom ? branchFrom.parentId : undefined;
    setText("");
    setBranchFrom(null);
    setStreaming({ requestId, text: "", status: "generating" });
    window.api
      .sendChat({
        conversationId: c.id,
        cardId,
        modelOverride: modelOverride || null,
        text: body,
        requestId,
        parentId,
      })
      .catch(() => setStreaming(null));
    // ユーザーメッセージ追記イベントを待たずに軽く再読込
    setTimeout(async () => {
      const latest = await window.api.getConversation(c!.id);
      if (latest) setConv(latest);
    }, 150);
  };

  const abort = async () => {
    if (streaming) await window.api.abortChat(streaming.requestId);
    if (compareStreaming) await window.api.abortChat(compareStreaming.requestId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const line = conv ? mainline(conv) : [];
  const childrenMap = useMemo(() => buildChildrenMap(conv), [conv]);

  const cardName = (id: string | null) => cards.find((c) => c.id === id)?.name ?? "AI";
  const cardProvider = (id: string | null) => {
    const c = cards.find((x) => x.id === id);
    return c ? PROVIDER_LABELS[c.provider] : "";
  };
  // メッセージのプロバイダ判定(カード削除済みの場合はモデル名から推定)
  const providerOf = (m: Message): Provider | null => {
    const c = cards.find((x) => x.id === m.role_card_id);
    if (c) return c.provider;
    const mod = (m.model || "").toLowerCase();
    if (mod.includes("claude")) return "anthropic";
    if (mod.includes("gemini")) return "google";
    if (mod) return "openai";
    return null;
  };

  // 成果物保管庫: 保存モーダルを開く(タイトル初期値は本文1行目 or 会話タイトル)
  const openSaveModal = (m: Message) => {
    const fromBody = firstLinePreview(m.content, 30);
    setSaveTitle(fromBody || conv?.title || "");
    setSaveTags("");
    setSaveDone(false);
    setSaveTarget(m);
  };

  const closeSaveModal = () => {
    setSaveTarget(null);
  };

  const confirmSaveArtifact = async () => {
    if (!saveTarget || !conv) return;
    const tags = saveTags
      .split(",")
      .map((t) => t.trim())
      .filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i);
    await window.api.saveArtifact({
      title: saveTitle.trim() || firstLinePreview(saveTarget.content, 30) || conv.title,
      tags,
      content: saveTarget.content,
      provider: providerOf(saveTarget),
      model: saveTarget.model,
      role_card_id: saveTarget.role_card_id,
      card_name: cardName(saveTarget.role_card_id),
      conversation_id: conv.id,
      message_id: saveTarget.id,
      project_id: conv.project_id ?? null,
    });
    setSaveDone(true);
    setTimeout(() => {
      setSaveDone(false);
      setSaveTarget(null);
    }, 1200);
  };

  // §4.5 分岐切替: 指定メッセージの枝の最深・最新の子孫へ active_leaf を移動
  const switchToBranch = async (target: Message) => {
    if (!conv) return;
    const leaf = deepestLastDescendant(target, childrenMap);
    const updated = await window.api.setActiveLeaf(conv.id, leaf.id);
    setConv(updated);
  };

  const startBranchEdit = (m: Message) => {
    setText(m.content);
    setBranchFrom({ parentId: m.parent_id, preview: m.content.slice(0, 20) });
  };

  const makeMainline = async (sm: Message) => {
    await switchToBranch(sm);
    setCompareModalSiblings(null);
  };

  // §4.16 確認質問カードの回答操作
  const getClarifyDraft = (m: Message): ClarifyDraft => {
    const qCount = m.clarification?.questions.length ?? 0;
    return (
      clarifyDraft[m.id] ?? {
        selected: new Array(qCount).fill(null),
        free: new Array(qCount).fill(""),
      }
    );
  };

  const toggleClarifyOption = (m: Message, qIndex: number, optIndex: number) => {
    const qCount = m.clarification?.questions.length ?? 0;
    setClarifyDraft((prev) => {
      const cur = prev[m.id] ?? { selected: new Array(qCount).fill(null), free: new Array(qCount).fill("") };
      const nextSelected = [...cur.selected];
      nextSelected[qIndex] = nextSelected[qIndex] === optIndex ? null : optIndex;
      return { ...prev, [m.id]: { ...cur, selected: nextSelected } };
    });
  };

  const setClarifyFree = (m: Message, qIndex: number, value: string) => {
    const qCount = m.clarification?.questions.length ?? 0;
    setClarifyDraft((prev) => {
      const cur = prev[m.id] ?? { selected: new Array(qCount).fill(null), free: new Array(qCount).fill("") };
      const nextFree = [...cur.free];
      nextFree[qIndex] = value;
      return { ...prev, [m.id]: { ...cur, free: nextFree } };
    });
  };

  const submitClarification = async (m: Message) => {
    const clar = m.clarification;
    const cardId = m.role_card_id;
    if (!clar || !cardId || !conv) return;
    if (streaming || compareStreaming) return;
    const draft = getClarifyDraft(m);
    const lines = clar.questions.map((q, i) => {
      const optIdx = draft.selected[i];
      const opt = optIdx !== null && optIdx !== undefined ? q.options[optIdx] : "";
      const freeText = q.allow_free_text ? (draft.free[i] || "").trim() : "";
      const answer = [opt, freeText].filter(Boolean).join(" / ") || "(未回答)";
      return `${q.text}: ${answer}`;
    });
    const answerText = lines.join("\n");
    const requestId = "req_" + Date.now().toString(36);
    setStreaming({ requestId, text: "", status: "generating" });
    window.api
      .sendChat({
        conversationId: conv.id,
        cardId,
        modelOverride: null,
        text: answerText,
        requestId,
      })
      .catch(() => setStreaming(null));
    setTimeout(async () => {
      const latest = await window.api.getConversation(conv!.id);
      if (latest) setConv(latest);
    }, 150);
  };

  return (
    <div className="chat-layout">
      <div className="conv-list">
        <div className="conv-list-header">
          <span className="panel-title" style={{ flex: 1 }}>会話</span>
          <button className="btn small" onClick={newConversation}>+ 新規</button>
        </div>
        <div className="conv-items">
          {convList.map((c) => (
            <button
              key={c.id}
              className={"conv-item" + (conv?.id === c.id ? " active" : "")}
              onClick={() => openConversation(c.id)}
            >
              <span className="conv-title">{c.title}</span>
              <ProjectBadge projectId={c.project_id} projects={projects} scope={projectScope} />
              <span className="conv-date">{c.updated_at?.slice(0, 10)}</span>
            </button>
          ))}
          {convList.length === 0 && (
            <div className="empty-state">「+ 新規」から会話を始めてください</div>
          )}
        </div>
      </div>

      <div className="chat-main">
        <div className="chat-messages" ref={messagesRef}>
          {!conv && (
            <div className="empty-state">
              会話を選択するか、そのままメッセージを送信すると新しい会話が始まります。
              <br />
              <span className="muted">@役割名 で宛先カードを指定できます</span>
            </div>
          )}
          {line.map((m) => {
            const p = m.author === "assistant" ? providerOf(m) : null;
            const siblings = childrenMap.get(m.parent_id ?? ROOT_KEY) ?? [m];
            const siblingIndex = siblings.findIndex((s) => s.id === m.id);
            const hasBranches = siblings.length > 1 && siblingIndex >= 0;
            const answered = (childrenMap.get(m.id)?.length ?? 0) > 0;
            const draft = m.clarification ? getClarifyDraft(m) : null;

            return (
              <div key={m.id} data-message-id={m.id} className={"msg " + m.author + (highlightMessageId === m.id ? " search-highlight" : "")}>
                <div className="msg-meta">
                  <span className="msg-author">
                    {m.author === "user" ? "あなた" : cardName(m.role_card_id)}
                  </span>
                  {m.author === "assistant" && (
                    <span className="badge">
                      {p && (
                        <span
                          className="chart-chip"
                          style={{ background: `var(--chart-${p})`, marginRight: 4 }}
                        />
                      )}
                      {cardName(m.role_card_id)} · {cardProvider(m.role_card_id)}
                      {m.model ? ` · ${m.model}` : ""}
                      {m.model_override ? "(一時切替)" : ""}
                    </span>
                  )}
                  {m.tokens && (
                    <span className="msg-tokens">
                      入力 {m.tokens.input.toLocaleString()} / 出力 {m.tokens.output.toLocaleString()} / 計{" "}
                      {(m.tokens.input + m.tokens.output).toLocaleString()}
                    </span>
                  )}
                  {hasBranches && (
                    <span className="branch-switch">
                      <button
                        type="button"
                        disabled={siblingIndex <= 0}
                        onClick={() => switchToBranch(siblings[siblingIndex - 1])}
                      >
                        ◀
                      </button>
                      {siblingIndex + 1}/{siblings.length}
                      <button
                        type="button"
                        disabled={siblingIndex >= siblings.length - 1}
                        onClick={() => switchToBranch(siblings[siblingIndex + 1])}
                      >
                        ▶
                      </button>
                    </span>
                  )}
                </div>

                {m.author === "assistant" && m.clarification ? (
                  <div className="clarify-card">
                    <div className="clarify-title">確認質問</div>
                    {m.clarification.questions.map((q, qi) => (
                      <div className="clarify-q" key={qi}>
                        <div className="clarify-text">{q.text}</div>
                        <div className="clarify-options">
                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              type="button"
                              className={"clarify-option" + (draft?.selected[qi] === oi ? " selected" : "")}
                              disabled={answered}
                              onClick={() => toggleClarifyOption(m, qi, oi)}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                        {q.allow_free_text && (
                          <input
                            className="clarify-free"
                            type="text"
                            placeholder="自由入力"
                            value={draft?.free[qi] ?? ""}
                            disabled={answered}
                            onChange={(e) => setClarifyFree(m, qi, e.target.value)}
                          />
                        )}
                      </div>
                    ))}
                    <button
                      className="btn small"
                      disabled={answered || !!streaming || !!compareStreaming}
                      onClick={() => submitClarification(m)}
                    >
                      回答を送信
                    </button>
                  </div>
                ) : (
                  m.content && (
                    <div
                      className="msg-body"
                      style={p ? { border: `1.5px solid var(--chart-${p})` } : undefined}
                    >
                      {m.content}
                    </div>
                  )
                )}

                {m.error && <div className="msg-error">⚠ {m.error}</div>}

                {m.author === "user" && (
                  <div className="msg-actions">
                    <button className="msg-action-btn" onClick={() => startBranchEdit(m)}>
                      ✎ 編集して分岐
                    </button>
                  </div>
                )}
                {m.author === "assistant" && m.content && !m.error && (
                  <div className="msg-actions">
                    <button className="msg-action-btn" onClick={() => openSaveModal(m)}>
                      📦 保存
                    </button>
                    {siblings.length > 1 && (
                      <button className="msg-action-btn" onClick={() => setCompareModalSiblings(siblings)}>
                        ⇆ 横並び比較
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {streaming && (
            <div className="msg assistant">
              <div className="msg-meta">
                <span className="msg-author">{targetCard?.name ?? "AI"}</span>
                <span className="badge">{streaming.status === "web_fetch" ? "Web取得中…" : "生成中…"}</span>
              </div>
              <div
                className="msg-body"
                style={
                  targetCard
                    ? { border: `1.5px solid var(--chart-${targetCard.provider})` }
                    : undefined
                }
              >
                {streaming.text || "…"}
              </div>
            </div>
          )}
          {compareStreaming && (
            <div className="msg assistant">
              <div className="msg-meta">
                <span className="msg-author">比較送信</span>
                <span className="badge">生成中…</span>
              </div>
              <div className="compare-grid">
                {compareStreaming.cardIds.map((cid) => {
                  const c = cards.find((x) => x.id === cid);
                  return (
                    <div className="compare-col" key={cid}>
                      <div className="compare-head">
                        {c && <span className="chart-chip" style={{ background: `var(--chart-${c.provider})` }} />}
                        <span>{c?.name ?? cid}</span>
                        {c && <span className="badge">{PROVIDER_LABELS[c.provider]}</span>}
                      </div>
                      <div className="compare-body">{compareStreaming.cols[cid] || "…"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-area">
          {branchFrom && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--accent)",
                marginBottom: 6,
              }}
            >
              <span>分岐を作成して送信します(元: {branchFrom.preview}…)</span>
              <button className="msg-action-btn" onClick={() => setBranchFrom(null)}>
                キャンセル
              </button>
            </div>
          )}
          <div className="chat-input-controls">
            {!compareMode && (
              <>
                <label>宛先</label>
                <select value={targetCardId} onChange={(e) => setTargetCardId(e.target.value)}>
                  {cards.length === 0 && <option value="">(カード未作成)</option>}
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}({PROVIDER_LABELS[c.provider]})
                    </option>
                  ))}
                </select>
              </>
            )}
            {compareMode && (
              <div className="checkbox-row" style={{ flexWrap: "wrap" }}>
                <label>比較先(2つ以上)</label>
                {cards.map((c) => (
                  <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={compareCardIds.includes(c.id)}
                      onChange={() => toggleCompareCard(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
                {cards.length === 0 && <span className="muted">(カード未作成)</span>}
              </div>
            )}
            <label>モデル</label>
            <ModelPicker
              models={models}
              value={modelOverride}
              onChange={setModelOverride}
              disabled={compareMode}
              defaultOption={`カード既定(${targetCard?.model || "未設定"})`}
            />
            <button
              type="button"
              className={"btn small" + (compareMode ? "" : " secondary")}
              onClick={() => {
                setCompareMode((v) => !v);
                setCompareCardIds([]);
              }}
              title="複数カードへ同時送信して比較(§4.5)"
            >
              比較{compareMode ? " ON" : ""}
            </button>
            <button
              type="button"
              className="btn small secondary"
              disabled={!conv}
              onClick={() => setTreeOpen(true)}
              title="この会話の分岐ツリーを表示・本線切替(§4.5)"
            >
              🌿 ツリー
            </button>
            {(streaming || compareStreaming) && (
              <button className="btn small danger" onClick={abort}>
                ■ 停止
              </button>
            )}
          </div>
          <div className="chat-input-row">
            {mentionOpen && (
              <div className="mention-pop">
                {mentionCandidates.map((c, i) => (
                  <button
                    key={c.id}
                    className={i === mentionIndex ? "selected" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(c);
                    }}
                  >
                    <span>@{c.name}</span>
                    <span className="badge">{PROVIDER_LABELS[c.provider]}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="chat-textarea"
              placeholder="メッセージを入力(@役割名 で宛先指定 / Enterで送信・Shift+Enterで改行)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
            />
            <button
              className="btn"
              onClick={send}
              disabled={!!streaming || !!compareStreaming || cards.length === 0}
            >
              送信
            </button>
          </div>
        </div>
      </div>

      {compareModalSiblings && (
        <div className="modal-backdrop" onClick={() => setCompareModalSiblings(null)}>
          <div className="modal" style={{ width: "min(1100px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
            <h2>横並び比較</h2>
            <div className="compare-grid">
              {compareModalSiblings.map((sm) => {
                const sp = providerOf(sm);
                return (
                  <div className="compare-col" key={sm.id}>
                    <div className="compare-head">
                      {sp && <span className="chart-chip" style={{ background: `var(--chart-${sp})` }} />}
                      <span>{cardName(sm.role_card_id)}</span>
                      <span className="badge">
                        {cardProvider(sm.role_card_id)}
                        {sm.model ? ` · ${sm.model}` : ""}
                      </span>
                    </div>
                    <div className="compare-body">
                      {sm.content || (sm.error ? `⚠ ${sm.error}` : "")}
                    </div>
                    {sm.tokens && (
                      <div className="msg-tokens">
                        入力 {sm.tokens.input.toLocaleString()} / 出力 {sm.tokens.output.toLocaleString()}
                      </div>
                    )}
                    <button className="btn small" style={{ marginTop: 8 }} onClick={() => makeMainline(sm)}>
                      これを本線にする
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setCompareModalSiblings(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {saveTarget && (
        <div className="modal-backdrop" onClick={closeSaveModal}>
          <div className="modal" style={{ width: "min(680px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
            <h2>成果物保管庫へ保存</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="タイトル"
              />
              <input
                value={saveTags}
                onChange={(e) => setSaveTags(e.target.value)}
                placeholder="タグ(カンマ区切り・任意)"
              />
              <div className="artifact-preview">{saveTarget.content}</div>
              {saveDone && <div style={{ color: "var(--accent)", fontSize: 12 }}>✓ 保管庫に保存しました</div>}
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={closeSaveModal}>
                キャンセル
              </button>
              <button className="btn" onClick={confirmSaveArtifact} disabled={saveDone}>
                保管庫へ保存
              </button>
            </div>
          </div>
        </div>
      )}

      {treeOpen && conv && (
        <ConversationTreeModal
          conversationId={conv.id}
          cards={cards}
          initialSelectedId={treeInitialSelectedId}
          onClose={async () => {
            setTreeOpen(false);
            // ツリー内で本線を切り替えた可能性があるため再読込
            const latest = await window.api.getConversation(conv.id);
            if (latest) setConv(latest);
          }}
          onChanged={async () => {
            const latest = await window.api.getConversation(conv.id);
            if (latest) setConv(latest);
          }}
        />
      )}
    </div>
  );
}
