import { useEffect, useRef, useState } from "react";
import type { Clarification, Pipeline, PipelineStep, Project, ProjectScope, RoleCard } from "../types";
import { matchesProject, projectIdForNew, PROVIDER_LABELS } from "../types";
import ProjectBadge from "../components/ProjectBadge";

const EMPTY_PIPELINE: Partial<Pipeline> = {
  name: "",
  allow_clarification: false,
  steps: [],
};

interface RunState {
  runId: string;
  pipelineName: string;
  totalSteps: number;
  currentStepIndex: number | null;
  stepStatus: Record<number, "running" | "done">;
  stepOutputs: Record<number, string>;
  stepCardNames: Record<number, string>;
  clarification: { stepIndex: number; cardName: string; clarification: Clarification; message?: string } | null;
  done: { output: string } | null;
  error: string | null;
}

// §4.16 確認質問プロトコル用の質問カード
function ClarifyCard({
  cardName,
  message,
  clarification,
  onSubmit,
}: {
  cardName: string;
  message?: string;
  clarification: Clarification;
  onSubmit: (answerText: string) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => clarification.questions.map(() => ""));

  useEffect(() => {
    setAnswers(clarification.questions.map(() => ""));
  }, [clarification]);

  const setAnswer = (i: number, v: string) => {
    setAnswers((a) => a.map((x, idx) => (idx === i ? v : x)));
  };

  const submit = () => {
    const text = clarification.questions
      .map((q, i) => `${q.text}: ${(answers[i] ?? "").trim() || "(未回答)"}`)
      .join("\n");
    onSubmit(text);
  };

  return (
    <div className="clarify-card">
      <div className="clarify-title">{cardName} からの確認質問</div>
      {message && (
        <p className="muted" style={{ marginBottom: 8 }}>
          {message}
        </p>
      )}
      {clarification.questions.map((q, i) => (
        <div className="clarify-q" key={i}>
          <div className="clarify-text">{q.text}</div>
          <div className="clarify-options">
            {q.options.map((opt) => (
              <button
                key={opt}
                className={"clarify-option" + (answers[i] === opt ? " selected" : "")}
                onClick={() => setAnswer(i, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
          {q.allow_free_text && (
            <input
              className="clarify-free"
              placeholder="自由入力"
              value={answers[i] ?? ""}
              onChange={(e) => setAnswer(i, e.target.value)}
            />
          )}
        </div>
      ))}
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <button className="btn" onClick={submit}>
          回答して再開
        </button>
      </div>
    </div>
  );
}

export default function PipelinesView({ cards, projects, projectScope }: { cards: RoleCard[]; projects: Project[]; projectScope: ProjectScope }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [editing, setEditing] = useState<Partial<Pipeline> | null>(null);

  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [inputText, setInputText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const [run, setRun] = useState<RunState | null>(null);
  const runIdRef = useRef<string | null>(null);

  const [pending, setPending] = useState<
    { runId: string; conversationId: string; stepIndex: number; pipelineName: string }[]
  >([]);

  const refresh = async () => {
    const list = await window.api.listPipelines();
    setPipelines(list.filter((p) => matchesProject(p.project_id, projectScope)));
  };

  useEffect(() => {
    refresh();
    window.api.pendingClarifications().then(setPending);
  }, [projectScope]);

  // パイプライン実行イベント購読(§4.4)
  useEffect(() => {
    const off = window.api.onAppEvent((channel, payload) => {
      if (!channel.startsWith("pipeline:")) return;
      if (!payload || payload.runId !== runIdRef.current) return;
      setRun((r) => {
        if (!r) return r;
        switch (channel) {
          case "pipeline:start":
            return {
              ...r,
              pipelineName: payload.pipelineName ?? r.pipelineName,
              totalSteps: payload.totalSteps ?? r.totalSteps,
            };
          case "pipeline:step-start":
            return {
              ...r,
              currentStepIndex: payload.stepIndex,
              totalSteps: payload.totalSteps ?? r.totalSteps,
              stepStatus: { ...r.stepStatus, [payload.stepIndex]: "running" },
              stepCardNames: { ...r.stepCardNames, [payload.stepIndex]: payload.cardName },
            };
          case "pipeline:delta":
            return {
              ...r,
              stepOutputs: {
                ...r.stepOutputs,
                [payload.stepIndex]: (r.stepOutputs[payload.stepIndex] ?? "") + payload.delta,
              },
            };
          case "pipeline:step-done":
            return { ...r, stepStatus: { ...r.stepStatus, [payload.stepIndex]: "done" } };
          case "pipeline:clarification":
            return {
              ...r,
              clarification: {
                stepIndex: payload.stepIndex,
                cardName: payload.cardName,
                clarification: payload.clarification,
                message: payload.message,
              },
            };
          case "pipeline:done":
            return { ...r, done: { output: payload.output }, clarification: null };
          case "pipeline:error":
            return { ...r, error: String(payload.error ?? "不明なエラー"), clarification: null };
          default:
            return r;
        }
      });
    });
    return off;
  }, []);

  const removePipeline = async (id: string) => {
    if (!confirm("このパイプラインを削除しますか?")) return;
    await window.api.deletePipeline(id);
    if (selectedPipelineId === id) setSelectedPipelineId("");
    await refresh();
  };

  // ---- 編集モーダル: ステップ配列エディタ ----
  const updateStep = (i: number, patch: Partial<PipelineStep>) => {
    if (!editing) return;
    const steps = [...(editing.steps ?? [])];
    steps[i] = { ...steps[i], ...patch };
    setEditing({ ...editing, steps });
  };

  const addStep = () => {
    if (!editing) return;
    const steps = [...(editing.steps ?? [])];
    steps.push({
      role_card_id: cards[0]?.id ?? "",
      input_from: steps.length === 0 ? "user" : "previous",
      instruction: "",
    });
    setEditing({ ...editing, steps });
  };

  const removeStep = (i: number) => {
    if (!editing) return;
    const steps = (editing.steps ?? []).filter((_, idx) => idx !== i);
    setEditing({ ...editing, steps });
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    if (!editing) return;
    const steps = [...(editing.steps ?? [])];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const tmp = steps[i];
    steps[i] = steps[j];
    steps[j] = tmp;
    setEditing({ ...editing, steps });
  };

  const save = async () => {
    if (!editing?.name?.trim()) {
      alert("パイプライン名を入力してください");
      return;
    }
    const steps = editing.steps ?? [];
    if (steps.length === 0) {
      alert("ステップを1つ以上追加してください");
      return;
    }
    if (steps.some((s) => !s.role_card_id)) {
      alert("すべてのステップで担当カードを選択してください");
      return;
    }
    await window.api.savePipeline({ ...editing, project_id: editing.project_id ?? projectIdForNew(projectScope) });
    setEditing(null);
    await refresh();
  };

  // ---- 実行パネル ----
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? null;

  const loadFromFile = async () => {
    setFileError(null);
    const path = await window.api.chooseFile({
      title: "文書ファイルを選択",
      filters: [{ name: "文書", extensions: ["pdf", "docx", "pptx"] }],
    });
    if (!path) return;
    const r = await window.api.extractFile(path);
    if (r.error) {
      setFileError(r.error);
      return;
    }
    if (r.text != null) setInputText(r.text);
  };

  const startRun = async () => {
    if (!selectedPipeline) {
      alert("実行するパイプラインを選択してください");
      return;
    }
    if (!inputText.trim()) {
      alert("入力テキストを入力してください");
      return;
    }
    const runId = "run_" + Date.now().toString(36);
    runIdRef.current = runId;
    setRun({
      runId,
      pipelineName: selectedPipeline.name,
      totalSteps: selectedPipeline.steps.length,
      currentStepIndex: null,
      stepStatus: {},
      stepOutputs: {},
      stepCardNames: {},
      clarification: null,
      done: null,
      error: null,
    });
    try {
      await window.api.runPipeline({ pipelineId: selectedPipeline.id, input: inputText, runId, projectId: selectedPipeline.project_id ?? projectIdForNew(projectScope) });
    } catch (e: any) {
      setRun((r) => (r ? { ...r, error: String(e?.message ?? e) } : r));
    }
  };

  const abortRun = async () => {
    if (!run) return;
    await window.api.abortPipeline(run.runId);
  };

  const answerClarification = async (answerText: string) => {
    if (!run) return;
    await window.api.answerPipeline({ runId: run.runId, answerText });
    setRun((r) => (r ? { ...r, clarification: null } : r));
  };

  return (
    <div>
      {pending.length > 0 && (
        <div className="panel">
          <div className="panel-title-row">
            <span className="panel-title">回答待ちのパイプライン</span>
          </div>
          {pending.map((p) => (
            <div className="muted" key={p.runId} style={{ padding: "4px 0" }}>
              {p.pipelineName}(ステップ{p.stepIndex + 1}) — 回答待ちのパイプラインがあります。再実行してください。
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">パイプライン</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={() => setEditing({ ...EMPTY_PIPELINE, project_id: projectIdForNew(projectScope), steps: [] })}>
              + 新規パイプライン
            </button>
          </span>
        </div>
        {pipelines.length === 0 && (
          <div className="empty-state">
            パイプラインは、複数の役割カードを順に実行する自動化フローです。
            <br />
            例:「執筆担当 → 矛盾チェック担当 → 校正担当」
          </div>
        )}
        {pipelines.map((p) => (
          <div className="list-row" key={p.id}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <ProjectBadge projectId={p.project_id} projects={projects} scope={projectScope} />
            </div>
            <span className="row-actions">
              <span className="badge">{p.steps.length} ステップ</span>
              <span className="badge">
                {p.allow_clarification ? "確認質問: 許可" : "確認質問: 保留列挙"}
              </span>
              <button className="btn small" onClick={() => setSelectedPipelineId(p.id)}>
                ▶ 実行
              </button>
              <button className="btn small secondary" onClick={() => setEditing({ ...p, steps: [...p.steps] })}>
                編集
              </button>
              <button className="btn small danger" onClick={() => removePipeline(p.id)}>
                削除
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">パイプラインを実行</span>
        </div>
        <div className="form-grid">
          <label>パイプライン</label>
          <select value={selectedPipelineId} onChange={(e) => setSelectedPipelineId(e.target.value)}>
            <option value="">(選択してください)</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label>入力テキスト</label>
          <div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="パイプラインの最初のステップに渡す入力テキストを入力してください"
              style={{ minHeight: 140, width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button className="btn small secondary" onClick={loadFromFile}>
                📄 ファイルから読み込み
              </button>
            </div>
            {fileError && (
              <div className="msg-error" style={{ marginTop: 6 }}>
                ⚠ {fileError}
              </div>
            )}
          </div>
        </div>
        <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
          <button className="btn" onClick={startRun} disabled={!selectedPipelineId || !inputText.trim()}>
            ▶ 実行
          </button>
        </div>
      </div>

      {run && (
        <div className="panel">
          <div className="panel-title-row">
            <span className="panel-title">実行状況: {run.pipelineName}</span>
            <span className="panel-title-meta">
              {!run.done && !run.error && (
                <button className="btn small danger" onClick={abortRun}>
                  ■ 中断
                </button>
              )}
              {(run.done || run.error) && (
                <button className="btn small secondary" onClick={() => setRun(null)}>
                  ✕ 閉じる
                </button>
              )}
            </span>
          </div>

          <div className="pl-steps">
            {Array.from({ length: run.totalSteps }).map((_, i) => {
              const status = run.stepStatus[i];
              const cardName =
                run.stepCardNames[i] ??
                (selectedPipeline ? cards.find((c) => c.id === selectedPipeline.steps[i]?.role_card_id)?.name : undefined) ??
                `ステップ${i + 1}`;
              return (
                <div className="pl-step" key={i}>
                  <div
                    className={
                      "pl-step-num" +
                      (status === "running" ? " running" : status !== "done" ? " pending" : "")
                    }
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{cardName}</div>
                    {run.stepOutputs[i] !== undefined && (
                      <div className="pl-run-output" style={{ marginTop: 6 }}>
                        {run.stepOutputs[i]}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {run.clarification && (
            <div style={{ marginTop: 12 }}>
              <ClarifyCard
                cardName={run.clarification.cardName}
                message={run.clarification.message}
                clarification={run.clarification.clarification}
                onSubmit={answerClarification}
              />
            </div>
          )}

          {run.error && (
            <div className="msg-error" style={{ marginTop: 10 }}>
              ⚠ {run.error}
            </div>
          )}

          {run.done && (
            <div style={{ marginTop: 12 }}>
              <div className="panel-title" style={{ marginBottom: 6 }}>
                最終出力
              </div>
              <div className="pl-run-output">{run.done.output}</div>
              <p className="muted" style={{ marginTop: 8 }}>
                実行ログはチャット画面の会話『【PL】…』に保存されています
              </p>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 94vw)" }}>
            <h2>{editing.id ? "パイプラインを編集" : "新規パイプライン"}</h2>
            <div className="form-grid">
              <label>名前</label>
              <input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例: 執筆 → 矛盾チェック → 校正"
              />
              <label>確認質問</label>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="allow-clarify"
                  checked={editing.allow_clarification ?? false}
                  onChange={(e) => setEditing({ ...editing, allow_clarification: e.target.checked })}
                />
                <label htmlFor="allow-clarify" style={{ padding: 0 }}>
                  実行中の確認質問を許可(OFF時は不明点を保留事項として列挙させる)
                </label>
              </div>
              <label>ステップ</label>
              <div>
                <div className="pl-steps">
                  {(editing.steps ?? []).map((step, i) => (
                    <div className="pl-step" key={i}>
                      <div className="pl-step-num">{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <select
                            value={step.role_card_id}
                            onChange={(e) => updateStep(i, { role_card_id: e.target.value })}
                            style={{ flex: 1, minWidth: 160 }}
                          >
                            <option value="">(カードを選択)</option>
                            {cards.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}({PROVIDER_LABELS[c.provider]})
                              </option>
                            ))}
                          </select>
                          <select
                            value={step.input_from}
                            onChange={(e) =>
                              updateStep(i, { input_from: e.target.value as "user" | "previous" })
                            }
                            style={{ width: 160 }}
                          >
                            <option value="user">ユーザー入力</option>
                            <option value="previous">前段の出力</option>
                          </select>
                        </div>
                        <textarea
                          value={step.instruction}
                          onChange={(e) => updateStep(i, { instruction: e.target.value })}
                          placeholder="例: 上記の矛盾を指摘して"
                          style={{ minHeight: 70, resize: "vertical" }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn small secondary" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                            ↑
                          </button>
                          <button
                            className="btn small secondary"
                            disabled={i === (editing.steps?.length ?? 0) - 1}
                            onClick={() => moveStep(i, 1)}
                          >
                            ↓
                          </button>
                          <button className="btn small danger" onClick={() => removeStep(i)}>
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(editing.steps ?? []).length === 0 && (
                    <div className="muted">ステップがありません。「+ ステップを追加」で追加してください。</div>
                  )}
                </div>
                <button className="btn small" style={{ marginTop: 8 }} onClick={addStep}>
                  + ステップを追加
                </button>
              </div>
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
