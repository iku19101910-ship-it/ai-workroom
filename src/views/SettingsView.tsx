import { useEffect, useState } from "react";
import type { BackgroundSettings, KeyInfo, Provider, Settings } from "../types";
import { PROVIDER_LABELS } from "../types";

const KEY_LINKS: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
};

export default function SettingsView({
  keys,
  settings,
  workspacePath,
  onKeysChanged,
  onSettingsChanged,
}: {
  keys: KeyInfo[];
  settings: Settings | null;
  workspacePath: string | null;
  onKeysChanged: (keys: KeyInfo[]) => void;
  onSettingsChanged: (s: Settings) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [newModelId, setNewModelId] = useState("");
  const [usageModels, setUsageModels] = useState<string[]>([]);

  useEffect(() => {
    const ym = new Date().toISOString().slice(0, 7);
    window.api.getUsage(ym).then((u) => {
      const set = new Set(u.records.map((r) => r.model));
      setUsageModels([...set]);
    });
  }, []);

  const saveKey = async (p: Provider) => {
    const v = inputs[p]?.trim();
    if (!v) return;
    onKeysChanged(await window.api.setKey(p, v));
    setInputs({ ...inputs, [p]: "" });
  };

  const removeKey = async (p: Provider) => {
    if (!confirm(`${PROVIDER_LABELS[p]} のAPIキーを削除しますか?`)) return;
    onKeysChanged(await window.api.deleteKey(p));
  };

  const updateChat = async (patch: Partial<Settings["chat"]>) => {
    if (!settings) return;
    onSettingsChanged(
      await window.api.updateSettings({ chat: { ...settings.chat, ...patch } })
    );
  };

  const updateHandoff = async (patch: Partial<Settings["handoff"]>) => {
    if (!settings) return;
    onSettingsChanged(await window.api.updateSettings({ handoff: { ...settings.handoff, ...patch } }));
  };

  // ---------- 締め切り検知(フォルダスキャン) §4.6 ----------
  const updateScan = async (patch: Partial<Settings["scan"]>) => {
    if (!settings) return;
    onSettingsChanged(
      await window.api.updateSettings({ scan: { ...settings.scan, ...patch } })
    );
  };

  const addScanFolder = async () => {
    if (!settings) return;
    const path = await window.api.chooseFolder("スキャン対象フォルダを選択");
    if (!path) return;
    if (settings.scan.folders.includes(path)) return;
    await updateScan({ folders: [...settings.scan.folders, path] });
  };

  const removeScanFolder = async (idx: number) => {
    if (!settings) return;
    const next = settings.scan.folders.filter((_, i) => i !== idx);
    await updateScan({ folders: next });
  };

  // ---------- テーマ・背景 §4.12 ----------
  const updateBackground = async (patch: Partial<BackgroundSettings>) => {
    if (!settings) return;
    const next = await window.api.updateSettings({
      theme: { ...settings.theme, background: { ...settings.theme.background, ...patch } },
    });
    onSettingsChanged(next);
  };

  const chooseBgFile = async () => {
    if (!settings) return;
    const type = settings.theme.background.type;
    const filters =
      type === "video"
        ? [{ name: "動画ファイル", extensions: ["mp4", "webm"] }]
        : [{ name: "画像ファイル", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }];
    const path = await window.api.chooseFile({ title: "背景ファイルを選択", filters });
    if (path) await updateBackground({ path });
  };

  // ---------- モデル単価(概算コスト用) §4.11 ----------
  const updatePrices = async (next: Settings["usage_prices"]) => {
    onSettingsChanged(await window.api.updateSettings({ usage_prices: next }));
  };

  const setPriceField = (modelId: string, field: "input" | "output", value: string) => {
    if (!settings) return;
    const v = value === "" ? undefined : Number(value);
    const cur = settings.usage_prices[modelId] ?? {};
    updatePrices({ ...settings.usage_prices, [modelId]: { ...cur, [field]: v } });
  };

  const removePriceRow = (modelId: string) => {
    if (!settings) return;
    const next = { ...settings.usage_prices };
    delete next[modelId];
    updatePrices(next);
  };

  const addPriceRow = (modelId: string) => {
    if (!settings || settings.usage_prices[modelId]) return;
    updatePrices({ ...settings.usage_prices, [modelId]: {} });
  };

  const candidateModels = usageModels.filter((m) => !(settings?.usage_prices ?? {})[m]);

  const bg = settings?.theme.background;

  return (
    <div>
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">APIキー管理</span>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          キーはOSの暗号化機能でこのPCのローカルにのみ保存されます(同期対象外)。
          2台目のPCでは別途入力が必要です。
        </p>
        {(["anthropic", "openai", "google"] as Provider[]).map((p) => {
          const info = keys.find((k) => k.provider === p);
          return (
            <div className="list-row" key={p}>
              <span style={{ width: 90 }}>{PROVIDER_LABELS[p]}</span>
              <span className="badge">
                {info?.configured ? info.masked : "未設定"}
              </span>
              <span className="row-actions" style={{ flex: 1, justifyContent: "flex-end" }}>
                <input
                  type="password"
                  placeholder="新しいキーを入力"
                  value={inputs[p] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [p]: e.target.value })}
                  style={{ width: 260 }}
                />
                <button className="btn small" onClick={() => saveKey(p)} disabled={!inputs[p]?.trim()}>
                  保存
                </button>
                {info?.configured && (
                  <button className="btn small danger" onClick={() => removeKey(p)}>
                    削除
                  </button>
                )}
                <a href={KEY_LINKS[p]} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
                  発行場所
                </a>
              </span>
            </div>
          );
        })}
        {keys.length > 0 && !keys[0].encrypted && (
          <p className="muted" style={{ color: "var(--urgent)", marginTop: 8 }}>
            ⚠ この環境ではOSの暗号化が利用できないため、キーは平文でローカル保存されています。
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row"><span className="panel-title">引き継ぎメモ</span></div>
        <div className="form-grid" style={{ maxWidth: 560 }}>
          <label>自動生成</label>
          <div className="checkbox-row" style={{ paddingTop: 0 }}>
            <input id="handoff_auto" type="checkbox" checked={settings?.handoff.auto ?? true} onChange={(e) => updateHandoff({ auto: e.target.checked })} />
            <label htmlFor="handoff_auto" style={{ padding: 0 }}>会話を切り替えるときに自動で引き継ぎを整理する</label>
          </div>
          <label>生成しきい値</label>
          <div>
            <input type="number" min={2} max={50} value={settings?.handoff.min_new_messages ?? 6} onChange={(e) => updateHandoff({ min_new_messages: Math.max(2, Number(e.target.value) || 6) })} style={{ width: 100 }} />
            <div className="muted" style={{ marginTop: 4 }}>前回の引き継ぎ以降、この件数以上の本線メッセージが増えたとき生成します。</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">チャット設定(トークン節約 §8)</span>
        </div>
        <div className="form-grid" style={{ maxWidth: 520 }}>
          <label>履歴の送信往復数</label>
          <div>
            <input
              type="number"
              min={1}
              max={50}
              value={settings?.chat.history_pairs ?? 10}
              onChange={(e) => updateChat({ history_pairs: Number(e.target.value) || 10 })}
              style={{ width: 100 }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              直近N往復を原文のまま送信し、それより古い部分は軽量モデルで自動要約して送信します(§8.2)。
            </div>
          </div>
          <label>max_tokens上限</label>
          <div>
            <input
              type="number"
              min={256}
              max={128000}
              step={256}
              value={settings?.chat.max_tokens ?? 4096}
              onChange={(e) => updateChat({ max_tokens: Number(e.target.value) || 4096 })}
              style={{ width: 120 }}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              1回の応答の出力トークン上限(全API呼び出しに適用 §8.5)。
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">締め切り検知(フォルダスキャン)</span>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          指定したフォルダ内のファイルを定期的にスキャンし、締め切りらしき記述を検知します(§4.6)。
        </p>
        {(settings?.scan.folders ?? []).map((f, i) => (
          <div className="list-row" key={f + i}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {f}
            </span>
            <span className="row-actions">
              <button className="btn small danger" onClick={() => removeScanFolder(i)}>
                削除
              </button>
            </span>
          </div>
        ))}
        {(settings?.scan.folders.length ?? 0) === 0 && (
          <div className="muted" style={{ padding: "4px 0" }}>
            対象フォルダが未設定です。
          </div>
        )}
        <div className="list-row">
          <button className="btn small" onClick={addScanFolder}>
            フォルダを追加
          </button>
        </div>
        <div className="form-grid" style={{ maxWidth: 520, marginTop: 8 }}>
          <label>スキャン間隔(分)</label>
          <input
            type="number"
            min={1}
            max={1440}
            value={settings?.scan.interval_minutes ?? 30}
            onChange={(e) => updateScan({ interval_minutes: Number(e.target.value) || 30 })}
            style={{ width: 100 }}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">テーマ・背景</span>
        </div>
        <div className="form-grid" style={{ maxWidth: 560 }}>
          <label>背景の種類</label>
          <div>
            <select
              value={bg?.type ?? "none"}
              onChange={(e) =>
                updateBackground({ type: e.target.value as BackgroundSettings["type"] })
              }
              style={{ width: 160 }}
            >
              <option value="none">なし</option>
              <option value="image">静止画</option>
              <option value="video">動画</option>
            </select>
          </div>

          {(bg?.type === "image" || bg?.type === "video") && (
            <>
              <label>ファイル</label>
              <div className="list-row" style={{ padding: 0, border: "none" }}>
                <button className="btn small" onClick={chooseBgFile}>
                  ファイルを選択
                </button>
                <span
                  className="muted"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {bg?.path || "未選択"}
                </span>
              </div>
            </>
          )}

          <label>調光(暗さ)</label>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={bg?.dim ?? 0}
              onChange={(e) => updateBackground({ dim: Number(e.target.value) })}
            />
            <span className="slider-val">{Math.round((bg?.dim ?? 0) * 100)}%</span>
          </div>

          <label>幕の色</label>
          <div>
            <select
              value={bg?.dim_color ?? "auto"}
              onChange={(e) =>
                updateBackground({ dim_color: e.target.value as BackgroundSettings["dim_color"] })
              }
              style={{ width: 220 }}
            >
              <option value="auto">自動(モードに応じ白/黒)</option>
              <option value="white">白幕</option>
              <option value="black">黒幕</option>
            </select>
          </div>

          <label>パネル不透明度</label>
          <div className="slider-row">
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={bg?.panel_opacity ?? 0.85}
              onChange={(e) => updateBackground({ panel_opacity: Number(e.target.value) })}
            />
            <span className="slider-val">{Math.round((bg?.panel_opacity ?? 0.85) * 100)}%</span>
          </div>

          <label></label>
          <div className="checkbox-row" style={{ paddingTop: 0 }}>
            <input
              type="checkbox"
              id="panel_blur"
              checked={bg?.panel_blur ?? false}
              onChange={(e) => updateBackground({ panel_blur: e.target.checked })}
            />
            <label htmlFor="panel_blur" style={{ padding: 0 }}>
              パネルをぼかす(すりガラス)
            </label>
          </div>

          <label></label>
          <div className="checkbox-row" style={{ paddingTop: 0 }}>
            <input
              type="checkbox"
              id="pause_video_on_battery"
              checked={bg?.pause_video_on_battery ?? false}
              onChange={(e) => updateBackground({ pause_video_on_battery: e.target.checked })}
            />
            <label htmlFor="pause_video_on_battery" style={{ padding: 0 }}>
              バッテリー駆動時・非アクティブ時は動画を一時停止
            </label>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">モデル単価(概算コスト用)</span>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          単価はハードコードされません。各社の料金ページを見て USD/100万トークン で入力してください(価格改定時はここを更新)。
        </p>
        <table className="usage-table">
          <thead>
            <tr>
              <th>モデルID</th>
              <th className="num">入力単価($/1M)</th>
              <th className="num">出力単価($/1M)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(settings?.usage_prices ?? {}).map(([modelId, p]) => (
              <tr key={modelId}>
                <td>{modelId}</td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={p.input ?? ""}
                    onChange={(e) => setPriceField(modelId, "input", e.target.value)}
                    style={{ width: 90, textAlign: "right" }}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={p.output ?? ""}
                    onChange={(e) => setPriceField(modelId, "output", e.target.value)}
                    style={{ width: 90, textAlign: "right" }}
                  />
                </td>
                <td className="num">
                  <button className="btn small danger" onClick={() => removePriceRow(modelId)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {Object.keys(settings?.usage_prices ?? {}).length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  単価が未登録です
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="list-row">
          <input
            placeholder="モデルID(例: claude-opus-4-6-20260115)"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn small"
            disabled={!newModelId.trim()}
            onClick={() => {
              const id = newModelId.trim();
              if (!id) return;
              addPriceRow(id);
              setNewModelId("");
            }}
          >
            行を追加
          </button>
        </div>
        {candidateModels.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              追加候補(今月使用したが単価未登録):
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {candidateModels.map((m) => (
                <button key={m} className="btn small secondary" onClick={() => addPriceRow(m)}>
                  + {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">ワークスペース</span>
        </div>
        <div className="list-row">
          <span className="muted">保存先</span>
          <span style={{ fontSize: 12 }}>{workspacePath}</span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          役割カード・会話・共有バイブル・トークン記録がこのフォルダに保存されます。
          クラウド同期フォルダ内に置くことで2台のPCで共有できます。
        </p>
      </div>
    </div>
  );
}
