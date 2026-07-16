const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

const EVENT_CHANNELS = [
  "chat:user-message",
  "chat:delta",
  "chat:done",
  "chat:error",
  "chat:status",
  "compare:delta",
  "compare:done",
  "pipeline:start",
  "pipeline:step-start",
  "pipeline:delta",
  "pipeline:step-done",
  "pipeline:clarification",
  "pipeline:done",
  "pipeline:error",
  "scan:progress",
  "scan:file-error",
  "scan:detected",
];

contextBridge.exposeInMainWorld("api", {
  // アプリ設定 / ワークスペース
  getConfig: invoke("app:getConfig"),
  setCurrentProject: invoke("app:setCurrentProject"),
  chooseWorkspace: invoke("app:chooseWorkspace"),
  chooseFolder: invoke("dialog:chooseFolder"),
  chooseFile: invoke("dialog:chooseFile"),

  // APIキー
  listKeys: invoke("keys:list"),
  setKey: invoke("keys:set"),
  deleteKey: invoke("keys:delete"),

  // モデル一覧
  listModels: invoke("models:list"),

  // 設定
  getSettings: invoke("settings:get"),
  updateSettings: invoke("settings:update"),

  // プロジェクト
  listProjects: invoke("projects:list"),
  saveProject: invoke("projects:save"),
  archiveProject: invoke("projects:archive"),

  // 役割カード
  listCards: invoke("cards:list"),
  saveCard: invoke("cards:save"),
  deleteCard: invoke("cards:delete"),

  // 共有バイブル
  listDocs: invoke("docs:list"),
  getDoc: invoke("docs:get"),
  saveDoc: invoke("docs:save"),
  deleteDoc: invoke("docs:delete"),

  // 会話
  listConversations: invoke("convs:list"),
  getConversation: invoke("convs:get"),
  createConversation: invoke("convs:create"),
  renameConversation: invoke("convs:rename"),
  deleteConversation: invoke("convs:delete"),
  setActiveLeaf: invoke("convs:setActiveLeaf"),

  // チャット
  sendChat: invoke("chat:send"),
  sendCompare: invoke("chat:compare"),
  abortChat: invoke("chat:abort"),

  // パイプライン
  listPipelines: invoke("pipelines:list"),
  savePipeline: invoke("pipelines:save"),
  deletePipeline: invoke("pipelines:delete"),
  runPipeline: invoke("pipelines:run"),
  answerPipeline: invoke("pipelines:answer"),
  abortPipeline: invoke("pipelines:abort"),
  pendingClarifications: invoke("pipelines:pending"),

  // 成果物保管庫
  listArtifacts: invoke("artifacts:list"),
  getArtifact: invoke("artifacts:get"),
  saveArtifact: invoke("artifacts:save"),
  deleteArtifact: invoke("artifacts:delete"),
  searchArtifacts: invoke("artifacts:search"),
  exportArtifact: invoke("artifacts:export"),

  // タスク / 締め切り検知
  listTasks: invoke("tasks:list"),
  saveTask: invoke("tasks:save"),
  deleteTask: invoke("tasks:delete"),
  listSuggestions: invoke("tasks:suggestions"),
  resolveSuggestion: invoke("tasks:resolveSuggestion"),
  scanNow: invoke("scan:now"),

  // 朝ブリーフィング
  getBriefing: invoke("briefing:get"),

  // 文書抽出
  extractFile: invoke("extract:file"),

  // 生成スタジオ
  listGenModels: invoke("gen:models"),
  generateImage: invoke("gen:image"),
  listMedia: invoke("gen:list"),
  deleteMedia: invoke("gen:delete"),
  saveMediaAs: invoke("gen:saveAs"),

  // 役割仕分けウィザード
  runWizard: invoke("wizard:run"),

  // イベント購読(チャット/比較/パイプライン/スキャン)
  onAppEvent: (callback) => {
    const handlers = EVENT_CHANNELS.map((ch) => {
      const h = (_e, payload) => callback(ch, payload);
      ipcRenderer.on(ch, h);
      return [ch, h];
    });
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h));
  },
  // 後方互換(チャットのみ)
  onChatEvent: (callback) => {
    const channels = ["chat:user-message", "chat:delta", "chat:done", "chat:error"];
    const handlers = channels.map((ch) => {
      const h = (_e, payload) => callback(ch, payload);
      ipcRenderer.on(ch, h);
      return [ch, h];
    });
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h));
  },

  // トークン記録
  getUsage: invoke("usage:get"),
  listUsageMonths: invoke("usage:months"),
});
