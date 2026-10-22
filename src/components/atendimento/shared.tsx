import { useMemo, type ReactNode } from "react";
import { AlertTriangle, CircleHelp, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Notice, Tag, type Tone } from "@/components/app/ui-kit";
import { cn } from "@/lib/utils";
import {
  agentWorkload, automatedResolution, buildInsights, byDept, departmentVolumes, dist, fmtInt, hourlyDemand,
  reasonStats, timeSeries, transferStats, type Dist,
} from "@/lib/hyperflow/metrics";
import { useAtendimento } from "./store";

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={80}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Como este número é calculado" className="inline-flex text-muted-foreground/70 hover:text-foreground">
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px] text-xs leading-relaxed">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const TONE_PILL: Record<Tone, string> = {
  good: "bg-success/10 text-success",
  bad: "bg-destructive/10 text-destructive",
  warn: "bg-warning/15 text-warning",
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/10 text-primary",
};

// KPI tile: value, plain-language definition on hover, period comparison and a
// "parcial" flag whenever the extraction behind it is not known to be complete.
export function KpiTile({
  label, hint, value, sub, deltaText, tone = "neutral",
}: {
  label: string; hint: ReactNode; value: string; sub?: string; deltaText?: string; tone?: Tone;
}) {
  const { dataset } = useAtendimento();
  const partial = dataset.completeness !== "complete";
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {label}
          <InfoTip>{hint}</InfoTip>
        </span>
        {partial && <Tag tone="warn" className="px-2 py-0 text-[10px]">{dataset.completeness === "incomplete" ? "parcial" : "não verificado"}</Tag>}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {deltaText && <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", TONE_PILL[tone])}>{deltaText}</span>}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

export function SectionTitle({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// Origin, freshness and volume of what is on screen, always visible.
export function DataStrip() {
  const { dataset, scoped } = useAtendimento();
  if (dataset.sources.length === 0) return null;
  const origin = dataset.sources.map((s) => s.label).join(" + ");
  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-5 py-3 text-xs text-muted-foreground shadow-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="flex items-center gap-1.5">
          {dataset.completeness === "complete" ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-warning" />
          )}
          <strong className="font-medium text-foreground">
            {dataset.completeness === "complete" ? "Extração completa" : dataset.completeness === "incomplete" ? "Extração incompleta" : "Completude não verificável"}
          </strong>
        </span>
        <span><strong className="font-semibold tabular-nums text-foreground">{fmtInt(scoped.operational.length)}</strong> atendimentos no filtro</span>
        <span>Base atualizada em <strong className="font-medium text-foreground">{dataset.loadedAt?.toLocaleString("pt-BR")}</strong></span>
      </div>
      <details className="mt-3 border-t border-border pt-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-primary">Ver origem e qualidade dos registros</summary>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 leading-relaxed">
          <span>Origem: <strong className="font-medium text-foreground">{origin}</strong></span>
          <span>Registros recebidos: <strong className="font-medium tabular-nums text-foreground">{fmtInt(dataset.rawCount)}</strong></span>
          <span>Atendimentos únicos: <strong className="font-medium tabular-nums text-foreground">{fmtInt(dataset.chats.length)}</strong></span>
          <span>Duplicados unidos: <strong className="font-medium tabular-nums text-foreground">{fmtInt(dataset.duplicates)}</strong></span>
          <span>Sem _id: <strong className="font-medium tabular-nums text-foreground">{fmtInt(dataset.invalidNoId)}</strong></span>
        </div>
      </details>
    </div>
  );
}

export function CompletenessBanner() {
  const { dataset } = useAtendimento();
  if (dataset.sources.length === 0 || dataset.completeness === "complete") return null;
  const incomplete = dataset.completeness === "incomplete";
  const reasons = incomplete ? dataset.incompleteReasons : dataset.unknownReasons;
  return (
    <div className="mb-4">
      <Notice tone={incomplete ? "bad" : "warn"}>
        <p className="font-medium text-foreground">
          {incomplete ? "Extração incompleta: nenhum indicador abaixo deve ser lido como total." : "A completude desta base não pode ser verificada."}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {[...new Set(reasons)].slice(0, 6).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Notice>
    </div>
  );
}

export const DEPT_COLORS = ["#0B3A8C", "#2F6BE0", "#8DB4F0", "#64748B", "#A8B3C4"];

// Everything the tabs derive from the filtered rows, computed once per filter change.
export function useDerived() {
  const s = useAtendimento();
  return useMemo(() => {
    const rows = s.scoped.operational;
    const deptCur = departmentVolumes(rows);
    const deptPrev = s.prev.covered ? departmentVolumes(s.prev.rows) : null;
    const reasons = reasonStats(rows, s.granularity);
    const wait = byDept(rows, (r) => r.waitSec, (v) => dist(v as number[])) as { dept: string; value: Dist | null }[];
    const hourly = hourlyDemand(rows);
    const agents = agentWorkload(rows, s.config);
    const insights = buildInsights({
      dataset: s.dataset,
      stats: s.scoped.stats,
      cur: s.kpis,
      prev: s.prev.covered && s.prev.kpis.chats > 0 ? s.prev.kpis : null,
      deptCur,
      deptPrev,
      reasons: reasons.stats,
      classifiedShare: rows.length ? reasons.classified / rows.length : 0,
      waitByDept: wait,
      hourly,
      agents,
      config: s.config,
    });
    return {
      deptCur,
      deptPrev,
      series: timeSeries(rows, s.filters.start, s.filters.end, s.granularity, s.filters.departments),
      reasons,
      wait,
      hourly,
      agents,
      transfers: transferStats(rows),
      resolution: automatedResolution(rows),
      insights,
    };
  }, [s.scoped.operational, s.prev, s.filters.start, s.filters.end, s.filters.departments, s.granularity, s.dataset, s.kpis, s.config, s.scoped.stats]);
}
