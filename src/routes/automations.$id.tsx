import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAutomation } from "@/lib/ac.functions";
import { getAutomationRecommendations, type AutomationRecommendation } from "@/lib/ai.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { MetricCard } from "@/components/app/MetricCard";
import { AutomationStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/automations/$id")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AutomationDetailPage />
    </AuthGate>
  ),
});

const CAT_COLORS: Record<string, string> = {
  FLOW: "bg-primary/15 text-primary border-primary/30",
  SEGMENTATION: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  TIMING: "bg-warning/15 text-warning border-warning/30",
  CONTENT: "bg-success/15 text-success border-success/30",
};

const PRI_COLORS: Record<string, string> = {
  P1: "bg-destructive text-destructive-foreground",
  P2: "bg-warning text-warning-foreground",
  P3: "bg-muted text-muted-foreground",
};

function AutomationDetailPage() {
  const { id } = Route.useParams();
  const fetchAutomation = useServerFn(getAutomation);
  const fetchRecs = useServerFn(getAutomationRecommendations);

  const autoQ = useQuery({
    queryKey: ["automation", id],
    queryFn: () => fetchAutomation({ data: { id } }),
  });

  const a = autoQ.data?.automation;

  const recsQ = useQuery({
    queryKey: ["automation-recs", id],
    enabled: !!a,
    queryFn: () =>
      fetchRecs({
        data: {
          automation_id: a!.id,
          name: a!.name,
          status: a!.status,
          entered: a!.entered,
          exited: a!.exited,
          active: a!.active,
          completion_rate: a!.completion_rate,
        },
      }),
  });

  if (autoQ.isLoading || !a) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-[1400px] px-6 py-10">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-surface" />
          <div className="mt-8 grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
            ))}
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (autoQ.isError) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-[1400px] px-6 py-10">
          <p className="text-sm text-destructive">{(autoQ.error as Error).message}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/automations"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{a.name}</h1>
              <AutomationStatusBadge status={a.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>ID {a.id}</span>
              {a.createdate && (
                <>
                  <span>•</span>
                  <span>Criado em {format(new Date(a.createdate), "d 'de' MMM, yyyy", { locale: ptBR })}</span>
                </>
              )}
              {a.mdate && (
                <>
                  <span>•</span>
                  <span>Modificado em {format(new Date(a.mdate), "d 'de' MMM, yyyy", { locale: ptBR })}</span>
                </>
              )}
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/automations">
              <ArrowLeft className="mr-1.5 h-4 w-4" />Automações
            </Link>
          </Button>
        </div>

        {/* Cards de métricas */}
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard
            label="Total de Entradas"
            value={a.entered.toLocaleString("pt-BR")}
            detail="contatos que iniciaram"
          />
          <MetricCard
            label="Ativos Agora"
            value={a.active.toLocaleString("pt-BR")}
            detail="atualmente no fluxo"
          />
          <MetricCard
            label="Total de Saídas"
            value={a.exited.toLocaleString("pt-BR")}
            detail="concluídos ou removidos"
          />
          <MetricCard
            label="Taxa de Conclusão"
            value={`${a.completion_rate.toFixed(1)}%`}
            detail={`${a.exited.toLocaleString("pt-BR")} / ${a.entered.toLocaleString("pt-BR")}`}
            variance={a.completion_rate - 50}
          />
        </div>

        {/* Funil de contatos */}
        {a.entered > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold">Funil de Contatos</h3>
            <div className="space-y-3">
              <FunnelBar label="Entraram" value={a.entered} max={a.entered} color="bg-primary" />
              <FunnelBar label="Ativos" value={a.active} max={a.entered} color="bg-chart-4" />
              <FunnelBar label="Saíram" value={a.exited} max={a.entered} color="bg-success" />
            </div>
          </div>
        )}

        {/* Recomendações de IA */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Recomendações de Melhoria por IA</h2>
          </div>
          {recsQ.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />
              ))}
            </div>
          ) : recsQ.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
              {(recsQ.error as Error).message}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(recsQ.data?.recommendations ?? []).map((r: AutomationRecommendation, idx: number) => (
                <div key={idx} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", PRI_COLORS[r.priority] ?? PRI_COLORS.P3)}>
                      {r.priority}
                    </span>
                    <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-medium tracking-wider", CAT_COLORS[r.category] ?? "bg-muted text-muted-foreground border-border")}>
                      {r.category}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{r.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-muted-foreground">{label}</div>
      <div className="flex-1 overflow-hidden rounded-full bg-surface">
        <div className={cn("h-2 rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-28 text-right font-mono text-xs tabular-nums">
        {value.toLocaleString("pt-BR")} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span>
      </div>
    </div>
  );
}
