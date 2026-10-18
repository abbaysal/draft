"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="w-80 space-y-3 rounded-lg border border-line bg-panel p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
        setBusy(false);
        if (r.ok) location.assign(params.get("next") || "/");
        else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Login failed");
      }}
    >
      <div>
        <div className="text-sm font-bold tracking-tight">9-CAT WAR ROOM</div>
        <div className="text-xs text-mute">Private draft workspace — enter the app password.</div>
      </div>
      <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="h-9 w-full rounded-md border border-line bg-bg px-2 text-sm outline-none focus:border-accent" placeholder="Password" aria-label="Password" />
      {err && <div className="text-xs text-red-400">{err}</div>}
      <button disabled={busy || !pw} className="h-9 w-full rounded-md bg-accent text-sm font-semibold text-black disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
