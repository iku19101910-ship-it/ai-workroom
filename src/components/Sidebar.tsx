import { useState } from "react";

export type ViewId =
  | "home"
  | "chat"
  | "cards"
  | "artifacts"
  | "pipelines"
  | "tasks"
  | "studio"
  | "cost"
  | "settings";

interface Item {
  id: ViewId;
  icon: string;
  label: string;
}

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "一般",
    items: [
      { id: "home", icon: "🏠", label: "ホーム" },
      { id: "chat", icon: "💬", label: "チャット" },
      { id: "cards", icon: "🃏", label: "役割カード" },
      { id: "artifacts", icon: "📦", label: "保管庫" },
      { id: "pipelines", icon: "⛓", label: "パイプライン" },
      { id: "tasks", icon: "📋", label: "タスク" },
      { id: "studio", icon: "🎨", label: "生成スタジオ" },
    ],
  },
  {
    title: "分析",
    items: [{ id: "cost", icon: "📊", label: "コスト" }],
  },
  {
    title: "システム",
    items: [{ id: "settings", icon: "⚙️", label: "設定" }],
  },
];

export default function Sidebar({
  view,
  onSelect,
}: {
  view: ViewId;
  onSelect: (v: ViewId) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-brand">{collapsed ? "AI" : "AI作業場"}</div>
      {SECTIONS.map((sec) => (
        <div key={sec.title}>
          {!collapsed && <div className="sidebar-section">{sec.title}</div>}
          {sec.items.map((item) => (
            <button
              key={item.id}
              className={"sidebar-item" + (view === item.id ? " active" : "")}
              onClick={() => onSelect(item.id)}
              title={item.label}
            >
              <span className="icon">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </div>
      ))}
      <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? "»" : "« 折りたたむ"}
      </button>
    </nav>
  );
}
