import { useMemo, useState } from "react";
import type { Provider, RoleCard, UsageRecord } from "../types";
import { PROVIDER_LABELS } from "../types";
import { PROVIDER_ORDER, resolveProvider, formatTokens } from "../usageUtils";

// 日別×プロバイダ別の積み上げ棒グラフ(入力+出力の合計トークン)。
// 色はCSS変数(--chart-*)でテーマ連動。ホバーで日別内訳ツールチップを表示。
const CHART_H = 200;
const PAD_LEFT = 44;
const PAD_BOTTOM = 22;
const PAD_TOP = 10;

interface DayStack {
  day: number;
  date: string;
  byProvider: Record<Provider, number>;
  total: number;
}

function niceMax(n: number): number {
  if (n <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (n <= m * pow) return m * pow;
  }
  return 10 * pow;
}

export default function UsageChart({
  records,
  cards,
  ym,
}: {
  records: UsageRecord[];
  cards: RoleCard[];
  ym: string;
}) {
  const [hover, setHover] = useState<{ day: DayStack; x: number } | null>(null);

  const days: DayStack[] = useMemo(() => {
    const [y, m] = ym.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const list: DayStack[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2, "0")}`;
      list.push({
        day: d,
        date,
        byProvider: { anthropic: 0, openai: 0, google: 0 },
        total: 0,
      });
    }
    for (const r of records) {
      const d = Number(r.date.slice(8, 10));
      const entry = list[d - 1];
      if (!entry) continue;
      const p = resolveProvider(r, cards);
      const v = r.input + r.output;
      entry.byProvider[p] += v;
      entry.total += v;
    }
    return list;
  }, [records, cards, ym]);

  const width = 720;
  const plotW = width - PAD_LEFT - 8;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const maxVal = niceMax(Math.max(...days.map((d) => d.total), 1));
  const slot = plotW / days.length;
  const barW = Math.max(4, Math.min(16, slot - 4));
  const today = new Date().toISOString().slice(0, 10);

  const yTicks = [0, 0.5, 1].map((f) => ({
    v: maxVal * f,
    y: PAD_TOP + plotH - plotH * f,
  }));

  return (
    <div style={{ position: "relative" }}>
      <div className="chart-legend">
        {PROVIDER_ORDER.map((p) => (
          <span key={p} className="chart-legend-item">
            <span className="chart-chip" style={{ background: `var(--chart-${p})` }} />
            {PROVIDER_LABELS[p]}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${CHART_H}`}
        style={{ width: "100%", display: "block" }}
        onMouseLeave={() => setHover(null)}
      >
        {/* グリッド線(控えめ)と目盛 */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD_LEFT}
              x2={width - 8}
              y1={t.y}
              y2={t.y}
              stroke="var(--divider-strong)"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={t.y + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-sub)"
            >
              {formatTokens(t.v)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const x = PAD_LEFT + i * slot + (slot - barW) / 2;
          let yCursor = PAD_TOP + plotH;
          const isToday = d.date === today;
          return (
            <g
              key={d.day}
              onMouseEnter={() => setHover({ day: d, x: PAD_LEFT + i * slot + slot / 2 })}
            >
              {/* ホバー用ヒットエリア(棒より広く) */}
              <rect
                x={PAD_LEFT + i * slot}
                y={PAD_TOP}
                width={slot}
                height={plotH + PAD_BOTTOM}
                fill="transparent"
              />
              {PROVIDER_ORDER.map((p) => {
                const v = d.byProvider[p];
                if (v <= 0) return null;
                const h = (v / maxVal) * plotH;
                // 積み上げ区画の間に2pxの地色ギャップ
                const gap = h > 3 ? 2 : 0;
                yCursor -= h;
                return (
                  <rect
                    key={p}
                    x={x}
                    y={yCursor + gap / 2}
                    width={barW}
                    height={Math.max(1, h - gap)}
                    rx={1.5}
                    fill={`var(--chart-${p})`}
                    opacity={hover && hover.day.day !== d.day ? 0.45 : 1}
                  />
                );
              })}
              {(d.day === 1 || d.day % 5 === 0 || isToday) && (
                <text
                  x={PAD_LEFT + i * slot + slot / 2}
                  y={CHART_H - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={isToday ? 700 : 400}
                  fill={isToday ? "var(--accent)" : "var(--text-sub)"}
                >
                  {d.day}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover && hover.day.total > 0 && (
        <div
          className="chart-tooltip"
          style={{ left: `${(hover.x / width) * 100}%` }}
        >
          <div className="chart-tooltip-title">
            {hover.day.date}
            {hover.day.date === today ? "(今日)" : ""}
          </div>
          {PROVIDER_ORDER.filter((p) => hover.day.byProvider[p] > 0).map((p) => (
            <div key={p} className="chart-tooltip-row">
              <span className="chart-chip" style={{ background: `var(--chart-${p})` }} />
              <span>{PROVIDER_LABELS[p]}</span>
              <span className="chart-tooltip-val">
                {hover.day.byProvider[p].toLocaleString()}
              </span>
            </div>
          ))}
          <div className="chart-tooltip-row total">
            <span>合計</span>
            <span className="chart-tooltip-val">{hover.day.total.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
