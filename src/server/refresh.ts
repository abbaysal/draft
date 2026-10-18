import { nameKey } from "@/lib/names";
import type { ImportKind } from "@/lib/import/csv";
import { db, getConfig, setConfig } from "./db";
import { loadDataset } from "./dataset";
import { contentHash, runImport } from "./imports";

/**
 * Scheduled refresh (Vercel Cron → /api/cron/refresh). Every job is idempotent:
 * remote CSVs are skipped when their content hash is unchanged, news items are
 * deduplicated by link, and each run is recorded in RefreshRun. Live draft
 * transactions never depend on these jobs.
 */
async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "nba-9cat-war-room/1.0 (+personal use)" } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last instanceof Error ? last : new Error("fetch failed");
}

type JobResult = { status: "ok" | "skipped"; detail: Record<string, unknown> };

async function record(job: string, fn: () => Promise<JobResult>) {
  const prisma = db();
  const run = await prisma.refreshRun.create({ data: { job, status: "running" } });
  try {
    const r = await fn();
    await prisma.refreshRun.update({ where: { id: run.id }, data: { status: r.status, detail: r.detail as object, finishedAt: new Date() } });
    return { job, ...r };
  } catch (e) {
    const detail = { error: e instanceof Error ? e.message : String(e) };
    await prisma.refreshRun.update({ where: { id: run.id }, data: { status: "error", detail, finishedAt: new Date() } });
    return { job, status: "error" as const, detail };
  }
}

async function remoteCsv(kind: ImportKind, envVar: string, activate: boolean): Promise<JobResult> {
  const url = process.env[envVar];
  if (!url) return { status: "skipped" as const, detail: { reason: `${envVar} not configured` } };
  const text = await fetchWithRetry(url);
  const hash = contentHash(text);
  const key = `lastHash:${kind}`;
  if ((await getConfig<string>(key, "")) === hash) return { status: "skipped" as const, detail: { reason: "unchanged", hash } };
  const res = await runImport(kind, text, { source: new URL(url).hostname, label: `Auto ${kind} ${new Date().toISOString().slice(0, 10)}`, activate });
  await setConfig(key, hash);
  return { status: "ok" as const, detail: { imported: res.imported, unmatched: res.unmatched.length, issues: res.issues.length, targetId: res.targetId } };
}

async function newsFeeds(): Promise<JobResult> {
  const urls = (process.env.NEWS_FEED_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return { status: "skipped" as const, detail: { reason: "NEWS_FEED_URLS not configured" } };
  const { dataset } = await loadDataset();
  const keys = dataset.players.map((p) => ({ id: p.id, key: nameKey(p.name) })).filter((p) => p.key.split(" ").length >= 2);
  let created = 0;
  for (const url of urls) {
    const xml = await fetchWithRetry(url);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 50);
    for (const m of items) {
      const tag = (t: string) => (m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) ?? [])[1]?.trim();
      const title = tag("title");
      const link = tag("link");
      if (!title || !link) continue;
      const tk = nameKey(title);
      const hit = keys.find((k) => tk.includes(k.key));
      const r = await db().newsItem.createMany({
        data: [{ playerId: hit?.id ?? null, title: title.slice(0, 200), body: tag("description")?.replace(/<[^>]+>/g, "").slice(0, 1000) ?? null, kind: /injur|out|questionable|doubtful|surgery/i.test(title) ? "injury" : /trade|sign/i.test(title) ? "trade" : "other", status: "reported", confidence: "low", sourceName: new URL(url).hostname, sourceUrl: link, publishedAt: tag("pubDate") ? new Date(tag("pubDate")!) : new Date(), dedupeKey: `feed:${link}` }],
        skipDuplicates: true,
      });
      created += r.count;
    }
  }
  return { status: "ok" as const, detail: { created } };
}

async function qualityChecks(): Promise<JobResult> {
  const prisma = db();
  const set = await prisma.projectionSet.findFirst({ where: { isActive: true } });
  if (!set) return { status: "ok" as const, detail: { problems: ["No active projection set"] } };
  const rows = await prisma.projection.findMany({ where: { setId: set.id } });
  const problems: string[] = [];
  for (const r of rows) {
    if (r.fgm > r.fga + 1e-6 || r.ftm > r.fta + 1e-6) problems.push(`${r.playerId}: makes exceed attempts`);
    if (r.gp < 0 || r.gp > 82) problems.push(`${r.playerId}: GP out of range`);
    if ([r.pts, r.reb, r.ast, r.stl, r.blk, r.tov, r.fg3m].some((x) => x < 0 || !Number.isFinite(x))) problems.push(`${r.playerId}: invalid stat`);
  }
  const players = await prisma.player.count();
  return { status: "ok" as const, detail: { activeSet: set.id, projections: rows.length, players, problems: problems.slice(0, 50), problemCount: problems.length } };
}

export async function runRefresh() {
  return [
    await record("quality", qualityChecks),
    await record("projections", () => remoteCsv("projections", "PROJECTIONS_CSV_URL", process.env.AUTO_ACTIVATE_PROJECTIONS === "true")),
    await record("adp", () => remoteCsv("adp", "ADP_CSV_URL", true)),
    await record("schedule", () => remoteCsv("schedule", "SCHEDULE_CSV_URL", true)),
    await record("news", newsFeeds),
  ];
}
