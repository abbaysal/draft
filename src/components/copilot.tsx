"use client";
import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { answerDeterministic, buildFacts, type CopilotFacts } from "@/lib/copilot";
import { useEngineContext, useFast, useStrategies } from "@/client/analysis";
import { useStore } from "@/client/store";
import { Badge, Button, cn, Spinner } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  source?: "engine" | "ai";
  model?: string;
}

const QUICK = ["Who should I draft?", "Why?", "Best alternative?", "Should I punt a category?", "Which categories am I weakest in?", "Who will be available at my next pick?", "Upside or consistency?", "How does this change my playoff outlook?", "Should I reach?"];

/** Minimal, safe markdown: **bold**, _italic_, line breaks and "- " bullets. */
function Md({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        const bullet = line.startsWith("- ");
        const body = (bullet ? line.slice(2) : line).split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, j) =>
          part.startsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : part.startsWith("_") && part.endsWith("_") ? <em key={j} className="text-mute">{part.slice(1, -1)}</em> : <span key={j}>{part}</span>,
        );
        return line.trim() === "" ? <div key={i} className="h-1" /> : <div key={i} className={cn(bullet && "pl-3 before:mr-1.5 before:content-['•']")}>{body}</div>;
      })}
    </div>
  );
}

export function Copilot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ctx = useEngineContext();
  const fast = useFast();
  const strat = useStrategies();
  const champ = useStore((s) => s.champ);
  const ai = useStore((s) => s.health?.ai === "configured");

  const facts = (): CopilotFacts | null => {
    if (!ctx || !fast.result || fast.stale) return null;
    return buildFacts(ctx, fast.result.rec, {
      advice: strat.stale ? null : strat.result?.advice,
      strategies: strat.stale ? null : strat.result?.results,
      verdict: champ && !champ.running ? champ.verdict : (champ?.verdict ?? null),
      profiles: fast.result.profiles,
    });
  };

  const ask = async (q: string) => {
    const f = facts();
    if (!f) {
      setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "Analysis is still updating for the latest pick — try again in a moment.", source: "engine" }]);
      return;
    }
    const det = answerDeterministic(q, f);
    const history = msgs.filter((m) => m.source !== "engine").slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: det, source: "engine" }]);
    if (!ai) return;
    setBusy(true);
    try {
      const r = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, facts: f, history }) });
      const data = (await r.json()) as { answer?: string; error?: string; model?: string };
      if (r.ok && data.answer) setMsgs((m) => [...m, { role: "assistant", content: data.answer!, source: "ai", model: data.model }]);
      else if (data.error) setMsgs((m) => [...m, { role: "assistant", content: `_AI unavailable (${data.error}) — engine answer above stands._`, source: "ai" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "_AI request failed — engine answer above stands._", source: "ai" }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-accent/50 bg-panel px-4 py-2 text-sm shadow-xl hover:border-accent" data-testid="copilot-open">
        <MessageSquare className="h-4 w-4 text-accent" /> Copilot
      </button>
    );

  return (
    <div className="fixed top-0 right-0 z-40 flex h-screen w-full max-w-[440px] flex-col border-l border-line bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div>
          <div className="text-sm font-semibold">Draft Copilot</div>
          <div className="text-[10px] text-dim">Explains engine outputs · never invents stats · {ai ? "Claude explanation + engine" : "engine explanations (no AI key configured)"}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close copilot">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {msgs.length === 0 && <div className="text-mute">Ask about the current pick. Answers are computed from the live recommendation, strategy and championship simulations.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={cn("rounded-md px-3 py-2", m.role === "user" ? "ml-8 bg-panel2" : "border border-line")}>
            {m.role === "assistant" && (
              <div className="mb-1">
                <Badge tone={m.source === "ai" ? "info" : "accent"}>{m.source === "ai" ? `AI EXPLANATION${m.model ? ` · ${m.model}` : ""}` : "ENGINE"}</Badge>
              </div>
            )}
            <Md text={m.content} />
          </div>
        ))}
        {busy && <Spinner label="Claude is explaining the numbers…" />}
      </div>
      <div className="space-y-2 border-t border-line p-3">
        <div className="flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button key={q} onClick={() => void ask(q)} className="rounded border border-line px-2 py-0.5 text-[11px] text-mute hover:border-accent hover:text-ink">
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void ask(input.trim());
            setInput("");
          }}
          className="flex gap-2"
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about this pick…" className="h-8 flex-1 rounded-md border border-line bg-bg px-2 text-sm outline-none focus:border-accent" data-testid="copilot-input" />
          <Button variant="primary" type="submit">
            Ask
          </Button>
        </form>
      </div>
    </div>
  );
}
