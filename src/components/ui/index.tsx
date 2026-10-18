"use client";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

export function Panel({ title, right, children, className, bodyClass }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel", className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-mute uppercase">{title}</h2>
          <div className="flex items-center gap-2 text-xs">{right}</div>
        </header>
      )}
      <div className={cn("p-3", bodyClass)}>{children}</div>
    </section>
  );
}

export function Button({ variant = "default", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "border-accent bg-accent text-black hover:bg-amber-400",
        variant === "default" && "border-line bg-panel2 text-ink hover:border-dim",
        variant === "ghost" && "border-transparent bg-transparent text-mute hover:text-ink",
        variant === "danger" && "border-red-900 bg-red-950/50 text-red-300 hover:bg-red-900/50",
        className,
      )}
    />
  );
}

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "accent" | "info"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap",
        tone === "neutral" && "bg-panel2 text-mute",
        tone === "good" && "bg-green-950 text-green-300",
        tone === "bad" && "bg-red-950 text-red-300",
        tone === "warn" && "bg-yellow-950 text-yellow-300",
        tone === "accent" && "bg-amber-950 text-amber-300",
        tone === "info" && "bg-sky-950 text-sky-300",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "accent" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] tracking-wider text-dim uppercase">{label}</div>
      <div className={cn("num text-lg leading-tight font-semibold", tone === "good" && "text-good", tone === "bad" && "text-bad", tone === "accent" && "text-accent")}>{value}</div>
      {sub && <div className="truncate text-[11px] text-mute">{sub}</div>}
    </div>
  );
}

/** Horizontal probability bar (0..1) centred on 50%. */
export function ProbBar({ p, width = 64 }: { p: number; width?: number }) {
  const pct = Math.max(0, Math.min(1, p));
  const color = pct >= 0.6 ? "bg-good" : pct >= 0.45 ? "bg-warn" : "bg-bad";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-block h-1.5 rounded bg-line" style={{ width }}>
        <span className={cn("absolute top-0 left-0 h-1.5 rounded", color)} style={{ width: `${pct * 100}%` }} />
        <span className="absolute top-[-2px] h-2.5 w-px bg-dim" style={{ left: "50%" }} />
      </span>
      <span className="num text-[11px] text-mute">{(pct * 100).toFixed(0)}%</span>
    </span>
  );
}

export function Delta({ v, digits = 3, pct = false }: { v: number; digits?: number; pct?: boolean }) {
  const s = pct ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}` : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
  return <span className={cn("num", v > 1e-9 ? "text-good" : v < -1e-9 ? "text-bad" : "text-mute")}>{s}</span>;
}

/** z-score cell with heat colouring. */
export function ZCell({ z }: { z: number }) {
  const a = Math.min(1, Math.abs(z) / 2.5);
  const bg = z >= 0 ? `rgba(34,197,94,${a * 0.35})` : `rgba(239,68,68,${a * 0.35})`;
  return (
    <td className="num px-1.5 py-1 text-right text-[12px]" style={{ background: bg }}>
      {z.toFixed(1)}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-sm text-mute">{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mute">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cn("rounded px-2.5 py-1 text-xs", value === o.value ? "bg-line text-ink" : "text-mute hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-mute">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-dim">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-8 rounded-md border border-line bg-bg px-2 text-sm text-ink outline-none focus:border-accent";
