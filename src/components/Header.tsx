import { useState } from "react";
import type { Project, ProjectScope } from "../types";

export default function Header({
  title,
  themeMode,
  onToggleTheme,
  projects,
  currentProjectId,
  onProjectChange,
  onProjectsChanged,
}: {
  title: string;
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
  projects: Project[];
  currentProjectId: ProjectScope;
  onProjectChange: (id: ProjectScope) => Promise<void>;
  onProjectsChanged: () => Promise<void>;
}) {
  const [modal, setModal] = useState<"new" | "manage" | null>(null);
  const [newName, setNewName] = useState("");
  const activeProjects = projects.filter((p) => !p.archived);

  const selectValue = currentProjectId === null ? "__all__" : currentProjectId;
  const handleSelect = async (value: string) => {
    if (value === "__new__") {
      setNewName("");
      setModal("new");
      return;
    }
    if (value === "__manage__") {
      setModal("manage");
      return;
    }
    await onProjectChange(value === "__all__" ? null : value === "uncategorized" ? "uncategorized" : value);
  };

  const createProject = async () => {
    if (!newName.trim()) return;
    const created = await window.api.saveProject({ name: newName.trim() });
    await onProjectsChanged();
    await onProjectChange(created.id);
    setModal(null);
  };

  const renameProject = async (project: Project) => {
    const name = prompt("新しいプロジェクト名", project.name)?.trim();
    if (!name || name === project.name) return;
    await window.api.saveProject({ id: project.id, name });
    await onProjectsChanged();
  };

  const archiveProject = async (project: Project) => {
    if (!confirm(`「${project.name}」をアーカイブしますか? 所属データは残ります。`)) return;
    await window.api.archiveProject(project.id);
    if (currentProjectId === project.id) await onProjectChange(null);
    await onProjectsChanged();
  };

  return (
    <>
      <div className="header">
        <div className="header-title">{title}</div>
        <div className="header-spacer" />
        <select
          aria-label="プロジェクト切替"
          value={selectValue}
          onChange={(e) => handleSelect(e.target.value)}
          style={{ width: 190, marginRight: 8 }}
        >
          <option value="__all__">全体</option>
          {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="uncategorized">未分類</option>
          <option disabled>──────────</option>
          <option value="__new__">+ 新規プロジェクト</option>
          <option value="__manage__">プロジェクト管理…</option>
        </select>
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={themeMode === "light" ? "ダークモードに切替" : "ライトモードに切替"}
        >
          {themeMode === "light" ? "🌙" : "☀️"}
        </button>
      </div>

      {modal === "new" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
            <h2>新規プロジェクト</h2>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="プロジェクト名" onKeyDown={(e) => e.key === "Enter" && createProject()} />
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setModal(null)}>キャンセル</button>
              <button className="btn" onClick={createProject} disabled={!newName.trim()}>作成</button>
            </div>
          </div>
        </div>
      )}

      {modal === "manage" && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 94vw)" }}>
            <h2>プロジェクト管理</h2>
            {activeProjects.length === 0 && <div className="empty-state">プロジェクトがありません</div>}
            {activeProjects.map((p) => (
              <div className="list-row" key={p.id}>
                <span>{p.name}</span>
                <span className="row-actions">
                  <button className="btn small secondary" onClick={() => renameProject(p)}>改名</button>
                  <button className="btn small danger" onClick={() => archiveProject(p)}>アーカイブ</button>
                </span>
              </div>
            ))}
            <div className="modal-actions"><button className="btn" onClick={() => setModal(null)}>閉じる</button></div>
          </div>
        </div>
      )}
    </>
  );
}
