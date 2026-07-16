const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const { getAppConfig, setAppConfig } = require("./lib/config.cjs");
const keys = require("./lib/keys.cjs");
const ws = require("./lib/workspace.cjs");
const chat = require("./lib/chat.cjs");
const pipeline = require("./lib/pipeline.cjs");
const scanner = require("./lib/scanner.cjs");
const briefing = require("./lib/briefing.cjs");
const gen = require("./lib/gen.cjs");
const wizard = require("./lib/wizard.cjs");
const { extractText } = require("./lib/extract.cjs");

// ローカルファイル(背景画像・動画、生成メディア)をレンダラーに配信するためのスキーム
protocol.registerSchemesAsPrivileged([
  { scheme: "appfile", privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: "AI作業場",
    backgroundColor: "#F4F6F8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// 試験対策パイプライン(§4.7)を一度だけ投入
function seedExamPipeline() {
  const settings = ws.getSettings();
  if (settings.exam_pipeline_seeded) return;
  const cards = ws.listRoleCards();
  if (cards.length === 0) return; // カードができてから投入
  const secretary = cards.find((c) => c.name.includes("秘書")) || cards[0];
  ws.savePipeline({
    name: "試験対策(要点→予想問題→解説)",
    allow_clarification: false,
    steps: [
      {
        role_card_id: secretary.id,
        input_from: "user",
        instruction: "以下の授業資料の内容を、試験対策用に体系的に要点まとめしてください。重要語句は太字で示してください。",
      },
      {
        role_card_id: secretary.id,
        input_from: "previous",
        instruction: "上記の要点まとめをもとに、試験に出そうな予想問題を10問作成してください(選択式と記述式を混ぜること)。問題のみを出力してください。",
      },
      {
        role_card_id: secretary.id,
        input_from: "previous",
        instruction: "上記の予想問題のそれぞれについて、模範解答とわかりやすい解説を作成してください。",
      },
    ],
  });
  ws.updateSettings({ exam_pipeline_seeded: true });
}

function registerIpc() {
  // ---- アプリ設定 / ワークスペース選択 ----
  ipcMain.handle("app:getConfig", () => getAppConfig());
  ipcMain.handle("app:chooseWorkspace", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "ワークスペースフォルダを選択(Google Drive等の同期フォルダ内を推奨)",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    setAppConfig({ workspacePath: result.filePaths[0] });
    ws.initWorkspace();
    try {
      ws.seedExampleCards();
      seedExamPipeline();
    } catch {}
    return result.filePaths[0];
  });

  // ---- 汎用ダイアログ ----
  ipcMain.handle("dialog:chooseFolder", async (_e, title) => {
    const result = await dialog.showOpenDialog(win, {
      title: title || "フォルダを選択",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("dialog:chooseFile", async (_e, opts) => {
    const result = await dialog.showOpenDialog(win, {
      title: opts?.title || "ファイルを選択",
      properties: ["openFile"],
      filters: opts?.filters || [],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // ---- APIキー ----
  ipcMain.handle("keys:list", () => keys.listKeysMasked());
  ipcMain.handle("keys:set", (_e, provider, key) => {
    keys.setKey(provider, key);
    return keys.listKeysMasked();
  });
  ipcMain.handle("keys:delete", (_e, provider) => {
    keys.deleteKey(provider);
    return keys.listKeysMasked();
  });

  // ---- モデル一覧 ----
  ipcMain.handle("models:list", (_e, provider, force) => chat.listModels(provider, force));

  // ---- ワークスペース設定 ----
  ipcMain.handle("settings:get", () => ws.getSettings());
  ipcMain.handle("settings:update", (_e, patch) => ws.updateSettings(patch));

  // ---- 役割カード ----
  ipcMain.handle("cards:list", () => ws.listRoleCards());
  ipcMain.handle("cards:save", (_e, card) => ws.saveRoleCard(card));
  ipcMain.handle("cards:delete", (_e, id) => ws.deleteRoleCard(id));

  // ---- 共有バイブル ----
  ipcMain.handle("docs:list", () => ws.listSharedDocs());
  ipcMain.handle("docs:get", (_e, id) => ws.getSharedDoc(id));
  ipcMain.handle("docs:save", (_e, doc) => ws.saveSharedDoc(doc));
  ipcMain.handle("docs:delete", (_e, id) => ws.deleteSharedDoc(id));

  // ---- 会話 ----
  ipcMain.handle("convs:list", () => ws.listConversations());
  ipcMain.handle("convs:get", (_e, id) => ws.getConversation(id));
  ipcMain.handle("convs:create", (_e, title) => ws.createConversation(title));
  ipcMain.handle("convs:rename", (_e, id, title) => ws.renameConversation(id, title));
  ipcMain.handle("convs:delete", (_e, id) => ws.deleteConversation(id));
  ipcMain.handle("convs:setActiveLeaf", (_e, id, msgId) => ws.setActiveLeaf(id, msgId));

  // ---- チャット ----
  ipcMain.handle("chat:send", (_e, payload) => chat.sendChat(payload, emit));
  ipcMain.handle("chat:compare", (_e, payload) => chat.sendCompare(payload, emit));
  ipcMain.handle("chat:abort", (_e, requestId) => chat.abortChat(requestId));

  // ---- パイプライン ----
  ipcMain.handle("pipelines:list", () => ws.listPipelines());
  ipcMain.handle("pipelines:save", (_e, pl) => ws.savePipeline(pl));
  ipcMain.handle("pipelines:delete", (_e, id) => ws.deletePipeline(id));
  ipcMain.handle("pipelines:run", (_e, payload) => pipeline.runPipeline(payload, emit));
  ipcMain.handle("pipelines:answer", (_e, payload) => pipeline.answerPipeline(payload, emit));
  ipcMain.handle("pipelines:abort", (_e, runId) => pipeline.abortPipeline(runId));
  ipcMain.handle("pipelines:pending", () => pipeline.pendingClarifications());

  // ---- 成果物保管庫 ----
  ipcMain.handle("artifacts:list", () => ws.listArtifacts());
  ipcMain.handle("artifacts:get", (_e, id) => ws.getArtifact(id));
  ipcMain.handle("artifacts:save", (_e, art) => ws.saveArtifact(art));
  ipcMain.handle("artifacts:delete", (_e, id) => ws.deleteArtifact(id));
  ipcMain.handle("artifacts:search", (_e, q) => ws.searchArtifacts(q));
  ipcMain.handle("artifacts:export", async (_e, id) => {
    const abs = ws.artifactAbsPath(id);
    if (!abs) return false;
    const meta = ws.listArtifacts().find((a) => a.id === id);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: (meta?.title || "成果物").replace(/[\\/:*?"<>|]/g, "_") + ".md",
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "テキスト", extensions: ["txt"] },
      ],
    });
    if (result.canceled || !result.filePath) return false;
    require("fs").copyFileSync(abs, result.filePath);
    return true;
  });

  // ---- タスク / 締め切り検知 ----
  ipcMain.handle("tasks:list", () => ws.listTasks());
  ipcMain.handle("tasks:save", (_e, task) => ws.saveTask(task));
  ipcMain.handle("tasks:delete", (_e, id) => ws.deleteTask(id));
  ipcMain.handle("tasks:suggestions", () => ws.listSuggestions());
  ipcMain.handle("tasks:resolveSuggestion", (_e, id, accept) => ws.resolveSuggestion(id, accept));
  ipcMain.handle("scan:now", () => scanner.scanNow(emit, { manual: true }));

  // ---- 朝ブリーフィング ----
  ipcMain.handle("briefing:get", (_e, force) => briefing.getTodayBriefing({ force: !!force }));

  // ---- 文書テキスト抽出(試験対策パイプラインの入力用) ----
  ipcMain.handle("extract:file", async (_e, filePath) => {
    try {
      return { text: await extractText(filePath), error: null };
    } catch (err) {
      return { text: null, error: String(err?.message || err) };
    }
  });

  // ---- 生成スタジオ ----
  ipcMain.handle("gen:models", (_e, provider) => gen.listGenModels(provider));
  ipcMain.handle("gen:image", (_e, payload) => gen.generateImage(payload));
  ipcMain.handle("gen:list", () => gen.listMedia());
  ipcMain.handle("gen:delete", (_e, id) => gen.deleteMedia(id));
  ipcMain.handle("gen:saveAs", async (_e, absPath) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.basename(absPath),
      filters: [{ name: "画像", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return false;
    require("fs").copyFileSync(absPath, result.filePath);
    return true;
  });

  // ---- 役割仕分けウィザード ----
  ipcMain.handle("wizard:run", (_e, goal) => wizard.runWizard(goal));

  // ---- トークン記録 ----
  ipcMain.handle("usage:get", (_e, ym) => ws.getUsage(ym));
  ipcMain.handle("usage:months", () => ws.listUsageMonths());
}

app.whenReady().then(() => {
  // ローカルファイル配信(背景・生成メディア)
  protocol.handle("appfile", (req) => {
    const p = decodeURIComponent(req.url.slice("appfile://".length));
    return net.fetch(pathToFileURL(p).toString());
  });

  registerIpc();
  try {
    if (getAppConfig().workspacePath) {
      ws.seedExampleCards();
      seedExamPipeline();
    }
  } catch {}
  createWindow();
  scanner.startScheduler(emit);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
