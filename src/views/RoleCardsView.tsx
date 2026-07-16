import { useEffect, useState } from "react";
import type { ModelInfo, Provider, RoleCard, SharedDocMeta } from "../types";
import { PROVIDER_LABELS } from "../types";
import WizardModal from "../components/WizardModal";
import ModelPicker from "../components/ModelPicker";
import { PROVIDER_STRENGTHS, describeModel } from "../modelStrengths";

const EMPTY: Partial<RoleCard> = {
  name: "",
  provider: "anthropic",
  model: "",
  system_prompt: "",
  shared_memory_refs: [],
  tools: { web_fetch: false, folder_scan: false },
};

export default function RoleCardsView({
  cards,
  onChanged,
}: {
  cards: RoleCard[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<RoleCard> | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [docs, setDocs] = useState<SharedDocMeta[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    window.api.listDocs().then(setDocs);
  }, []);

  // 編集中カードのプロバイダのモデル一覧を動的取得(§3)
  useEffect(() => {
    if (!editing?.provider) return;
    setModels([]);
    setModelError(null);
    let cancelled = false;
    window.api.listModels(editing.provider as Provider).then((r) => {
      if (cancelled) return;
      setModels(r.models);
      if (r.error === "no_key") setModelError("APIキー未設定のためモデル一覧を取得できません(設定画面で登録)");
      else if (r.error) setModelError("モデル一覧の取得に失敗: " + r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [editing?.provider]);

  const save = async () => {
    if (!editing?.name?.trim()) {
      alert("カード名を入力してください");
      return;
    }
    await window.api.saveCard(editing);
    setEditing(null);
    await onChanged();
  };

  const remove = async (id: string) => {
    if (!confirm("このカードを削除しますか?")) return;
    await window.api.deleteCard(id);
    await onChanged();
  };

  const toggleRef = (id: string) => {
    if (!editing) return;
    const refs = editing.shared_memory_refs ?? [];
    setEditing({
      ...editing,
      shared_memory_refs: refs.includes(id) ? refs.filter((r) => r !== id) : [...refs, id],
    });
  };

  return (
    <div>
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">役割カード</span>
          <span className="panel-title-meta">
            <button className="btn small secondary" onClick={() => setWizardOpen(true)}>
              🧭 新しい役割の相談
            </button>
            <button className="btn small" onClick={() => setEditing({ ...EMPTY })}>
              + 新規カード
            </button>
          </span>
        </div>
        {cards.length === 0 && (
          <div className="empty-state">
            役割カードは、AIに「役割」を与える単位です。
            <br />
            例:「執筆担当(Claude)」「矛盾チェック(GPT)」「秘書役(Gemini)」
          </div>
        )}
        {cards.map((c) => (
          <div className="list-row" key={c.id}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>
                {c.system_prompt || "(システムプロンプト未設定)"}
              </div>
            </div>
            <span className="row-actions">
              <span className="badge">
                {c.name} · {PROVIDER_LABELS[c.provider]} · {c.model || "モデル未設定"}
              </span>
              {c.shared_memory_refs.length > 0 && (
                <span className="badge">資料 {c.shared_memory_refs.length}</span>
              )}
              <button className="btn small secondary" onClick={() => setEditing({ ...c })}>
                編集
              </button>
              <button className="btn small danger" onClick={() => remove(c.id)}>
                削除
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* AIの特徴 早見表 */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">AIの特徴 早見表</span>
          <span className="panel-title-meta">
            <span className="badge">役割分担の参考に</span>
          </span>
        </div>
        <div className="stat-grid" style={{ marginBottom: 0 }}>
          {(Object.keys(PROVIDER_STRENGTHS) as Provider[]).map((p) => {
            const s = PROVIDER_STRENGTHS[p];
            return (
              <div className="stat-card" key={p}>
                <div className="provider-head">
                  <span className="chart-chip" style={{ background: `var(--chart-${p})` }} />
                  {s.title}
                </div>
                <ul style={{ paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: "var(--text)" }}>
                  {s.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
                <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
                  → {s.fit}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 11 }}>
          モデル名の傾向: 上位モデル(Opus/Pro など)=品質重視・コスト高 /
          軽量モデル(Haiku/Flash/mini など)=高速・低コストで量をこなす作業向き。
          精度より量のタスクは軽量モデルにするとコストを抑えられます(§8.4)。
        </p>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? "カードを編集" : "新規カード"}</h2>
            <div className="form-grid">
              <label>名前</label>
              <input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="例: 執筆担当"
              />
              <label>プロバイダ</label>
              <div>
                <select
                  value={editing.provider}
                  onChange={(e) =>
                    setEditing({ ...editing, provider: e.target.value as Provider, model: "" })
                  }
                  style={{ width: "100%" }}
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="google">Google (Gemini)</option>
                </select>
                {editing.provider && (
                  <div className="muted" style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6 }}>
                    強み: {PROVIDER_STRENGTHS[editing.provider as Provider].points.join(" / ")}
                    <br />
                    {PROVIDER_STRENGTHS[editing.provider as Provider].fit}
                  </div>
                )}
              </div>
              <label>モデル</label>
              <div>
                <ModelPicker
                  openDown
                  models={
                    editing.model && !models.some((m) => m.id === editing.model)
                      ? [{ id: editing.model, label: editing.model + "(現在の設定)", provider: editing.provider as Provider }, ...models]
                      : models
                  }
                  value={editing.model ?? ""}
                  onChange={(id) => setEditing({ ...editing, model: id })}
                  placeholder="(モデルを選択)"
                />
                {modelError && (
                  <div className="muted" style={{ color: "var(--urgent)", marginTop: 4 }}>
                    {modelError}
                  </div>
                )}
                {editing.model && describeModel(editing.model) && (
                  <div
                    className="muted"
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.6,
                      borderLeft: "3px solid var(--accent)",
                      paddingLeft: 8,
                    }}
                  >
                    <b>{describeModel(editing.model)!.label}</b> — {describeModel(editing.model)!.description}
                  </div>
                )}
              </div>
              <label>システムプロンプト</label>
              <textarea
                value={editing.system_prompt ?? ""}
                onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                placeholder="この役割の振る舞いを指示してください"
              />
              <label>参照する共有資料</label>
              <div>
                {docs.length === 0 && (
                  <div className="muted" style={{ paddingTop: 8 }}>
                    共有バイブル画面で資料を作成すると、ここで選択できます
                  </div>
                )}
                {docs.map((d) => (
                  <div className="checkbox-row" key={d.id}>
                    <input
                      type="checkbox"
                      id={"ref-" + d.id}
                      checked={(editing.shared_memory_refs ?? []).includes(d.id)}
                      onChange={() => toggleRef(d.id)}
                    />
                    <label htmlFor={"ref-" + d.id} style={{ padding: 0 }}>
                      {d.title}
                    </label>
                  </div>
                ))}
              </div>
              <label>ツール許可</label>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="tool-webfetch"
                  checked={editing.tools?.web_fetch ?? false}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      tools: { web_fetch: e.target.checked, folder_scan: editing.tools?.folder_scan ?? false },
                    })
                  }
                />
                <label htmlFor="tool-webfetch" style={{ padding: 0 }}>
                  Web取得(メッセージ内のURLのページ内容を取得して分析)
                </label>
              </div>
              <label>自動起動トリガー</label>
              <div>
                {[
                  { id: "on_app_start", label: "朝ブリーフィング担当(起動時)" },
                  { id: "on_folder_scan", label: "締め切り検知担当(フォルダスキャン時)" },
                ].map((t) => (
                  <div className="checkbox-row" key={t.id}>
                    <input
                      type="checkbox"
                      id={"trig-" + t.id}
                      checked={(editing.triggers ?? []).includes(t.id)}
                      onChange={(e) => {
                        const cur = editing.triggers ?? [];
                        setEditing({
                          ...editing,
                          triggers: e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id),
                        });
                      }}
                    />
                    <label htmlFor={"trig-" + t.id} style={{ padding: 0 }}>
                      {t.label}
                    </label>
                  </div>
                ))}
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

      {wizardOpen && (
        <WizardModal onClose={() => setWizardOpen(false)} onCreated={onChanged} />
      )}
    </div>
  );
}
