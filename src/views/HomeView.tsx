import { useEffect, useMemo, useState } from "react";
import type { Briefing, ConversationMeta, RoleCard, Task, TaskSuggestion, UsageRecord } from "../types";
import { PROVIDER_LABELS } from "../types";
import { PROVIDER_ORDER, totalsByProvider } from "../usageUtils";
import type { ViewId } from "../components/Sidebar";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 期日を「7/9(明日)」のような表現に整形する(§5.4)。
function formatDue(dueDate: string): { text: string; urgent: boolean } {
  const due = new Date(dueDate + "T00:00:00");
  if (isNaN(due.getTime())) return { text: dueDate, urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  const md = `${due.getMonth() + 1}/${due.getDate()}`;
  let label = "";
  if (diffDays === 0) label = "今日";
  else if (diffDays === 1) label = "明日";
  else if (diffDays < 0) label = `${Math.abs(diffDays)}日超過`;
  else if (diffDays < 7) label = WEEKDAYS[due.getDay()];
  const text = label ? `${md}(${label})` : md;
  return { text, urgent: diffDays <= 1 };
}

const BRIEFING_REASON_MESSAGES: Record<string, string> = {
  no_tasks: "タスクがありません。タスクが登録されると毎朝ここにブリーフィングが表示されます。",
  no_key: "APIキー未設定のため生成できません。設定画面でAPIキーを登録してください。",
};

export default function HomeView({
  cards,
  onNavigate,
}: {
  cards: RoleCard[];
  onNavigate: (v: ViewId) => void;
}) {
  const [convs, setConvs] = useState<ConversationMeta[]>([]);
  const [todayRecords, setTodayRecords] = useState<UsageRecord[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);

  useEffect(() => {
    (async () => {
      setConvs(await window.api.listConversations());
      const ym = new Date().toISOString().slice(0, 7);
      const today = new Date().toISOString().slice(0, 10);
      const usage = await window.api.getUsage(ym);
      setTodayRecords(usage.records.filter((r: UsageRecord) => r.date === today));
    })();
    window.api.getBriefing().then(setBriefing);
    (async () => {
      const all = await window.api.listTasks();
      const open = all
        .filter((t) => t.status === "open")
        .sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        })
        .slice(0, 8);
      setTasks(open);
      setSuggestions(await window.api.listSuggestions());
    })();
  }, []);

  const regenerateBriefing = async () => {
    setBriefingLoading(true);
    try {
      setBriefing(await window.api.getBriefing(true));
    } finally {
      setBriefingLoading(false);
    }
  };

  const todayByProvider = useMemo(
    () => totalsByProvider(todayRecords, cards),
    [todayRecords, cards]
  );
  const todayTotal = useMemo(
    () =>
      todayRecords.reduce(
        (acc, r) => ({ input: acc.input + r.input, output: acc.output + r.output }),
        { input: 0, output: 0 }
      ),
    [todayRecords]
  );

  return (
    <div>
      {/* 朝ブリーフィング §4.8 */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">☀ 朝ブリーフィング</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={regenerateBriefing} disabled={briefingLoading}>
              🔄 再生成
            </button>
          </span>
        </div>
        {briefing?.text ? (
          <div>
            {briefing.cardName && (
              <span className="badge" style={{ marginBottom: 8, display: "inline-block" }}>
                {briefing.cardName}
              </span>
            )}
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{briefing.text}</div>
          </div>
        ) : (
          <div className="muted">
            {briefing
              ? BRIEFING_REASON_MESSAGES[briefing.reason ?? ""] ?? "ブリーフィングを生成できませんでした。"
              : "読み込み中…"}
          </div>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">役割カード</div>
          <div className="stat-value">{cards.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">会話</div>
          <div className="stat-value">{convs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日の合計トークン</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {(todayTotal.input + todayTotal.output).toLocaleString()}
          </div>
          <div className="stat-note">
            入力 {todayTotal.input.toLocaleString()} / 出力 {todayTotal.output.toLocaleString()}
          </div>
        </div>
      </div>

      {/* 今日のAI別使用量 */}
      <div className="panel">
        <div className="panel-title-row">
          <span className="panel-title">今日の使用量(AI別)</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={() => onNavigate("cost")}>
              コスト詳細へ
            </button>
          </span>
        </div>
        {todayRecords.length === 0 ? (
          <div className="muted">今日はまだAPIを使用していません</div>
        ) : (
          <table className="usage-table">
            <thead>
              <tr>
                <th>AI</th>
                <th className="num">入力</th>
                <th className="num">出力</th>
                <th className="num">合計</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_ORDER.map((p) => {
                const v = todayByProvider[p];
                if (v.input + v.output === 0) return null;
                return (
                  <tr key={p}>
                    <td>
                      <span className="chart-chip" style={{ background: `var(--chart-${p})`, marginRight: 6 }} />
                      {PROVIDER_LABELS[p]}
                    </td>
                    <td className="num">{v.input.toLocaleString()}</td>
                    <td className="num">{v.output.toLocaleString()}</td>
                    <td className="num">{(v.input + v.output).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>合計</td>
                <td className="num">{todayTotal.input.toLocaleString()}</td>
                <td className="num">{todayTotal.output.toLocaleString()}</td>
                <td className="num">{(todayTotal.input + todayTotal.output).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel">
          <div className="panel-title-row">
            <span className="panel-title">最近の会話</span>
            <span className="panel-title-meta">
              <button className="btn small" onClick={() => onNavigate("chat")}>
                チャットへ
              </button>
            </span>
          </div>
          {convs.length === 0 && <div className="muted">まだ会話がありません</div>}
          {convs.slice(0, 6).map((c) => (
            <div className="list-row" key={c.id}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title}
              </span>
              <span className="row-actions muted" style={{ fontSize: 10 }}>
                {c.updated_at?.slice(5, 10)}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <span className="panel-title">役割カード</span>
            <span className="panel-title-meta">
              <button className="btn small" onClick={() => onNavigate("cards")}>
                管理
              </button>
            </span>
          </div>
          {cards.length === 0 && (
            <div className="muted">
              まだ役割カードがありません。「役割カード」から作成してください。
            </div>
          )}
          {cards.slice(0, 6).map((c) => (
            <div className="list-row" key={c.id}>
              <span>{c.name}</span>
              <span className="row-actions">
                <span className="badge">
                  {c.name} · {PROVIDER_LABELS[c.provider]}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* タスクの常駐表示 §4.6-5 */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title-row">
          <span className="panel-title">タスク</span>
          <span className="panel-title-meta">
            <button className="btn small" onClick={() => onNavigate("tasks")}>
              タスク画面へ
            </button>
          </span>
        </div>
        {suggestions.length > 0 && (
          <div className="suggest-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>⚠ {suggestions.length}件の締め切り候補が確認待ちです</span>
              <button className="btn small" style={{ marginLeft: "auto" }} onClick={() => onNavigate("tasks")}>
                確認する
              </button>
            </div>
          </div>
        )}
        {tasks.length === 0 ? (
          <div className="muted">未完了のタスクはありません</div>
        ) : (
          tasks.map((t) => {
            const due = t.due_date ? formatDue(t.due_date) : null;
            return (
              <div className="list-row" key={t.id}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title}
                </span>
                {due ? (
                  <span className={"due-label" + (due.urgent ? " urgent" : "")}>{due.text}</span>
                ) : (
                  <span className="due-label">期日未設定</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
