import type { Provider, RoleCard, UsageRecord } from "./types";

export const PROVIDER_ORDER: Provider[] = ["anthropic", "openai", "google"];

// 使用記録のプロバイダ判定。新しい記録はprovider付き。古い記録はカード→モデル名から推定。
export function resolveProvider(r: UsageRecord, cards: RoleCard[]): Provider {
  if (r.provider && PROVIDER_ORDER.includes(r.provider as Provider)) {
    return r.provider as Provider;
  }
  const card = cards.find((c) => c.id === r.role_card_id);
  if (card) return card.provider;
  const m = (r.model || "").toLowerCase();
  if (m.includes("claude")) return "anthropic";
  if (m.includes("gemini")) return "google";
  return "openai";
}

export interface ProviderTotals {
  input: number;
  output: number;
  count: number;
}

export function totalsByProvider(
  records: UsageRecord[],
  cards: RoleCard[]
): Record<Provider, ProviderTotals> {
  const out: Record<Provider, ProviderTotals> = {
    anthropic: { input: 0, output: 0, count: 0 },
    openai: { input: 0, output: 0, count: 0 },
    google: { input: 0, output: 0, count: 0 },
  };
  for (const r of records) {
    const p = resolveProvider(r, cards);
    out[p].input += r.input;
    out[p].output += r.output;
    out[p].count += r.count;
  }
  return out;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}
