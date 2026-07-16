import { useState } from "react";
import RoleCardsView from "./RoleCardsView";
import SharedMemoryView from "./SharedMemoryView";
import type { RoleCard } from "../types";

// 役割カードと共有バイブルの統合画面(タブ切替)。
// カードは共有資料を参照する関係なので、同じ場所で管理できるようにする。
export default function CardsHubView({
  cards,
  onChanged,
}: {
  cards: RoleCard[];
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"cards" | "bible">("cards");

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          className={"btn small" + (tab === "cards" ? "" : " secondary")}
          onClick={() => setTab("cards")}
        >
          🃏 役割カード
        </button>
        <button
          className={"btn small" + (tab === "bible" ? "" : " secondary")}
          onClick={() => setTab("bible")}
        >
          📚 共有バイブル
        </button>
      </div>
      {tab === "cards" ? <RoleCardsView cards={cards} onChanged={onChanged} /> : <SharedMemoryView />}
    </div>
  );
}
