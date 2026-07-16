import { useState } from "react";
import type { KeyInfo, Provider } from "../types";
import { PROVIDER_LABELS } from "../types";

const KEY_LINKS: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
};

export default function SetupWizard({
  workspacePath,
  keys,
  onChooseWorkspace,
  onSetKey,
  onFinish,
}: {
  workspacePath: string | null;
  keys: KeyInfo[];
  onChooseWorkspace: () => Promise<string | null>;
  onSetKey: (provider: Provider, key: string) => Promise<void>;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(workspacePath ? 1 : 0);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFolder = async () => {
    setError(null);
    try {
      const p = await onChooseWorkspace();
      if (p) {
        setStep(1); // フォルダが実際に選択できたときだけ進む
      } else {
        setError("フォルダが選択されませんでした。もう一度お試しください。");
      }
    } catch (e) {
      setError("フォルダの設定に失敗しました: " + String((e as Error)?.message ?? e));
    }
  };

  const finish = () => {
    if (!workspacePath) {
      setError("先にワークスペースフォルダを選択してください。");
      setStep(0);
      return;
    }
    onFinish();
  };

  const saveKeys = async () => {
    setError(null);
    setSaving(true);
    try {
      for (const p of Object.keys(inputs) as Provider[]) {
        const v = inputs[p]?.trim();
        if (v) await onSetKey(p, v);
      }
      setSaving(false);
      finish();
    } catch (e) {
      setSaving(false);
      setError("キーの保存に失敗しました: " + String((e as Error)?.message ?? e));
    }
  };

  return (
    <div className="wizard-backdrop">
      <div className="wizard">
        {step === 0 && (
          <>
            <h1>AI作業場へようこそ</h1>
            <p className="wizard-sub">
              まず、データの保存先(ワークスペース)を選択してください。
            </p>
            <div className="note">
              2台のPCでデータを共有する場合は、Google Drive等の
              <b>クラウド同期フォルダの中</b>にワークスペースフォルダを作成してください。
              役割カード・会話・共有バイブルなどがここに保存されます。
              <br />
              ※ APIキーはこのフォルダには保存されません(各PCのローカルに暗号化保存)。
            </div>
            {error && (
              <p style={{ color: "var(--urgent)", fontSize: 12, marginBottom: 10 }}>⚠ {error}</p>
            )}
            <button className="btn" onClick={chooseFolder}>
              フォルダを選択…
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <h1>APIキーの設定</h1>
            <p className="wizard-sub">
              使用するAIのAPIキーを入力してください(あとから設定画面でも変更できます)。
            </p>
            <div className="note" style={{ marginTop: 0 }}>
              保存先: <b>{workspacePath ?? "未選択"}</b>{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStep(0);
                }}
              >
                変更する
              </a>
            </div>
            {(["anthropic", "openai", "google"] as Provider[]).map((p) => {
              const info = keys.find((k) => k.provider === p);
              return (
                <div className="key-row" key={p}>
                  <span className="provider-name">{PROVIDER_LABELS[p]}</span>
                  <input
                    type="password"
                    placeholder={info?.configured ? `設定済み (${info.masked})` : "APIキーを貼り付け"}
                    value={inputs[p] ?? ""}
                    onChange={(e) => setInputs({ ...inputs, [p]: e.target.value })}
                  />
                  <a href={KEY_LINKS[p]} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                    発行場所
                  </a>
                </div>
              );
            })}
            <div className="note">
              <b>重要:</b> APIキーはOSの暗号化機能で<b>このPCのローカルにのみ</b>保存され、
              同期フォルダには含まれません。<b>2台目のPCでも初回にキーの入力が必要</b>です。
            </div>
            {error && (
              <p style={{ color: "var(--urgent)", fontSize: 12, marginBottom: 10 }}>⚠ {error}</p>
            )}
            <div className="modal-actions">
              <button className="btn secondary" onClick={finish} disabled={saving}>
                スキップ
              </button>
              <button className="btn" onClick={saveKeys} disabled={saving}>
                {saving ? "保存中…" : "保存して開始"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
