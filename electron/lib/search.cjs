const ws = require("./workspace.cjs");

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function excerpt(text, query) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const at = normalize(clean).indexOf(query);
  if (at < 0) return clean.slice(0, 80);
  return clean.slice(Math.max(0, at - 40), Math.min(clean.length, at + query.length + 40));
}

function searchAll(query) {
  const q = normalize(query).trim();
  if (!q) return [];
  const results = [];

  for (const meta of ws.listConversations()) {
    if (results.filter((r) => r.type === "conversation").length >= 10) break;
    const conv = ws.getConversation(meta.id);
    if (!conv) continue;
    let hitText = normalize(conv.title).includes(q) ? conv.title : "";
    let hitMessage = null;
    if (!hitText) {
      hitMessage = conv.messages.find((m) => normalize(m.content).includes(q)) ?? null;
      hitText = hitMessage?.content ?? "";
    }
    if (hitText) results.push({ type: "conversation", id: conv.id, title: conv.title, excerpt: excerpt(hitText, q), project_id: conv.project_id ?? null, meta: { message_id: hitMessage?.id ?? null } });
  }

  for (const docMeta of ws.listSharedDocs()) {
    if (results.filter((r) => r.type === "doc").length >= 10) break;
    const doc = ws.getSharedDoc(docMeta.id);
    const hitText = normalize(docMeta.title).includes(q) ? docMeta.title : normalize(doc?.content).includes(q) ? doc?.content : "";
    if (hitText) results.push({ type: "doc", id: docMeta.id, title: docMeta.title, excerpt: excerpt(hitText, q), project_id: docMeta.project_id ?? null, meta: null });
  }

  for (const meta of ws.listArtifacts()) {
    if (results.filter((r) => r.type === "artifact").length >= 10) break;
    const art = ws.getArtifact(meta.id);
    const searchable = [meta.title, ...(meta.tags || []), art?.content || ""].join(" ");
    if (normalize(searchable).includes(q)) results.push({ type: "artifact", id: meta.id, title: meta.title, excerpt: excerpt(searchable, q), project_id: meta.project_id ?? null, meta: null });
  }

  for (const task of ws.listTasks().filter((t) => normalize(t.title).includes(q)).slice(0, 10)) {
    results.push({ type: "task", id: task.id, title: task.title, excerpt: excerpt(task.title, q), project_id: task.project_id ?? null, meta: null });
  }
  for (const card of ws.listRoleCards().filter((c) => normalize(`${c.name} ${c.system_prompt}`).includes(q)).slice(0, 10)) {
    results.push({ type: "card", id: card.id, title: card.name, excerpt: excerpt(`${card.name} ${card.system_prompt}`, q), project_id: null, meta: null });
  }
  for (const pipeline of ws.listPipelines().filter((p) => normalize(p.name).includes(q)).slice(0, 10)) {
    results.push({ type: "pipeline", id: pipeline.id, title: pipeline.name, excerpt: excerpt(pipeline.name, q), project_id: pipeline.project_id ?? null, meta: null });
  }
  return results;
}

module.exports = { searchAll };
