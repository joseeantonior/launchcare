// LaunchCare dashboard — pure logic, importable by test.mjs.

// PII masking for every judge-visible surface: "sam.t@gmail.com" -> "s***@gmail.com"
export function maskEmail(text) {
  if (!text) return text;
  return String(text).replace(
    /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "$1***@$2",
  );
}

// steps (flat, with parentStepId) -> array of roots, children sorted by startedAt.
// Orphans (parent missing from the list) render as roots rather than vanish.
export function buildTree(steps) {
  const byId = new Map(steps.map((s) => [s._id, { ...s, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentStepId && byId.get(node.parentStepId);
    (parent ? parent.children : roots).push(node);
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => a.startedAt - b.startedAt);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export const fmtUsd = (n) => `$${(n ?? 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString() : "—");

// Convex HTTP API client (no SDK, no build step).
export function convexClient(deploymentUrl) {
  const call = async (endpoint, path, args) => {
    const res = await fetch(`${deploymentUrl}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
    });
    const data = await res.json();
    if (data.status !== "success") throw new Error(data.errorMessage ?? "convex error");
    return data.value;
  };
  return {
    query: (path, args) => call("query", path, args),
    mutation: (path, args) => call("mutation", path, args),
  };
}
