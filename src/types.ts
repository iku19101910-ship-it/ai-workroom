export type Provider = "anthropic" | "openai" | "google";

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "GPT",
  google: "Gemini",
};

export interface RoleCard {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  shared_memory_refs: string[];
  color: string | null;
  tools: { web_fetch: boolean; folder_scan: boolean };
  triggers: string[];
  created_at: string;
  updated_at: string;
}

// §4.16 確認質問プロトコル
export interface Clarification {
  type: "clarification";
  questions: {
    text: string;
    options: string[];
    allow_free_text: boolean;
  }[];
}

export interface Message {
  id: string;
  parent_id: string | null;
  author: "user" | "assistant";
  role_card_id: string | null;
  model_override: string | null;
  model: string | null;
  content: string;
  tokens: { input: number; output: number } | null;
  error: string | null;
  clarification?: Clarification | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  active_leaf_id: string | null;
  messages: Message[];
  summary_cache?: { boundary_msg_id: string; text: string; model: string; created_at: string } | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SharedDocMeta {
  id: string;
  title: string;
  created_at?: string;
  updated_at: string;
}

export interface SharedDoc extends SharedDocMeta {
  content: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
}

export interface KeyInfo {
  provider: Provider;
  configured: boolean;
  masked: string | null;
  encrypted: boolean;
}

export interface BackgroundSettings {
  type: "none" | "image" | "video" | "generated";
  path: string;
  dim: number; // 0〜0.8
  dim_color: "auto" | "white" | "black";
  panel_opacity: number; // 0.5〜1
  panel_blur: boolean;
  pause_video_on_battery: boolean;
}

export interface Settings {
  theme: {
    mode: "light" | "dark";
    background: BackgroundSettings;
  };
  scan: { folders: string[]; interval_minutes: number };
  usage_prices: Record<string, { input?: number; output?: number }>; // USD / 100万トークン
  chat: { history_pairs: number; max_tokens: number };
  examples_seeded?: boolean;
  exam_pipeline_seeded?: boolean;
}

export interface UsageRecord {
  date: string;
  role_card_id: string;
  provider?: string | null;
  model: string;
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  count: number;
}

// §4.4 パイプライン
export interface PipelineStep {
  role_card_id: string;
  input_from: "user" | "previous";
  instruction: string;
}

export interface Pipeline {
  id: string;
  name: string;
  allow_clarification: boolean;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
}

// 成果物保管庫(AIが作った完成品のアーカイブ。AIには読み込ませない)
export interface ArtifactMeta {
  id: string;
  title: string;
  tags: string[];
  provider: string | null;
  model: string | null;
  role_card_id: string | null;
  card_name: string | null;
  conversation_id: string | null;
  message_id: string | null;
  // 保存元の文脈(保存時にスナップショット。会話削除後も残る)
  context?: { conversation_title: string; prompt_excerpt: string } | null;
  file: string;
  created_at: string;
  updated_at: string;
}

export interface Artifact extends ArtifactMeta {
  content: string;
}

// §4.6 タスク
export interface Task {
  id: string;
  title: string;
  due_date: string | null;
  status: "open" | "done" | "ignored";
  source: {
    type: "detected";
    file: string;
    excerpt: string;
    confidence: number;
    confirmed_by_user: boolean;
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface TaskSuggestion {
  id: string;
  title: string;
  due_date: string;
  confidence: number;
  file: string;
  excerpt: string;
  created_at: string;
}

// §4.14 生成スタジオ
export interface MediaItem {
  id: string;
  type: "image" | "video";
  provider: Provider;
  model: string;
  prompt: string;
  file: string;
  created_at: string;
  abs_path: string;
}

// §4.10 役割仕分けウィザード
export interface WizardRole {
  name: string;
  provider: Provider;
  model: string;
  reason: string;
  system_prompt: string;
}

export interface WizardProposal {
  provider: Provider;
  model: string | null;
  roles: WizardRole[];
  raw: string | null;
  error: string | null;
}

export interface Briefing {
  date: string;
  text: string | null;
  reason: string | null;
  cardName?: string | null;
}

export type AppEvent =
  | "chat:user-message"
  | "chat:delta"
  | "chat:done"
  | "chat:error"
  | "chat:status"
  | "compare:delta"
  | "compare:done"
  | "pipeline:start"
  | "pipeline:step-start"
  | "pipeline:delta"
  | "pipeline:step-done"
  | "pipeline:clarification"
  | "pipeline:done"
  | "pipeline:error"
  | "scan:progress"
  | "scan:file-error"
  | "scan:detected";

export type ChatEvent = "chat:user-message" | "chat:delta" | "chat:done" | "chat:error";

// ローカルファイルをレンダラーで表示するためのURL(main側で appfile: プロトコルを登録済み)
export function appfileUrl(absPath: string): string {
  return "appfile://" + encodeURIComponent(absPath.replace(/\\/g, "/"));
}

declare global {
  interface Window {
    api: {
      getConfig: () => Promise<{ workspacePath: string | null }>;
      chooseWorkspace: () => Promise<string | null>;
      chooseFolder: (title?: string) => Promise<string | null>;
      chooseFile: (opts?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      listKeys: () => Promise<KeyInfo[]>;
      setKey: (provider: Provider, key: string) => Promise<KeyInfo[]>;
      deleteKey: (provider: Provider) => Promise<KeyInfo[]>;
      listModels: (provider: Provider, force?: boolean) => Promise<{ models: ModelInfo[]; error: string | null }>;
      getSettings: () => Promise<Settings>;
      updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
      listCards: () => Promise<RoleCard[]>;
      saveCard: (card: Partial<RoleCard>) => Promise<RoleCard>;
      deleteCard: (id: string) => Promise<boolean>;
      listDocs: () => Promise<SharedDocMeta[]>;
      getDoc: (id: string) => Promise<SharedDoc | null>;
      saveDoc: (doc: Partial<SharedDoc>) => Promise<SharedDoc>;
      deleteDoc: (id: string) => Promise<boolean>;
      listConversations: () => Promise<ConversationMeta[]>;
      getConversation: (id: string) => Promise<Conversation | null>;
      createConversation: (title?: string) => Promise<Conversation>;
      renameConversation: (id: string, title: string) => Promise<Conversation>;
      deleteConversation: (id: string) => Promise<boolean>;
      setActiveLeaf: (id: string, msgId: string) => Promise<Conversation>;
      sendChat: (payload: {
        conversationId: string;
        cardId: string;
        modelOverride: string | null;
        text: string;
        requestId: string;
        parentId?: string | null; // 指定時: そのメッセージを親として分岐送信(§4.5)
      }) => Promise<unknown>;
      sendCompare: (payload: {
        conversationId: string;
        cardIds: string[];
        text: string;
        requestId: string;
      }) => Promise<unknown>;
      abortChat: (requestId: string) => Promise<boolean>;
      listPipelines: () => Promise<Pipeline[]>;
      savePipeline: (pl: Partial<Pipeline>) => Promise<Pipeline>;
      deletePipeline: (id: string) => Promise<boolean>;
      runPipeline: (payload: { pipelineId: string; input: string; runId: string }) => Promise<{ conversationId: string }>;
      answerPipeline: (payload: { runId: string; answerText: string }) => Promise<boolean>;
      abortPipeline: (runId: string) => Promise<boolean>;
      pendingClarifications: () => Promise<{ runId: string; conversationId: string; stepIndex: number; pipelineName: string }[]>;
      listArtifacts: () => Promise<ArtifactMeta[]>;
      getArtifact: (id: string) => Promise<Artifact | null>;
      saveArtifact: (art: {
        id?: string;
        title?: string;
        tags?: string[];
        content?: string;
        provider?: string | null;
        model?: string | null;
        role_card_id?: string | null;
        card_name?: string | null;
        conversation_id?: string | null;
        message_id?: string | null;
      }) => Promise<ArtifactMeta>;
      deleteArtifact: (id: string) => Promise<boolean>;
      searchArtifacts: (query: string) => Promise<ArtifactMeta[]>;
      exportArtifact: (id: string) => Promise<boolean>;
      listTasks: () => Promise<Task[]>;
      saveTask: (task: Partial<Task>) => Promise<Task>;
      deleteTask: (id: string) => Promise<boolean>;
      listSuggestions: () => Promise<TaskSuggestion[]>;
      resolveSuggestion: (id: string, accept: boolean) => Promise<Task | null>;
      scanNow: () => Promise<{ scanned?: number; detected?: number; error?: string | null; skipped?: boolean }>;
      getBriefing: (force?: boolean) => Promise<Briefing>;
      extractFile: (filePath: string) => Promise<{ text: string | null; error: string | null }>;
      listGenModels: (provider: Provider) => Promise<{ models: ModelInfo[]; error: string | null }>;
      generateImage: (payload: { provider: Provider; model: string; prompt: string }) => Promise<MediaItem>;
      listMedia: () => Promise<MediaItem[]>;
      deleteMedia: (id: string) => Promise<boolean>;
      saveMediaAs: (absPath: string) => Promise<boolean>;
      runWizard: (goal: string) => Promise<WizardProposal[]>;
      onAppEvent: (cb: (channel: AppEvent, payload: any) => void) => () => void;
      onChatEvent: (cb: (channel: ChatEvent, payload: any) => void) => () => void;
      getUsage: (ym: string) => Promise<{ records: UsageRecord[] }>;
      listUsageMonths: () => Promise<string[]>;
    };
  }
}
