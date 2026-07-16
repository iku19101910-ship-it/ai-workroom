import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, SearchResult, SearchResultType } from "../types";

const GROUPS: { type: SearchResultType; label: string }[] = [
  { type: "conversation", label: "💬 会話" }, { type: "doc", label: "📚 資料" },
  { type: "artifact", label: "📦 成果物" }, { type: "task", label: "📋 タスク" },
  { type: "card", label: "🃏 カード" }, { type: "pipeline", label: "⛓ パイプライン" },
];

function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

export default function GlobalSearch({ projects, onClose, onOpen }: {
  projects: Project[];
  onClose: () => void;
  onOpen: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const flat = useMemo(() => GROUPS.flatMap((g) => results.filter((r) => r.type === g.type)), [results]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const timer = setTimeout(async () => {
      const next = query.trim() ? await window.api.globalSearch(query) : [];
      setResults(next);
      setSelected(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((x) => Math.min(flat.length - 1, x + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter" && flat[selected]) onOpen(flat[selected]);
  };

  let flatIndex = -1;
  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose}>
      <div className="global-search" onClick={(e) => e.stopPropagation()} onKeyDown={keyDown}>
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="会話・資料・成果物・タスクを検索…" />
        <div className="global-search-results">
          {query.trim() && flat.length === 0 && <div className="empty-state">一致する項目がありません</div>}
          {GROUPS.map((group) => {
            const items = results.filter((r) => r.type === group.type);
            if (!items.length) return null;
            return <div key={group.type}>
              <div className="global-search-group">{group.label}</div>
              {items.map((result) => {
                flatIndex += 1;
                const index = flatIndex;
                const projectName = result.project_id ? projects.find((p) => p.id === result.project_id)?.name : null;
                return <button key={`${result.type}:${result.id}`} className={`global-search-row${selected === index ? " selected" : ""}`} onMouseEnter={() => setSelected(index)} onClick={() => onOpen(result)}>
                  <span className="global-search-title"><Highlight text={result.title} query={query} /> {projectName && <span className="badge muted">{projectName}</span>}</span>
                  <span className="global-search-excerpt"><Highlight text={result.excerpt} query={query} /></span>
                </button>;
              })}
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}
