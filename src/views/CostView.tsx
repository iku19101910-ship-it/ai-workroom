import { useEffect, useMemo, useState } from "react";
import type { Provider, RoleCard, Settings, UsageRecord } from "../types";
import { PROVIDER_LABELS } from "../types";
import { PROVIDER_ORDER, resolveProvider, totalsByProvider } from "../usageUtils";
import UsageChart from "../components/UsageChart";

// トークン使用量はフェーズ1から記録(§4.11)。単価入力による概算コスト表示はフェーズ4で拡張。
export default function CostView({ cards }: { cards: RoleCard[] }) {
  const [months, setMonths] = useState<string[]>([]);
  const [ym, setYm] = useState<string>(new Date().toISOString().slice(0, 7));
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    window.api.listUsageMonths().then((m) => {
      setMonths(m);
      if (m.length > 0 && !m.includes(ym)) setYm(m[0]);
    });
    window.api.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    window.api.getUsage(ym).then((u) => setRecords(u.records));
  }, [ym]);

  const cardName = (id: string) => cards.find((c) => c.id === id)?.name ?? id;

  const prices = settings?.usage_prices ?? {};

  // 単価が数値として1つでも入力されているモデルのみコスト計算対象とする(§4.11)
  const costForRecord = (r: UsageRecord): number | null => {
    const p = prices[r.model];
    if (!p || (p.input == null && p.output == null)) return null;
    const inCost = p.input != null ? (r.input / 1_000_000) * p.input : 0;
    const outCost = p.output != null ? (r.output / 1_000_000) * p.output : 0;
    return inCost + outCost;
  };

  const byProvider = useMemo(() => totalsByProvider(records, cards), [records, cards]);

  const providerCostInfo = useMemo(() => {
    const out: Record<Provider, { cost: number; hasAny: boolean }> = {
      anthropic: { cost: 0, hasAny: false },
      openai: { cost: 0, hasAny: false },
      google: { cost: 0, hasAny: false },
    };
    for (const r of records) {
      const p = resolveProvider(r, cards);
      const c = costForRecord(r);
      if (c != null) {
        out[p].cost += c;
        out[p].hasAny = true;
      }
    }
    return out;
  }, [records, cards, prices]);

  const total = useMemo(
    () =>
      records.reduce(
        (acc, r) => ({ input: acc.input + r.input, output: acc.output + r.output, count: acc.count + r.count }),
        { input: 0, output: 0, count: 0 }
      ),
    [records]
  );

  const totalCostInfo = useMemo(() => {
    let cost = 0;
    let hasAny = false;
    for (const r of records) {
      const c = costForRecord(r);
      if (c != null) {
        cost += c;
        hasAny = true;
      }
    }
    return { cost, hasAny };
  }, [records, prices]);

  const cacheInfo = useMemo(() => {
    let totalCacheRead = 0;
    let savings = 0;
    let hasPricedCache = false;
    for (const r of records) {
      const cr = r.cache_read ?? 0;
      totalCacheRead += cr;
      const p = prices[r.model];
      if (p?.input != null && cr > 0) {
        // キャッシュ読取は通常入力の約1/10価格として計算(§8.5)。節約額 = 通常価格との差分。
        savings += (cr / 1_000_000) * p.input * 0.9;
        hasPricedCache = true;
      }
    }
    return { totalCacheRead, savings, hasPricedCache };
  }, [records, prices]);

  const byCard = useMemo(() => {
    const map = new Map<string, { input: number; output: number; count: number }>();
    for (const r of records) {
      const cur = map.get(r.role_card_id) ?? { input: 0, output: 0, count: 0 };
      cur.input += r.input;
      cur.output += r.output;
      cur.count += r.count;
      map.set(r.role_card_id, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));
  }, [records]);

  const providerCard = (p: Provider) => {
    const v = byProvider[p];
    const c = providerCostInfo[p];
    return (
      <div className="stat-card" key={p}>
        <div className="provider-head">
          <span className="chart-chip" style={{ background: `var(--chart-${p})` }} />
          {PROVIDER_LABELS[p]}
        </div>
        <div className="provider-stat-row">
          <span>入力</span>
          <b>{v.input.toLocaleString()}</b>
        </div>
        <div className="provider-stat-row">
          <span>出力</span>
          <b>{v.output.toLocaleString()}</b>
        </div>
        <div className="provider-stat-row total-row">
          <span>合計</span>
          <b>{(v.input + v.output).toLocaleString()}</b>
        </div>
        {c.hasAny ? (
          <div className="provider-stat-row">
            <span>概算</span>
            <b>${c.cost.toFixed(2)}</b>
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 4 }}>
            単価未設定(設定画面で入力)
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* プロバイダ別+全体合計(月間) */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {PROVIDER_ORDER.map(providerCard)}
        <div className="stat-card">
          <div className="provider-head">全体合計({ym})</div>
          <div className="provider-stat-row">
            <span>入力</span>
            <b>{total.input.toLocaleString()}</b>
          </div>
          <div className="provider-stat-row">
            <span>出力</span>
            <b>{total.output.toLocaleString()}</b>
          </div>
          <div className="provider-stat-row total-row">
            <span>合計({total.count.toLocaleString()}回)</span>
            <b>{(total.input + total.output).toLocaleString()}</b>
          </div>
          {totalCostInfo.hasAny ? (
            <div className="provider-stat-row">
              <span>概算合計</span>
              <b>${totalCostInfo.cost.toFixed(2)}</b>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 4 }}>
              単価未設定(設定画面で入力)
            </div>
          )}
        </div>
      </div>

      {/* 日別グラフ(プロバイダ別積み上げ) */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">日別使用量(入力+出力トークン)</span>
          <span className="panel-title-meta">
            <select value={ym} onChange={(e) => setYm(e.target.value)}>
              {(months.length ? months : [ym]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </span>
        </div>
        {records.length === 0 ? (
          <div className="muted" style={{ padding: "24px 0", textAlign: "center" }}>
            この月の記録はありません。チャットでAIと会話すると記録されます。
          </div>
        ) : (
          <UsageChart records={records} cards={cards} ym={ym} />
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">キャッシュ節約(§8.5)</span>
        </div>
        <div className="provider-stat-row">
          <span>キャッシュ読取トークン合計</span>
          <b>{cacheInfo.totalCacheRead.toLocaleString()}</b>
        </div>
        {cacheInfo.hasPricedCache ? (
          <div className="muted" style={{ marginTop: 6 }}>
            キャッシュにより約${cacheInfo.savings.toFixed(2)}節約(読取は通常入力の約1/10価格として計算)
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>
            単価未設定のため節約額は計算できません(設定画面でモデル単価を入力してください)。
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">カード別使用量</span>
        </div>
        <table className="usage-table">
          <thead>
            <tr>
              <th>役割カード</th>
              <th className="num">入力</th>
              <th className="num">出力</th>
              <th className="num">合計</th>
              <th className="num">回数</th>
            </tr>
          </thead>
          <tbody>
            {byCard.map(([id, v]) => (
              <tr key={id}>
                <td>{cardName(id)}</td>
                <td className="num">{v.input.toLocaleString()}</td>
                <td className="num">{v.output.toLocaleString()}</td>
                <td className="num">{(v.input + v.output).toLocaleString()}</td>
                <td className="num">{v.count.toLocaleString()}</td>
              </tr>
            ))}
            {byCard.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">この月の記録はありません</td>
              </tr>
            )}
          </tbody>
          {byCard.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>合計</td>
                <td className="num">{total.input.toLocaleString()}</td>
                <td className="num">{total.output.toLocaleString()}</td>
                <td className="num">{(total.input + total.output).toLocaleString()}</td>
                <td className="num">{total.count.toLocaleString()}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">日別明細</span>
        </div>
        <table className="usage-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>AI</th>
              <th>カード</th>
              <th>モデル</th>
              <th className="num">入力</th>
              <th className="num">出力</th>
              <th className="num">合計</th>
              <th className="num">キャッシュ読取</th>
              <th className="num">概算$</th>
            </tr>
          </thead>
          <tbody>
            {[...records].reverse().map((r, i) => {
              const cost = costForRecord(r);
              return (
                <tr key={i}>
                  <td>{r.date}</td>
                  <td>
                    {PROVIDER_LABELS[
                      (r.provider as Provider) ??
                        cards.find((c) => c.id === r.role_card_id)?.provider ??
                        "openai"
                    ]}
                  </td>
                  <td>{cardName(r.role_card_id)}</td>
                  <td>{r.model}</td>
                  <td className="num">{r.input.toLocaleString()}</td>
                  <td className="num">{r.output.toLocaleString()}</td>
                  <td className="num">{(r.input + r.output).toLocaleString()}</td>
                  <td className="num">{(r.cache_read ?? 0).toLocaleString()}</td>
                  <td className="num">{cost != null ? `$${cost.toFixed(3)}` : "—"}</td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">記録がありません</td>
              </tr>
            )}
          </tbody>
          {records.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={4}>合計</td>
                <td className="num">{total.input.toLocaleString()}</td>
                <td className="num">{total.output.toLocaleString()}</td>
                <td className="num">{(total.input + total.output).toLocaleString()}</td>
                <td className="num">
                  {records.reduce((a, r) => a + (r.cache_read ?? 0), 0).toLocaleString()}
                </td>
                <td className="num">{totalCostInfo.hasAny ? `$${totalCostInfo.cost.toFixed(2)}` : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
