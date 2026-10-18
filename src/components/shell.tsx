"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, BarChart3, ListChecks, BookOpen, Brain, CalendarDays, Database, FlaskConical, GitCompare, History, LayoutDashboard, Settings, Shuffle, Swords, Target, Users,
} from "lucide-react";
import { useStore, useActiveSession } from "@/client/store";
import { AnalysisRunner, useEngineContext } from "@/client/analysis";
import { Badge, Button, cn, Spinner } from "./ui";
import { Copilot } from "./copilot";

const NAV = [
  { href: "/", label: "War Room", icon: LayoutDashboard },
  { href: "/decision", label: "Decision Center", icon: Target },
  { href: "/players", label: "Players", icon: Users },
  { href: "/punt-lab", label: "Punt Lab", icon: FlaskConical },
  { href: "/team", label: "My Team", icon: BarChart3 },
  { href: "/lineup", label: "Matchups & Lineup", icon: ListChecks },
  { href: "/opponents", label: "Opponents", icon: Swords },
  { href: "/compare", label: "Compare", icon: GitCompare },
  { href: "/mock", label: "Mock Simulator", icon: Shuffle },
  { href: "/playoffs", label: "Playoffs", icon: CalendarDays },
  { href: "/history", label: "History & Audit", icon: History },
  { href: "/data", label: "Data", icon: Database },
  { href: "/library", label: "Strategy Library", icon: BookOpen },
  { href: "/settings", label: "League & Drafts", icon: Settings },
];

function DraftStatus() {
  const ctx = useEngineContext();
  const session = useActiveSession();
  if (!ctx || !session) return null;
  const total = ctx.totalPicks;
  const done = ctx.overall > total;
  const round = Math.floor((ctx.overall - 1) / ctx.settings.teams) + 1;
  const myTurn = ctx.onClock === ctx.myIndex;
  const next = myTurn ? ctx.overall : ctx.myNextPicks[0];
  return (
    <div className="flex items-center gap-3 text-xs" data-testid="draft-status">
      {done ? (
        <Badge tone="good">Draft complete</Badge>
      ) : (
        <>
          <span className="num text-mute">
            R{round} · Pick <span className="text-ink">{ctx.overall}</span>/{total}
          </span>
          <span className="text-mute">
            On clock: <span className={cn("font-semibold", myTurn ? "text-accent" : "text-ink")}>{ctx.settings.teamNames[ctx.onClock]}</span>
          </span>
          {myTurn ? (
            <Badge tone="accent">YOUR PICK</Badge>
          ) : next ? (
            <span className="text-mute">
              You pick #{next} <span className="text-dim">(in {next - ctx.overall})</span>
            </span>
          ) : (
            <span className="text-mute">No picks left</span>
          )}
        </>
      )}
    </div>
  );
}

