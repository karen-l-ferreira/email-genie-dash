import type { ComponentType, ReactNode } from "react";
import { Info, Lightbulb } from "lucide-react";
import { AppHeader } from "@/components/app/Header";
import { cn } from "@/lib/utils";

// Shared building blocks so every screen looks like the same product.

export function PageShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <main className={cn("mx-auto px-8 py-8", wide ? "max-w-[1560px]" : "max-w-[1320px]")}>{children}</main>
    </div>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-card", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-6"}>{children}</div>
    </section>
  );
}

export type Tone = "good" | "bad" | "warn" | "neutral" | "brand";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-success",
  bad: "text-destructive",
  warn: "text-warning",
  neutral: "text-muted-foreground",
  brand: "text-primary",
};

const TONE_PILL: Record<Tone, string> = {
  good: "bg-success/10 text-success",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/10 text-primary",
};

export function Tag({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        TONE_PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  delta,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  tone?: Tone;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/60" />}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {delta && <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", TONE_PILL[tone])}>{delta}</span>}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

export function toneText(t: Tone) {
  return TONE_TEXT[t];
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-all",
            size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <nav className="-mb-px flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            "border-b-2 px-4 py-3 text-sm transition-colors",
            value === t.value
              ? "border-primary font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "info"; children: ReactNode }) {
  const cls =
    tone === "bad"
      ? "border-destructive/25 bg-destructive/5 text-destructive"
      : tone === "info"
        ? "border-primary/20 bg-primary/5 text-foreground"
        : "border-warning/30 bg-warning/10 text-foreground";
  return <div className={cn("rounded-lg border px-4 py-3 text-sm leading-relaxed", cls)}>{children}</div>;
}

// Opens every analysis tab: what it is, in plain words, before any number appears.
export function Explainer({ title = "O que é esta tela", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-primary/15 bg-primary/5 px-5 py-4">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <p className="text-sm font-semibold text-primary">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-foreground/85">{children}</div>
      </div>
    </div>
  );
}

// "O que fazer": the sentence you can repeat in a meeting.
export function Advice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <Lightbulb className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_TEXT[tone === "neutral" ? "warn" : tone])} />
      <span>
        <span className="font-medium text-foreground">O que fazer: </span>
        {children}
      </span>
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export const selectClass =
  "h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
