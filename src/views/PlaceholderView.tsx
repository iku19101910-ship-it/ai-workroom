export default function PlaceholderView({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="panel">
      <div className="panel-title-row">
        <span className="panel-title">{title}</span>
        <span className="panel-title-meta">
          <span className="badge">{phase}で実装予定</span>
        </span>
      </div>
      <p className="muted" style={{ lineHeight: 1.9 }}>{description}</p>
    </div>
  );
}
