import { useState } from "react";
import type { ModelInfo, Provider, WizardProposal, WizardRole } from "../types";
import { PROVIDER_LABELS } from "../types";

interface EditableRole extends WizardRole {
  selected: boolean;
}

function modelKey(pIdx: number, rIdx: number): string {
  return `${pIdx}:${rIdx}`;
}

export default function WizardModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [creating, setCreating] = useState(false);

  const [proposals, setProposals] = useState<WizardProposal[]>([]);
  const [rolesByProposal, setRolesByProposal] = useState<EditableRole[][]>([]);
  const [modelOptions, setModelOptions] = useState<Record<string, ModelInfo[]>>({});
  const [modelFallback, setModelFallback] = useState<Record<string, boolean>>({});

  const loadModelsForRole = async (pIdx: number, rIdx: number, provider: Provider) => {
    const key = modelKey(pIdx, rIdx);
    try {
      const r = await window.api.listModels(provider);
      if (r.error) {
        setModelFallback((prev) => ({ ...prev, [key]: true }));
        setModelOptions((prev) => ({ ...prev, [key]: [] }));
      } else {
        setModelFallback((prev) => ({ ...prev, [key]: false }));
        setModelOptions((prev) => ({ ...prev, [key]: r.models }));
      }
    } catch {
      setModelFallback((prev) => ({ ...prev, [key]: true }));
      setModelOptions((prev) => ({ ...prev, [key]: [] }));
    }
  };

  const updateRole = (pIdx: number, rIdx: number, patch: Partial<EditableRole>) => {
    setRolesByProposal((prev) => {
      const next = prev.map((arr) => arr.slice());
      next[pIdx] = next[pIdx].slice();
      next[pIdx][rIdx] = { ...next[pIdx][rIdx], ...patch };
      return next;
    });
  };

  const runWizard = async () => {
    if (!goal.trim()) {
      alert("やりたいことを入力してください");
      return;
    }
    setRunning(true);
    try {
      const result = await window.api.runWizard(goal.trim());
      setProposals(result);
      const roles: EditableRole[][] = result.map((p) =>
        p.roles.map((r) => ({ ...r, selected: true }))
      );
      setRolesByProposal(roles);
      setStep(2);
      result.forEach((p, pIdx) => {
        p.roles.forEach((r, rIdx) => {
          loadModelsForRole(pIdx, rIdx, r.provider);
        });
      });
    } catch (e: any) {
      alert("AIへの相談に失敗しました: " + String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  const createCards = async () => {
    const toCreate: EditableRole[] = [];
    for (const roles of rolesByProposal) {
      for (const r of roles) {
        if (r.selected) toCreate.push(r);
      }
    }
    if (toCreate.length === 0) {
      alert("採用する役割を1つ以上選択してください");
      return;
    }
    for (const r of toCreate) {
      if (!r.name.trim()) {
        alert("役割名が空の項目があります");
        return;
      }
    }
    setCreating(true);
    try {
      for (const r of toCreate) {
        await window.api.saveCard({
          name: r.name.trim(),
          provider: r.provider,
          model: r.model,
          system_prompt: r.system_prompt,
          shared_memory_refs: [],
          tools: { web_fetch: false, folder_scan: false },
          triggers: [],
        });
      }
      await onCreated();
      alert(`${toCreate.length}件のカードを作成しました`);
      onClose();
    } catch (e: any) {
      alert("カード作成に失敗しました: " + String(e?.message ?? e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 94vw)" }}>
        <h2>役割仕分けウィザード</h2>

        {step === 1 && (
          <>
            <div className="form-grid">
              <label>やりたいこと</label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="小説を書きたい。執筆と矛盾チェックと校正を分担させたい"
              />
            </div>
            {running && (
              <div className="muted" style={{ marginTop: 10 }}>
                接続済みの各AIに相談中…
              </div>
            )}
            <div className="modal-actions">
              <button className="btn secondary" onClick={onClose} disabled={running}>
                キャンセル
              </button>
              <button className="btn" onClick={runWizard} disabled={running}>
                AIに相談する
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {proposals.length === 0 && <div className="empty-state">提案がありませんでした</div>}
            {proposals.map((p, pIdx) => (
              <div className="wizard-proposal" key={pIdx}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="chart-chip" style={{ background: `var(--chart-${p.provider})` }} />
                  <span className="badge">{PROVIDER_LABELS[p.provider]}</span>
                  {p.model && <span className="muted">{p.model}</span>}
                </div>
                {p.error && (
                  <div className="muted" style={{ color: "var(--urgent)", marginBottom: 8 }}>
                    エラー: {p.error}
                  </div>
                )}
                {p.raw && (
                  <details style={{ marginBottom: 8 }}>
                    <summary className="muted">応答の原文を表示</summary>
                    <div className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>
                      {p.raw}
                    </div>
                  </details>
                )}
                {(rolesByProposal[pIdx] ?? []).map((r, rIdx) => {
                  const key = modelKey(pIdx, rIdx);
                  const opts = modelOptions[key] ?? [];
                  const fallback = modelFallback[key] ?? false;
                  return (
                    <div className="wizard-role" key={rIdx}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) => updateRole(pIdx, rIdx, { selected: e.target.checked })}
                        style={{ marginTop: 9 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                          <input
                            value={r.name}
                            onChange={(e) => updateRole(pIdx, rIdx, { name: e.target.value })}
                            placeholder="役割名"
                            style={{ minWidth: 140, flex: "1 1 140px" }}
                          />
                          <select
                            value={r.provider}
                            onChange={(e) => {
                              const provider = e.target.value as Provider;
                              updateRole(pIdx, rIdx, { provider, model: "" });
                              loadModelsForRole(pIdx, rIdx, provider);
                            }}
                          >
                            <option value="anthropic">Claude</option>
                            <option value="openai">GPT</option>
                            <option value="google">Gemini</option>
                          </select>
                          {fallback ? (
                            <input
                              value={r.model}
                              onChange={(e) => updateRole(pIdx, rIdx, { model: e.target.value })}
                              placeholder="モデルIDを入力"
                              style={{ minWidth: 160, flex: "1 1 160px" }}
                            />
                          ) : (
                            <select
                              value={r.model}
                              onChange={(e) => updateRole(pIdx, rIdx, { model: e.target.value })}
                              style={{ minWidth: 160, flex: "1 1 160px" }}
                            >
                              <option value="">(選択してください)</option>
                              {opts.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                              {r.model && !opts.some((m) => m.id === r.model) && (
                                <option value={r.model}>{r.model}</option>
                              )}
                            </select>
                          )}
                        </div>
                        <div className="muted">{r.reason}</div>
                        <details style={{ marginTop: 6 }}>
                          <summary className="muted">システムプロンプト下書き</summary>
                          <textarea
                            value={r.system_prompt}
                            onChange={(e) => updateRole(pIdx, rIdx, { system_prompt: e.target.value })}
                            style={{ width: "100%", marginTop: 6, minHeight: 90 }}
                          />
                        </details>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn secondary" onClick={onClose} disabled={creating}>
                キャンセル
              </button>
              <button className="btn" onClick={createCards} disabled={creating}>
                選択した役割でカードを作成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
