// 各AI・モデルの強み早見データ。
// モデル一覧はAPIから動的取得するため(§3)、モデルID/名前の命名パターンから
// 特徴を推定する方式にしている(新モデルが出ても説明が自動で付く)。
import type { Provider } from "./types";

export interface ProviderStrength {
  title: string;
  points: string[]; // 強み
  fit: string; // このアプリでの向き先
}

export const PROVIDER_STRENGTHS: Record<Provider, ProviderStrength> = {
  anthropic: {
    title: "Claude(Anthropic)",
    points: [
      "長文の読解・執筆と自然な日本語表現",
      "複雑な指示への忠実さ・文体の維持",
      "コーディングと丁寧な推敲",
    ],
    fit: "小説の執筆・推敲、長い文章のリライトに向く",
  },
  openai: {
    title: "GPT(OpenAI)",
    points: [
      "幅広い汎用性と安定した応答",
      "論理的な分析・構造化・批評",
      "推論特化モデル(o系)による深い思考",
    ],
    fit: "整合性チェック、構造的な分析・批評に向く",
  },
  google: {
    title: "Gemini(Google)",
    points: [
      "巨大コンテキスト(長い資料の一括読み込み)",
      "Flash系の高速・低コスト処理",
      "検索的な知識の広さとマルチモーダル",
    ],
    fit: "資料の要約・大量テキストの下処理、秘書役に向く",
  },
};

interface FamilyRule {
  pattern: RegExp;
  label: string;
  description: string;
}

// モデルの系統判定(上から順に評価、先にマッチしたものを採用)
const FAMILY_RULES: FamilyRule[] = [
  // ---- Anthropic ----
  { pattern: /fable|mythos/i, label: "最上位", description: "Claudeの最上位モデル。最も高度な推論と長時間の複雑なタスク向け。コストは高め。" },
  { pattern: /opus/i, label: "上位", description: "Claude上位モデル。最高品質の文章生成・推論。品質最優先の作業に。" },
  { pattern: /sonnet/i, label: "バランス", description: "品質と速度・コストのバランス型。執筆・推敲の主力に最適。" },
  { pattern: /haiku/i, label: "軽量", description: "高速・低コスト。要約・分類・下処理などの量をこなす作業に。" },

  // ---- 生成系・特殊系(プロバイダ共通で先に判定) ----
  { pattern: /lyria/i, label: "音楽生成", description: "音楽・音声クリップの生成専用モデル。チャットには不向き。" },
  { pattern: /banana|imagen|dall-e|gpt-image/i, label: "画像生成", description: "画像生成専用モデル。チャットではなく生成スタジオで使うタイプ。" },
  { pattern: /veo|sora/i, label: "動画生成", description: "動画生成専用モデル。高コスト・長時間の生成になる。" },
  { pattern: /robotics/i, label: "ロボット", description: "ロボット制御・空間理解向けの実験的モデル。通常のチャット用途には不向き。" },
  { pattern: /realtime|live|native-audio|\btts\b|audio/i, label: "音声対話", description: "音声のリアルタイム対話・読み上げ向け。テキストチャットには通常版を推奨。" },
  { pattern: /computer-use/i, label: "PC操作", description: "画面操作(コンピュータ操作)特化のモデル。" },
  { pattern: /codex/i, label: "コード特化", description: "コーディング特化。プログラム生成・修正に強い。" },
  { pattern: /search/i, label: "検索連携", description: "Web検索と組み合わせて使う前提のモデル。" },

  // ---- OpenAI ----
  { pattern: /^o\d/i, label: "推論特化", description: "推論特化モデル。数学・論理・複雑な整合性チェックにじっくり考えて答える。応答は遅め。" },
  { pattern: /nano/i, label: "最軽量", description: "最速・最安クラス。単純な分類や短い定型処理に。" },
  { pattern: /mini/i, label: "軽量", description: "高速・低コスト。日常的な質問や下処理に十分な品質。" },
  { pattern: /chatgpt/i, label: "会話向け", description: "ChatGPT向けチューニング。自然な会話・雑談が得意。" },
  { pattern: /gpt.*pro/i, label: "最上位", description: "GPTの最上位クラス。最高品質の推論。コスト高・低速。" },
  { pattern: /^gpt/i, label: "汎用", description: "GPTの汎用フラッグシップ系。幅広いタスクを安定してこなす。" },

  // ---- Google ----
  { pattern: /gemma/i, label: "オープン軽量", description: "軽量オープンモデル(Gemma)。簡単なタスク向けで、上位Geminiより品質は控えめ。" },
  { pattern: /omni/i, label: "統合マルチ", description: "テキスト・画像・音声を統合的に扱うマルチモーダル系。" },
  { pattern: /deep-?think/i, label: "推論特化", description: "深い推論に特化。難問をじっくり考えるタイプで応答は遅め。" },
  { pattern: /flash-?lite/i, label: "最軽量", description: "Gemini最速・最安クラス。大量の下処理や単純作業に。" },
  { pattern: /flash/i, label: "軽量", description: "高速・低コスト。要約・抽出など量をこなす作業の主力に。" },
  { pattern: /gemini.*pro|(^|[^a-z])pro([^a-z]|$)/i, label: "上位", description: "Gemini上位モデル。長い資料の読解や複雑なタスクに。巨大コンテキストが強み。" },
  { pattern: /ultra/i, label: "最上位", description: "Geminiの最上位モデル。最高品質が必要な場面に。" },
];

// 名前の修飾語からの注記
function suffixNotes(modelId: string): string[] {
  const notes: string[] = [];
  if (/preview/i.test(modelId)) notes.push("プレビュー版(仕様変更・提供終了の可能性あり)");
  if (/exp/i.test(modelId) && /gemini|gemma/i.test(modelId)) notes.push("実験版");
  if (/latest/i.test(modelId)) notes.push("常にその系統の最新版を指す別名");
  const m = modelId.match(/(\d+(?:\.\d+)?)/);
  if (m && /gemini|gpt|claude/i.test(modelId)) notes.push(`第${m[1]}世代(数字が大きいほど新しい)`);
  return notes;
}

export function describeModel(modelIdOrLabel: string): { label: string; description: string } | null {
  const s = modelIdOrLabel || "";
  if (!s) return null;
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(s)) {
      const notes = suffixNotes(s);
      return {
        label: rule.label,
        description: rule.description + (notes.length ? " ※" + notes.join("・") : ""),
      };
    }
  }
  const notes = suffixNotes(s);
  return {
    label: "一般",
    description:
      "標準的なチャットモデル。" + (notes.length ? " ※" + notes.join("・") : ""),
  };
}
