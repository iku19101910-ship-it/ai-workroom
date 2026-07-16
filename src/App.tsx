import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import Sidebar, { ViewId } from "./components/Sidebar";
import Header from "./components/Header";
import HomeView from "./views/HomeView";
import type { KeyInfo, RoleCard, Settings } from "./types";
import { appfileUrl } from "./types";

// 初期画面で不要な機能は、選択されたときだけ読み込む。
const SetupWizard = lazy(() => import("./components/SetupWizard"));
const ChatView = lazy(() => import("./views/ChatView"));
const CardsHubView = lazy(() => import("./views/CardsHubView"));
const ArtifactsView = lazy(() => import("./views/ArtifactsView"));
const PipelinesView = lazy(() => import("./views/PipelinesView"));
const TasksView = lazy(() => import("./views/TasksView"));
const StudioView = lazy(() => import("./views/StudioView"));
const SettingsView = lazy(() => import("./views/SettingsView"));
const CostView = lazy(() => import("./views/CostView"));

const VIEW_TITLES: Record<ViewId, string> = {
  home: "ホーム",
  chat: "チャット",
  cards: "役割カード・共有バイブル",
  artifacts: "保管庫",
  pipelines: "パイプライン",
  tasks: "タスク",
  studio: "生成スタジオ",
  cost: "コスト",
  settings: "設定",
};

function ViewLoading() {
  return <div className="muted" style={{ padding: 24 }}>読み込み中…</div>;
}

// 背景(§4.12 3層レイヤー: 背景 → 調光幕 → UIパネル)
function BackgroundLayers({ settings }: { settings: Settings }) {
  const bg = settings.theme.background;
  const videoRef = useRef<HTMLVideoElement>(null);

  // バッテリー駆動時・非アクティブ時の動画一時停止
  useEffect(() => {
    const video = videoRef.current;
    if (!video || bg.type !== "video" || !bg.pause_video_on_battery) return;

    let onBattery = false;
    let battery: any = null;
    const update = () => {
      if (onBattery || document.hidden || !document.hasFocus()) video.pause();
      else video.play().catch(() => {});
    };
    const onVis = () => update();
    (navigator as any).getBattery?.().then((b: any) => {
      battery = b;
      onBattery = !b.charging;
      b.addEventListener("chargingchange", () => {
        onBattery = !b.charging;
        update();
      });
      update();
    });
    window.addEventListener("blur", onVis);
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onVis);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [bg.type, bg.path, bg.pause_video_on_battery]);

  if ((bg.type !== "image" && bg.type !== "video" && bg.type !== "generated") || !bg.path) return null;

  const dimColor =
    bg.dim_color === "white"
      ? "#ffffff"
      : bg.dim_color === "black"
      ? "#000000"
      : settings.theme.mode === "light"
      ? "#ffffff"
      : "#000000";

  return (
    <>
      <div className="bg-layer">
        {bg.type === "video" ? (
          <video ref={videoRef} src={appfileUrl(bg.path)} autoPlay loop muted playsInline />
        ) : (
          <img src={appfileUrl(bg.path)} alt="" />
        )}
      </div>
      <div className="dim-layer" style={{ background: dimColor, opacity: bg.dim }} />
    </>
  );
}

export default function App() {
  const [view, setView] = useState<ViewId>("home");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [cards, setCards] = useState<RoleCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardDone, setWizardDone] = useState(false);

  // 設定をUIへ反映(テーマ属性・背景クラス・パネル不透明度)
  const applySettings = useCallback((s: Settings) => {
    setSettings(s);
    document.body.dataset.theme = s.theme.mode;
    const bg = s.theme.background;
    const hasBg = (bg.type === "image" || bg.type === "video" || bg.type === "generated") && !!bg.path;
    document.body.classList.toggle("has-bg", hasBg);
    document.body.classList.toggle("bg-blur", hasBg && bg.panel_blur);
    document.body.style.setProperty("--panel-opacity", String(bg.panel_opacity ?? 0.85));
  }, []);

  const refreshKeys = useCallback(async () => {
    setKeys(await window.api.listKeys());
  }, []);

  const refreshCards = useCallback(async () => {
    try {
      setCards(await window.api.listCards());
    } catch {
      setCards([]);
    }
  }, []);

  const reloadSettings = useCallback(async () => {
    applySettings(await window.api.getSettings());
  }, [applySettings]);

  const loadWorkspaceData = useCallback(async () => {
    await Promise.all([reloadSettings(), refreshCards()]);
  }, [reloadSettings, refreshCards]);

  useEffect(() => {
    (async () => {
      const cfg = await window.api.getConfig();
      setWorkspacePath(cfg.workspacePath);
      try {
        await Promise.all([
          refreshKeys(),
          cfg.workspacePath ? loadWorkspaceData() : Promise.resolve(),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWorkspaceData, refreshKeys]);

  const toggleTheme = async () => {
    if (!settings) return;
    const mode = settings.theme.mode === "light" ? "dark" : "light";
    const next = await window.api.updateSettings({
      theme: { ...settings.theme, mode },
    });
    applySettings(next);
  };

  if (loading) return null;

  // 初回起動時セットアップウィザード(§4.15)
  const needsWizard = !workspacePath || (!wizardDone && !keys.some((k) => k.configured) && cards.length === 0);
  if (needsWizard) {
    return (
      <Suspense fallback={<ViewLoading />}>
        <SetupWizard
          workspacePath={workspacePath}
          keys={keys}
          onChooseWorkspace={async () => {
            const p = await window.api.chooseWorkspace();
            if (p) {
              setWorkspacePath(p);
              await loadWorkspaceData();
            }
            return p;
          }}
          onSetKey={async (provider, key) => {
            setKeys(await window.api.setKey(provider, key));
          }}
          onFinish={() => setWizardDone(true)}
        />
      </Suspense>
    );
  }

  return (
    <div className="layout">
      {settings && <BackgroundLayers settings={settings} />}
      <Sidebar view={view} onSelect={setView} />
      <div className="main-area">
        <Header
          title={VIEW_TITLES[view]}
          themeMode={settings?.theme.mode ?? "light"}
          onToggleTheme={toggleTheme}
        />
        <Suspense fallback={<ViewLoading />}>
          {view === "chat" ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatView cards={cards} />
            </div>
          ) : (
            <div className="content">
              {view === "home" && <HomeView cards={cards} onNavigate={setView} />}
              {view === "cards" && <CardsHubView cards={cards} onChanged={refreshCards} />}
              {view === "artifacts" && <ArtifactsView cards={cards} />}
              {view === "pipelines" && <PipelinesView cards={cards} />}
              {view === "tasks" && <TasksView />}
              {view === "studio" && <StudioView onSettingsChanged={reloadSettings} />}
              {view === "cost" && <CostView cards={cards} />}
              {view === "settings" && (
                <SettingsView
                  keys={keys}
                  settings={settings}
                  workspacePath={workspacePath}
                  onKeysChanged={setKeys}
                  onSettingsChanged={applySettings}
                />
              )}
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}
