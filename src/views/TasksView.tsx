import { useCallback, useEffect, useState } from "react";
import type { Project, ProjectScope, Task, TaskSuggestion } from "../types";
import { matchesProject, projectIdForNew } from "../types";
import ProjectBadge from "../components/ProjectBadge";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function parseDateOnly(dateStr: string): Date {
  // "YYYY-MM-DD" を安全にローカル日付として解釈する
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function todayDateOnly(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// §5.4 期日表示: 「7/9(明日)」「7/12(土)」形式。プログレスバーは使わない。
function formatDueDate(dueDate: string): { text: string; urgent: boolean } {
  const due = parseDateOnly(dueDate);
  due.setHours(0, 0, 0, 0);
  const today = todayDateOnly();
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  let label: string;
  if (diffDays === 0) label = "今日";
  else if (diffDays === 1) label = "明日";
  else label = WEEKDAYS[due.getDay()];

  let text = `${due.getMonth() + 1}/${due.getDate()}(${label})`;
  if (diffDays < 0) {
    text += `(${Math.abs(diffDays)}日超過)`;
  }
  const urgent = diffDays <= 1;
  return { text, urgent };
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function TasksView({ projects, projectScope }: { projects: Project[]; projectScope: ProjectScope }) {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scanFolders, setScanFolders] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgressFile, setScanProgressFile] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const loadSuggestions = useCallback(async () => {
    setSuggestions(await window.api.listSuggestions());
  }, []);

  const loadTasks = useCallback(async () => {
    const list = await window.api.listTasks();
    setTasks(list.filter((t) => matchesProject(t.project_id, projectScope)));
  }, [projectScope]);

  const loadFolders = useCallback(async () => {
    try {
      const s = await window.api.getSettings();
      setScanFolders(s.scan?.folders ?? []);
    } catch {
      setScanFolders([]);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
    loadTasks();
    loadFolders();
  }, [loadSuggestions, loadTasks, loadFolders]);

  // §4.6 スキャン進捗イベント購読
  useEffect(() => {
    const unsubscribe = window.api.onAppEvent((channel, payload) => {
      if (channel === "scan:progress") {
        setScanProgressFile(payload?.file ?? null);
      } else if (channel === "scan:detected") {
        loadSuggestions();
      }
    });
    return unsubscribe;
  }, [loadSuggestions]);

  const doScan = async () => {
    setScanning(true);
    setScanResult(null);
    setScanError(null);
    setScanProgressFile(null);
    try {
      const r = await window.api.scanNow();
      if (r.skipped) {
        setScanError("スキャン対象フォルダが設定されていません。設定画面でフォルダを指定してください。");
      } else if (r.error) {
        setScanError(r.error);
      } else {
        setScanResult(`${r.scanned ?? 0}件のファイルを確認、${r.detected ?? 0}件の候補を検知しました`);
      }
    } catch (e: any) {
      setScanError(String(e?.message ?? e));
    } finally {
      setScanning(false);
      setScanProgressFile(null);
      await loadSuggestions();
    }
  };

  const handleResolve = async (id: string, accept: boolean) => {
    const task = await window.api.resolveSuggestion(id, accept);
    if (accept && task) {
      await window.api.saveTask({ id: task.id, project_id: projectIdForNew(projectScope) });
    }
    await loadSuggestions();
    if (accept) await loadTasks();
  };

  const toggleStatus = async (t: Task) => {
    const status = t.status === "open" ? "done" : "open";
    await window.api.saveTask({
      id: t.id,
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    });
    await loadTasks();
  };

  const removeTask = async (id: string) => {
    if (!confirm("このタスクを削除しますか?")) return;
    await window.api.deleteTask(id);
    await loadTasks();
  };

  const addTask = async () => {
    if (!newTitle.trim()) {
      alert("タイトルを入力してください");
      return;
    }
    await window.api.saveTask({
      title: newTitle.trim(),
      due_date: newDueDate || null,
      status: "open",
      source: null,
      completed_at: null,
      project_id: projectIdForNew(projectScope),
    });
    setNewTitle("");
    setNewDueDate("");
    await loadTasks();
  };

  const openTasks = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  const doneTasks = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));

  return (
    <div>
      {/* §4.6-2 スキャン操作 */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">締め切りスキャン</span>
          <span className="panel-title-meta">
            {scanFolders.length > 0 && (
              <button className="btn small" onClick={doScan} disabled={scanning}>
                {scanning ? "スキャン中…" : "🔍 今すぐスキャン"}
              </button>
            )}
          </span>
        </div>
        {scanFolders.length === 0 ? (
          <div className="muted">
            スキャン対象フォルダが未設定です。設定画面でフォルダを追加すると、締め切りの自動検知が使えるようになります。
          </div>
        ) : (
          <>
            {scanning && (
              <div className="muted">
                スキャン中…{scanProgressFile ? ` ${scanProgressFile}` : ""}
              </div>
            )}
            {!scanning && scanResult && <div className="muted">{scanResult}</div>}
            {!scanning && scanError && (
              <div className="muted" style={{ color: "var(--urgent)" }}>
                {scanError}
              </div>
            )}
          </>
        )}
      </div>

      {/* §4.6-1 検知候補: 0件なら非表示 */}
      {suggestions.length > 0 && (
        <div className="panel">
          <div className="panel-title-row">
            <span className="panel-title">これは締め切り?</span>
          </div>
          {suggestions.map((s) => {
            const due = formatDueDate(s.due_date);
            return (
              <div className="suggest-card" key={s.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{s.title}</span>
                  <span className={"due-label" + (due.urgent ? " urgent" : "")}>{due.text}</span>
                  <span className="badge">確信度 {Math.round(s.confidence * 100)}%</span>
                  <span className="badge">{basename(s.file)}</span>
                </div>
                <div className="suggest-quote">{s.excerpt}</div>
                <div className="row-actions" style={{ marginLeft: 0 }}>
                  <button className="btn small" onClick={() => handleResolve(s.id, true)}>
                    タスクに追加
                  </button>
                  <button className="btn small secondary" onClick={() => handleResolve(s.id, false)}>
                    無視
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* §4.6-5 手動追加 + §4.6-3 タスク一覧 */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">タスク</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            style={{ flex: 1, minWidth: 200 }}
            placeholder="タスクを入力"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
          />
          <input
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
          <button className="btn small" onClick={addTask}>
            追加
          </button>
        </div>

        {openTasks.length === 0 && doneTasks.length === 0 && (
          <div className="empty-state">タスクはまだありません</div>
        )}

        {openTasks.map((t) => {
          const due = t.due_date ? formatDueDate(t.due_date) : null;
          return (
            <div className="list-row" key={t.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                <ProjectBadge projectId={t.project_id} projects={projects} scope={projectScope} />
              </div>
              <span className="row-actions">
                {due && <span className={"due-label" + (due.urgent ? " urgent" : "")}>{due.text}</span>}
                {t.source && <span className="badge">{basename(t.source.file)}</span>}
                <button className="btn small secondary" onClick={() => toggleStatus(t)}>
                  完了
                </button>
                <button className="btn small danger" onClick={() => removeTask(t.id)}>
                  削除
                </button>
              </span>
            </div>
          );
        })}

        {doneTasks.length > 0 && (
          <>
            <div className="panel-title-row" style={{ marginTop: 14 }}>
              <span className="panel-title">完了済み</span>
            </div>
            {doneTasks.map((t) => {
              const due = t.due_date ? formatDueDate(t.due_date) : null;
              return (
                <div className="list-row" key={t.id}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="task-done">{t.title}</div>
                    <ProjectBadge projectId={t.project_id} projects={projects} scope={projectScope} />
                  </div>
                  <span className="row-actions">
                    {due && <span className="due-label">{due.text}</span>}
                    {t.source && <span className="badge">{basename(t.source.file)}</span>}
                    <button className="btn small secondary" onClick={() => toggleStatus(t)}>
                      戻す
                    </button>
                    <button className="btn small danger" onClick={() => removeTask(t.id)}>
                      削除
                    </button>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
