import { useEffect, useState } from "react";
import type { MediaItem, ModelInfo, Provider } from "../types";
import { PROVIDER_LABELS, appfileUrl } from "../types";

// §4.14 生成スタジオは画像生成が先行実装。動画生成APIを持つプロバイダのみ将来対応。
const GEN_PROVIDERS: Provider[] = ["openai", "google"];

type PendingGen = { provider: Provider; model: string; prompt: string };

export default function StudioView({
  onSettingsChanged,
}: {
  onSettingsChanged?: () => void;
}) {
  const [genType, setGenType] = useState<"image" | "video">("image");
  const [provider, setProvider] = useState<Provider>("openai");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");

  const [pendingGen, setPendingGen] = useState<PendingGen | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [media, setMedia] = useState<MediaItem[]>([]);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [bgMessage, setBgMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const loadMedia = async () => {
    const list = await window.api.listMedia();
    setMedia([...list].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  };

  useEffect(() => {
    loadMedia();
  }, []);

  // プロバイダ切替時にモデル一覧を再取得
  useEffect(() => {
    setModels([]);
    setModelError(null);
    setModel("");
    let cancelled = false;
    window.api.listGenModels(provider).then((r) => {
      if (cancelled) return;
      setModels(r.models);
      if (r.error === "no_key") {
        setModelError(
          `${PROVIDER_LABELS[provider]}のAPIキーが未設定のためモデル一覧を取得できません(設定画面で登録してください)`
        );
      } else if (r.error) {
        setModelError("モデル一覧の取得に失敗しました: " + r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const requestGenerate = () => {
    if (genType === "video") return;
    if (!model) {
      alert("モデルを選択してください");
      return;
    }
    if (!prompt.trim()) {
      alert("プロンプトを入力してください");
      return;
    }
    setGenError(null);
    setPendingGen({ provider, model, prompt: prompt.trim() });
  };

  const confirmGenerate = async () => {
    if (!pendingGen) return;
    const target = pendingGen;
    setPendingGen(null);
    setGenerating(true);
    setGenError(null);
    try {
      await window.api.generateImage(target);
      await loadMedia();
    } catch (e: any) {
      setGenError(String(e?.message ?? e));
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = (item: MediaItem) => {
    setGenError(null);
    setPendingGen({ provider: item.provider, model: item.model, prompt: item.prompt });
  };

  const saveAs = async (item: MediaItem) => {
    await window.api.saveMediaAs(item.abs_path);
  };

  const setAsBackground = async (item: MediaItem) => {
    const s = await window.api.getSettings();
    await window.api.updateSettings({
      theme: {
        ...s.theme,
        background: { ...s.theme.background, type: "image", path: item.abs_path },
      },
    });
    onSettingsChanged?.();
    setBgMessage("背景に設定しました");
    setTimeout(() => setBgMessage(null), 3000);
  };

  const copyPrompt = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopyMessage("プロンプトをコピーしました");
      setTimeout(() => setCopyMessage(null), 3000);
    } catch {
      setCopyMessage("コピーに失敗しました");
      setTimeout(() => setCopyMessage(null), 3000);
    }
  };

  const removeMedia = async (item: MediaItem) => {
    if (!confirm("この画像を削除しますか?")) return;
    await window.api.deleteMedia(item.id);
    setMedia((prev) => prev.filter((m) => m.id !== item.id));
    if (lightboxItem?.id === item.id) setLightboxItem(null);
  };

  return (
    <div>
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">画像を生成</span>
        </div>
        <div className="form-grid">
          <label>種別</label>
          <div>
            <select value={genType} onChange={(e) => setGenType(e.target.value as "image" | "video")}>
              <option value="image">画像</option>
              <option value="video">動画</option>
            </select>
            {genType === "video" && (
              <div className="muted" style={{ marginTop: 6 }}>
                動画生成は今後対応予定です(高コスト・長時間のため画像を先行実装)
              </div>
            )}
          </div>

          <label>プロバイダ</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            disabled={genType === "video"}
          >
            {GEN_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>

          <label>モデル</label>
          <div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={genType === "video"}
              style={{ width: "100%" }}
            >
              <option value="">(選択してください)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {modelError && (
              <div className="muted" style={{ color: "var(--urgent)", marginTop: 4 }}>
                {modelError}
              </div>
            )}
          </div>

          <label>プロンプト</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="生成したい画像の内容を入力してください"
            disabled={genType === "video"}
          />
        </div>
        <div className="modal-actions" style={{ marginTop: 14, justifyContent: "flex-start" }}>
          <button className="btn" onClick={requestGenerate} disabled={genType === "video" || generating}>
            生成
          </button>
          {generating && <span className="muted">生成中…(数十秒かかることがあります)</span>}
        </div>
        {genError && (
          <div className="muted" style={{ color: "var(--urgent)", marginTop: 8 }}>
            {genError}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">ギャラリー</span>
          {bgMessage && <span className="panel-title-meta muted">{bgMessage}</span>}
        </div>
        {media.length === 0 ? (
          <div className="empty-state">まだ生成した画像がありません</div>
        ) : (
          <div className="gallery-grid">
            {media.map((item) => (
              <div className="gallery-item" key={item.id} onClick={() => setLightboxItem(item)}>
                <img src={appfileUrl(item.abs_path)} alt={item.prompt} />
                <div className="gallery-caption">{item.model}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 生成前確認モーダル */}
      {pendingGen && (
        <div className="modal-backdrop" onClick={() => setPendingGen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 92vw)" }}>
            <h2>画像を生成しますか?</h2>
            <p>
              画像1枚を生成します。モデルにより数円〜数十円程度のAPI料金が発生します。実行しますか?
            </p>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setPendingGen(null)}>
                キャンセル
              </button>
              <button className="btn" onClick={confirmGenerate}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拡大モーダル(ライトボックス) */}
      {lightboxItem && (
        <div className="modal-backdrop" onClick={() => setLightboxItem(null)}>
          <div className="modal lightbox" onClick={(e) => e.stopPropagation()} style={{ width: "min(680px, 94vw)" }}>
            <h2>
              <span className="badge" style={{ marginRight: 8 }}>
                {PROVIDER_LABELS[lightboxItem.provider]} · {lightboxItem.model}
              </span>
            </h2>
            <img src={appfileUrl(lightboxItem.abs_path)} alt={lightboxItem.prompt} />
            <p className="muted" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
              {lightboxItem.prompt}
            </p>
            {copyMessage && <div className="muted">{copyMessage}</div>}
            <div className="modal-actions" style={{ flexWrap: "wrap" }}>
              <button className="btn secondary" onClick={() => saveAs(lightboxItem)}>
                💾 保存
              </button>
              <button className="btn secondary" onClick={() => setAsBackground(lightboxItem)}>
                🖼 背景に設定
              </button>
              <button className="btn secondary" onClick={() => regenerate(lightboxItem)}>
                🔁 再生成
              </button>
              <button className="btn secondary" onClick={() => copyPrompt(lightboxItem)}>
                📋 プロンプトをコピー
              </button>
              <button className="btn danger" onClick={() => removeMedia(lightboxItem)}>
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
