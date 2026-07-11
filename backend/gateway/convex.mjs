// Convex HTTP API client — same pattern as website/lib.mjs.
export function convexClient(url) {
  const base = url.replace(/\/$/, "");
  const call = async (endpoint, path, args) => {
    const res = await fetch(`${base}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
    });
    const d = await res.json();
    if (d.status !== "success") throw new Error(`${path}: ${d.errorMessage}`);
    return d.value;
  };
  return {
    query: (path, args) => call("query", path, args),
    mutation: (path, args) => call("mutation", path, args),
  };
}

// PII masking for step summaries (same rule as the dashboard).
export function maskEmail(text) {
  if (!text) return text;
  return String(text).replace(
    /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "$1***@$2",
  );
}

// <= ~40-word summaries for the trace, masked.
export function summarize(value, words = 40) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return maskEmail(s.split(/\s+/).slice(0, words).join(" "));
}
