import type { Project, ProjectScope } from "../types";

export default function ProjectBadge({ projectId, projects, scope }: {
  projectId?: string | null;
  projects: Project[];
  scope: ProjectScope;
}) {
  if (scope !== null) return null;
  const name = projectId ? projects.find((p) => p.id === projectId)?.name ?? "不明なプロジェクト" : "未分類";
  return <span className="badge muted">{name}</span>;
}
