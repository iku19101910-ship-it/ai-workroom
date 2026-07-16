import { useEffect, useMemo, useRef, useState } from "react";
import type { Artifact, ArtifactMeta, Project, ProjectScope, Provider, RoleCard } from "../types";
import { matchesProject, projectIdForNew, PROVIDER_LABELS } from "../types";
import ProjectBadge from "../components/ProjectBadge";

// タグ文字列(カンマ区切り)を trim・空除去・重複除去した配列にする
function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    result.push(t);
  }
  return result;
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tags) {
    const v = t.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    result.push(v);
  }
  return result;
}

export default function ArtifactsView({ cards: _cards, projects, projectScope }: { cards: RoleCard[]; projects: Project[]; projectScope: ProjectScope }) {
  const [items, setItems] = useState<ArtifactMeta[]>([]);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [detail, setDetail] = useState<Artifact | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [detailTags, setDetailTags] = useState<string[]>([]);
  const [tagInputText, setTagInputText] = useState("");
  const [detailContent, setDetailContent] = useState("");
  const [editingContent, setEditingContent] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);

  const [manualAdd, setManualAdd] = useState<{ title: string; tags: string; content: string } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async (q: string) => {
    const trimmed = q.trim();
    const list = trimmed ? await window.api.searchArtifacts(trimmed) : await window.api.listArtifacts();
    setItems(list.filter((it) => matchesProject(it.project_id, projectScope)));
  };

  useEffect(() => {
    refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectScope]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refresh(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, projectScope]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) for (const t of it.tags || []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [items]);

  const displayed = useMemo(() => {
    if (selectedTags.length === 0) return items;
    return items.filter((it) => selectedTags.every((t) => (it.tags || []).includes(t)));
  }, [items, selectedTags]);

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const providerLabel = (p: string | null) => {
    if (!p) return "";
    return PROVIDER_LABELS[p as Provider] ?? p;
  };

  const openDetail = async (id: string) => {
    const art = await window.api.getArtifact(id);
    if (!art) return;
    setDetail(art);
    setDetailTitle(art.title);
    setDetailTags(dedupeTags(art.tags || []));
    setTagInputText("");
    setDetailContent(art.content);
    setEditingContent(false);
    setSavedFlash(false);
    setCopiedFlash(false);
  };

  const closeDetail = () => {
    setDetail(null);
  };

  const commitTagInput = () => {
    if (!tagInputText.trim()) return;
    const added = parseTags(tagInputText);
    setDetailTags((prev) => dedupeTags([...prev, ...added]));
    setTagInputText("");
  };

  const removeDetailTag = (tag: string) => {
    setDetailTags((prev) => prev.filter((t) => t !== tag));
  };

  const saveDetail = async () => {
    if (!detail) return;
    const title = detailTitle.trim() || detail.title;
    const tags = dedupeTags(detailTags);
    await window.api.saveArtifact({ id: detail.id, title, tags, content: detailContent });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    await refresh(query);
    const fresh = await window.api.getArtifact(detail.id);
    if (fresh) {
      setDetail(fresh);
      setDetailTitle(fresh.title);
      setDetailTags(dedupeTags(fresh.tags || []));
      setDetailContent(fresh.content);
    }
  };

  const exportDetail = async () => {
    if (!detail) return;
    await window.api.exportArtifact(detail.id);
  };

  const copyDetail = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detailContent);
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1500);
    } catch {
      // クリップボード権限が無い環境などは無視
    }
  };

  const deleteDetail = async () => {
    if (!detail) return;
    if (!confirm("この成果物を削除しますか?")) return;
    await window.api.deleteArtifact(detail.id);
    setDetail(null);
    await refresh(query);
  };

  const deleteFromRow = async (id: string) => {
    if (!confirm("この成果物を削除しますか?")) return;
    await window.api.deleteArtifact(id);
    await refresh(query);
  };

  const openManualAdd = () => setManualAdd({ title: "", tags: "", content: "" });

  const saveManualAdd = async () => {
    if (!manualAdd) return;
    if (!manualAdd.title.trim()) {
      alert("タイトルを入力してください");
      return;
    }
    const tags = parseTags(manualAdd.tags);
    await window.api.saveArtifact({ title: manualAdd.title.trim(), tags, content: manualAdd.content, project_id: projectIdForNew(projectScope) });
    setManualAdd(null);
    await refresh(query);
  };

  return (
    <div>
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">成果物保管庫</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={openManualAdd}>
              + 手動で追加
            </button>
          </span>
        </div>
        <p className="muted" style={{ marginBottom: 8 }}>
          AIが作った資料・コード・文章を完成品として保管する場所です。共有バイブルとは異なり、ここに保存した内容はAIのプロンプトには一切注入されません。
        </p>

        <div style={{ marginBottom: 10 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="キーワード検索(タイトル・本文・タグ)"
            style={{ width: "100%" }}
          />
        </div>

        {allTags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={"tag-chip" + (selectedTags.includes(tag) ? " active" : "")}
                onClick={() => toggleTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {displayed.length === 0 && (
          <div className="empty-state">
            チャットのAI応答にある「📦 保存」ボタン、またはここから手動で追加できます
          </div>
        )}

        {displayed.map((it) => (
          <div className="list-row" key={it.id} style={{ cursor: "pointer" }} onClick={() => openDetail(it.id)}>
            <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
              {it.context && (
                <span
                  className="muted"
                  style={{
                    fontSize: 10,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`会話「${it.context.conversation_title}」/ 指示:「${it.context.prompt_excerpt}」`}
                >
                  💬 {it.context.conversation_title}
                  {it.context.prompt_excerpt && <> › 「{it.context.prompt_excerpt}」</>}
                </span>
              )}
              <span style={{ fontWeight: 600 }}>{it.title}</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                <ProjectBadge projectId={it.project_id} projects={projects} scope={projectScope} />
                {(it.tags || []).map((t) => (
                  <span key={t} className="tag-chip" style={{ cursor: "default" }}>
                    {t}
                  </span>
                ))}
                {it.card_name && (
                  <span className="badge">
                    {it.provider && (
                      <span
                        className="chart-chip"
                        style={{ background: `var(--chart-${it.provider})`, marginRight: 4 }}
                      />
                    )}
                    {it.card_name}
                    {it.provider ? ` · ${providerLabel(it.provider)}` : ""}
                  </span>
                )}
                <span className="muted" style={{ fontSize: 10 }}>
                  {it.created_at?.slice(0, 10)}
                </span>
              </span>
            </span>
            <span className="row-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn small secondary" onClick={() => openDetail(it.id)}>
                開く
              </button>
              <button className="btn small danger" onClick={() => deleteFromRow(it.id)}>
                削除
              </button>
            </span>
          </div>
        ))}
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div className="modal" style={{ width: "min(820px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
            <h2>成果物を編集</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {detail.context && (
                <div className="muted" style={{ fontSize: 11 }}>
                  💬 {detail.context.conversation_title}
                  {detail.context.prompt_excerpt && <> › 指示:「{detail.context.prompt_excerpt}」</>}
                </div>
              )}
              <input
                value={detailTitle}
                onChange={(e) => setDetailTitle(e.target.value)}
                placeholder="タイトル"
              />

              <div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                  {detailTags.map((t) => (
                    <span key={t} className="tag-chip active">
                      {t}
                      <span className="tag-x" onClick={() => removeDetailTag(t)}>
                        ×
                      </span>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={tagInputText}
                  onChange={(e) => setTagInputText(e.target.value)}
                  onBlur={commitTagInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      commitTagInput();
                    }
                  }}
                  placeholder="タグを追加(カンマ区切り・Enterで確定)"
                  style={{ width: "100%" }}
                />
              </div>

              <div className="muted">
                作成AI: {detail.card_name || "(手動追加)"}
                {detail.provider ? ` · ${providerLabel(detail.provider)}` : ""}
                {detail.model ? ` · ${detail.model}` : ""}
                <br />
                作成日時: {detail.created_at?.slice(0, 16).replace("T", " ")}
                {detail.updated_at && detail.updated_at !== detail.created_at
                  ? `(更新 ${detail.updated_at.slice(0, 16).replace("T", " ")})`
                  : ""}
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="muted">本文</span>
                  <button
                    type="button"
                    className="btn small secondary"
                    onClick={() => setEditingContent((v) => !v)}
                  >
                    ✎ 本文を編集{editingContent ? "(プレビューに戻す)" : ""}
                  </button>
                </div>
                {editingContent ? (
                  <textarea
                    value={detailContent}
                    onChange={(e) => setDetailContent(e.target.value)}
                    style={{ width: "100%", minHeight: 320, resize: "vertical", fontFamily: "Consolas, monospace" }}
                  />
                ) : (
                  <div className="artifact-preview">{detailContent}</div>
                )}
              </div>

              {savedFlash && <div style={{ color: "var(--accent)", fontSize: 12 }}>✓ 保存しました</div>}
              {copiedFlash && <div style={{ color: "var(--accent)", fontSize: 12 }}>✓ コピーしました</div>}
            </div>

            <div className="modal-actions">
              <button className="btn small secondary" onClick={exportDetail}>
                💾 ファイルに書き出し
              </button>
              <button className="btn small secondary" onClick={copyDetail}>
                📋 コピー
              </button>
              <button className="btn small danger" onClick={deleteDetail}>
                削除
              </button>
              <button className="btn secondary" onClick={closeDetail}>
                閉じる
              </button>
              <button className="btn" onClick={saveDetail}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {manualAdd && (
        <div className="modal-backdrop" onClick={() => setManualAdd(null)}>
          <div className="modal" style={{ width: "min(760px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
            <h2>成果物を手動で追加</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={manualAdd.title}
                onChange={(e) => setManualAdd({ ...manualAdd, title: e.target.value })}
                placeholder="タイトル"
              />
              <input
                value={manualAdd.tags}
                onChange={(e) => setManualAdd({ ...manualAdd, tags: e.target.value })}
                placeholder="タグ(カンマ区切り・任意)"
              />
              <textarea
                value={manualAdd.content}
                onChange={(e) => setManualAdd({ ...manualAdd, content: e.target.value })}
                placeholder="本文"
                style={{ minHeight: 280, resize: "vertical", fontFamily: "Consolas, monospace" }}
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setManualAdd(null)}>
                キャンセル
              </button>
              <button className="btn" onClick={saveManualAdd}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
