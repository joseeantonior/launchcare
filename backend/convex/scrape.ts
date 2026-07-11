// Knowledge-pack builder: fetch the tenant's website, follow a handful of
// same-origin links (docs/help/pricing pages first), strip to plain text,
// store in the org's knowledge table. Runs at onboarding (scheduled) or on
// demand ("Rescan" in the app → agency:rescanWebsite → here).
// ponytail: heuristic text extraction, no LLM summarization — the crew's
// docs_search greps raw text fine; summarize later if quality demands it.

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";

const MAX_PAGES = 6;
const MAX_CHARS_PER_PAGE = 8000;
const INTERESTING = /docs|help|faq|pricing|support|guide|how|about/i;

function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|#160);/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE);
  return { title, text };
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    // Convex default runtime: fetch is available, AbortSignal.timeout isn't.
    const res = await Promise.race([
      fetch(url, {
        headers: { "User-Agent": "LaunchCareBot/0.1 (+support ops onboarding)" },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html"))
      return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Primary ingestion: Linkup search restricted to the tenant's domain —
// returns clean page content without crawling. Needs LINKUP_KEY set on the
// Convex deployment (npx convex env set [--prod] LINKUP_KEY ...).
async function linkupIngest(site: URL) {
  if (!process.env.LINKUP_KEY) return null;
  try {
    const res = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINKUP_KEY}`,
      },
      body: JSON.stringify({
        q: "product documentation, features, how-to guides, pricing, FAQ, and support information",
        depth: "standard",
        outputType: "searchResults",
        includeDomains: [site.hostname],
        maxResults: 10,
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const pages = (d.results ?? [])
      .filter((r: any) => r.type !== "image" && r.content?.length > 100)
      .map((r: any) => ({
        url: r.url,
        title: r.name,
        content: String(r.content).slice(0, MAX_CHARS_PER_PAGE),
      }));
    return pages.length ? pages : null;
  } catch {
    return null;
  }
}

export const scrapeWebsite = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.runQuery(api.agency.getOrganization, { orgId: args.orgId });
    if (!org?.website) return "no website on org";
    const base = new URL(org.website);

    // Linkup first; naive same-origin crawl as fallback.
    const viaLinkup = await linkupIngest(base);
    if (viaLinkup) {
      const count = await ctx.runMutation(internal.agency.replaceKnowledge, {
        orgId: args.orgId, pages: viaLinkup,
      });
      return `stored ${count} pages from ${base.hostname} via Linkup`;
    }

    const homeHtml = await fetchPage(base.href);
    if (!homeHtml) return `could not fetch ${base.href}`;

    // Same-origin links from the homepage, docs-ish paths first.
    const links = [...homeHtml.matchAll(/href=["']([^"'#?]+)["']/gi)]
      .map((m) => { try { return new URL(m[1], base).href; } catch { return null; } })
      .filter((u): u is string => !!u && u.startsWith(base.origin) && !/\.(png|jpe?g|svg|css|js|ico|pdf|zip)$/i.test(u));
    const unique = [...new Set(links)].filter((u) => u !== base.href);
    unique.sort((a, b) => Number(INTERESTING.test(b)) - Number(INTERESTING.test(a)));

    const pages: Array<{ url: string; title?: string; content: string }> = [];
    const home = htmlToText(homeHtml);
    pages.push({ url: base.href, title: home.title, content: home.text });
    for (const url of unique.slice(0, MAX_PAGES - 1)) {
      const html = await fetchPage(url);
      if (!html) continue;
      const { title, text } = htmlToText(html);
      if (text.length > 100) pages.push({ url, title, content: text });
    }

    const count = await ctx.runMutation(internal.agency.replaceKnowledge, {
      orgId: args.orgId, pages,
    });
    return `stored ${count} pages from ${base.origin}`;
  },
});
