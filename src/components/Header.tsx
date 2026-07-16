export default function Header({
  title,
  themeMode,
  onToggleTheme,
}: {
  title: string;
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <div className="header">
      <div className="header-title">{title}</div>
      <div className="header-spacer" />
      <button
        className="icon-btn"
        onClick={onToggleTheme}
        title={themeMode === "light" ? "ダークモードに切替" : "ライトモードに切替"}
      >
        {themeMode === "light" ? "🌙" : "☀️"}
      </button>
    </div>
  );
}