function SyncBadge() {
  const sync = useStore((s) => s.sync);
  const queue = useStore((s) => s.queue.length);
  const tone = sync.status === "synced" ? "good" : sync.status === "saving" ? "info" : sync.status === "local" ? "neutral" : sync.status === "offline" ? "warn" : "bad";
  const label = sync.status === "local" ? "LOCAL MODE" : sync.status === "offline" ? `OFFLINE · ${queue} queued` : sync.status.toUpperCase();
  return (
    <Badge tone={tone} title={sync.message ?? (sync.status === "local" ? "No database configured: drafts are stored in this browser only." : "Draft state saved to the database")}>
      {label}
    </Badge>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn("rounded-md border px-3 py-2 text-left text-sm shadow-lg", t.kind === "error" ? "border-red-900 bg-red-950 text-red-200" : t.kind === "success" ? "border-green-900 bg-green-950 text-green-200" : "border-line bg-panel2 text-ink")}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const rows = [
    ["/", "Search player to draft"],
    ["Shift + D", "Draft the top recommendation"],
    ["Z", "Undo last pick"],
    ["Y", "Redo"],
    ["G then W / D / P / L / T", "Go to War Room / Decision / Players / Punt Lab / Team"],
    ["?", "Toggle this help"],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-96 rounded-lg border border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h3>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-1 pr-3">
                  <kbd className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-xs">{k}</kbd>
                </td>
                <td className="text-mute">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function useGlobalKeys(setHelp: (f: (x: boolean) => boolean) => void) {
  const dispatch = useStore((s) => s.dispatch);
  useEffect(() => {
    let gPressed = 0;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") setHelp((x) => !x);
      else if (e.key === "z") void dispatch({ type: "undo" });
      else if (e.key === "y") void dispatch({ type: "redo" });
      else if (e.key === "D" && e.shiftKey) {
        const top = useStore.getState().fast.result?.rec.candidates[0];
        if (top) document.dispatchEvent(new CustomEvent("wr:draft-top", { detail: top.id }));
      } else if (e.key === "g") gPressed = Date.now();
      else if (Date.now() - gPressed < 800) {
        const map: Record<string, string> = { w: "/", d: "/decision", p: "/players", l: "/punt-lab", t: "/team", o: "/opponents" };
        if (map[e.key]) window.location.assign(map[e.key]);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [dispatch, setHelp]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const boot = useStore((s) => s.boot);
  const bootError = useStore((s) => s.bootError);
  const init = useStore((s) => s.init);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const select = useStore((s) => s.selectSession);
  const dispatch = useStore((s) => s.dispatch);
  const fastLoading = useStore((s) => s.fast.loading);
  const champ = useStore((s) => s.champ);
  const ai = useStore((s) => s.health?.ai);
  const authConfigured = useStore((s) => s.auth.authConfigured);
  const [help, setHelp] = useState(false);
  useGlobalKeys(setHelp);
  useEffect(() => {
    void init();
  }, [init]);

  if (boot === "loading")
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading player database and draft state…" />
      </div>
    );
  if (boot === "error")
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm">
          <div className="mb-2 font-semibold text-red-300">Could not start</div>
          <div className="text-red-200">{bootError}</div>
          <Button className="mt-3" onClick={() => location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen">
      <AnalysisRunner />
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="flex items-center gap-2 border-b border-line px-3 py-3">
          <Activity className="h-5 w-5 text-accent" />
          <div>
            <div className="text-sm font-bold tracking-tight">9-CAT WAR ROOM</div>
            <div className="text-[10px] text-dim">2026-27 · draft intelligence</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((n) => {
            const activeNav = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("flex items-center gap-2.5 px-3 py-1.5 text-sm", activeNav ? "border-r-2 border-accent bg-panel2 text-ink" : "text-mute hover:text-ink")}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-line p-3 text-[10px] text-dim">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3 w-3" /> AI copilot: {ai === "configured" ? "Claude" : "deterministic"}
          </div>
          <button onClick={() => setHelp(true)} className="hover:text-ink">
            Keyboard shortcuts (?)
          </button>
          {authConfigured && (
            <button
              className="block hover:text-ink"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.assign("/login");
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
          <select value={activeId ?? ""} onChange={(e) => select(e.target.value)} className="h-7 max-w-48 rounded border border-line bg-panel2 px-2 text-xs" aria-label="Draft session">
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.local ? " (local)" : ""}
              </option>
            ))}
          </select>
          <DraftStatus />
          <div className="ml-auto flex items-center gap-2">
            {fastLoading && <Spinner label="updating" />}
            {champ?.running && <Spinner label={`title sims ${champ.done}/${champ.sims}`} />}
            <Button size="sm" variant="ghost" onClick={() => void dispatch({ type: "undo" })} title="Undo (Z)" data-testid="undo">
              ↶ Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void dispatch({ type: "redo" })} title="Redo (Y)" data-testid="redo">
              ↷ Redo
            </Button>
            <SyncBadge />
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded px-2 py-1 text-xs whitespace-nowrap", pathname === n.href ? "bg-panel2 text-ink" : "text-mute")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4">{children}</main>
      </div>
      <Copilot />
      <Toasts />
      <Shortcuts open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
