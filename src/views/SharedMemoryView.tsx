import { useEffect, useState } from "react";
import type { Project, ProjectScope, SharedDoc, SharedDocMeta } from "../types";
import { matchesProject, projectIdForNew } from "../types";
import ProjectBadge from "../components/ProjectBadge";

export default function SharedMemoryView({ projects, projectScope }: { projects: Project[]; projectScope: ProjectScope }) {
  const [docs, setDocs] = useState<SharedDocMeta[]>([]);
  const [editing, setEditing] = useState<Partial<SharedDoc> | null>(null);

  const refresh = async () => {
    const list = await window.api.listDocs();
    setDocs(list.filter((d) => matchesProject(d.project_id, projectScope)));
  };

  useEffect(() => {
    refresh();
  }, [projectScope]);

  const open = async (id: string) => {
    const doc = await window.api.getDoc(id);
    if (doc) setEditing(doc);
  };

  const save = async () => {
    if (!editing?.title?.trim()) {
      alert("タイトルを入力してください");
      return;
    }
    await window.api.saveDoc({ ...editing, project_id: editing.project_id ?? projectIdForNew(projectScope) });
    setEditing(null);
    await refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("この資料を削除しますか?(参照しているカードからも外れます)")) return;
    await window.api.deleteDoc(id);
    await refresh();
  };

  return (
    <div>
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">共有バイブル(共有メモリ)</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={() => setEditing({ title: "", content: "", project_id: projectIdForNew(projectScope) })}>
              + 新規資料
            </button>
          </span>
        </div>
        <p className="muted" style={{ marginBottom: 8 }}>
          全カードが参照できる資料置き場です(小説の制作バイブル等)。役割カードの「参照する共有資料」で
          登録すると、API呼び出し時にシステムプロンプトへ注入されます。
        </p>
        {docs.length === 0 && <div className="empty-state">まだ資料がありません</div>}
        {docs.map((d) => (
          <div className="list-row" key={d.id}>
            <span>{d.title} <ProjectBadge projectId={d.project_id} projects={projects} scope={projectScope} /></span>
            <span className="row-actions">
              <span className="muted" style={{ fontSize: 10 }}>
                更新 {d.updated_at?.slice(0, 10)}
              </span>
              <button className="btn small secondary" onClick={() => open(d.id)}>
                編集
              </button>
              <button className="btn small danger" onClick={() => remove(d.id)}>
                削除
              </button>
            </span>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 94vw)" }}>
            <h2>{editing.id ? "資料を編集" : "新規資料"}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={editing.title ?? ""}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="タイトル(例: 制作バイブル 第1部)"
              />
              <textarea
                value={editing.content ?? ""}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder="Markdownで内容を記述"
                style={{ minHeight: 320, resize: "vertical", fontFamily: "Consolas, monospace" }}
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setEditing(null)}>
                キャンセル
              </button>
              <button className="btn" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
