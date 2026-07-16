import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "../types";
import { describeModel } from "../modelStrengths";

// 説明付きモデル選択。各モデルの下に強み(系統ラベル+説明)を表示する。
// defaultOption を渡すと先頭に「既定を使う」項目(value="")を出す(チャットの一時上書き用)。
export default function ModelPicker({
  models,
  value,
  onChange,
  defaultOption,
  disabled,
  placeholder = "(モデルを選択)",
  openDown,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  defaultOption?: string; // 例: "カード既定(gemini-3.5-flash)"
  disabled?: boolean;
  placeholder?: string;
  openDown?: boolean; // モーダル内など、下方向にリストを開きたい場合
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
    );
  }, [models, query]);

  const current = models.find((m) => m.id === value);
  const buttonLabel = value
    ? current?.label ?? value
    : defaultOption ?? placeholder;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div
      className={"model-picker" + (openDown ? " open-down" : "")}
      style={openDown ? { display: "block", width: "100%" } : undefined}
      ref={rootRef}
    >
      <button
        type="button"
        className="model-picker-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={value || undefined}
      >
        <span className="model-picker-label">{buttonLabel}</span>
        <span className="model-picker-caret">▾</span>
      </button>

      {open && (
        <div className="model-pop">
          <div className="model-pop-search">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="モデル名で絞り込み"
            />
          </div>
          <div className="model-pop-list">
            {defaultOption && (
              <button
                type="button"
                className={"model-item" + (value === "" ? " selected" : "")}
                onClick={() => pick("")}
              >
                <span className="model-item-name">{defaultOption}</span>
                <span className="model-item-desc">カードに設定されたモデルをそのまま使う</span>
              </button>
            )}
            {filtered.map((m) => {
              const info = describeModel(m.label !== m.id ? `${m.id} ${m.label}` : m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  className={"model-item" + (value === m.id ? " selected" : "")}
                  onClick={() => pick(m.id)}
                  title={m.id}
                >
                  <span className="model-item-name">
                    {m.label}
                    {info && <span className="model-item-tier">{info.label}</span>}
                  </span>
                  {info && <span className="model-item-desc">{info.description}</span>}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="model-item-empty">該当するモデルがありません</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
