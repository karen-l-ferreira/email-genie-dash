import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns, listAutomations, type Campaign } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Download,
  GitBranch,
  Mail,
  MousePointerClick,
  Settings as SettingsIcon,
  TrendingUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, subMonths, subYears } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: () => (
    <AuthGate>
      <DashboardPage />
    </AuthGate>
  ),
});

type Period = "30d" | "90d" | "6m" | "1y" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "6m", label: "6 meses" },
  { key: "1y", label: "1 ano" },
  { key: "all", label: "Tudo" },
];

function periodStart(p: Period): Date | null {
  const now = new Date();
  if (p === "30d") return subDays(now, 30);
  if (p === "90d") return subDays(now, 90);
  if (p === "6m") return subMonths(now, 6);
  if (p === "1y") return subYears(now, 1);
  return null;
}

function exportCampaignsCSV(campaigns: Campaign[]) {
  const header = ["Nome", "Data", "Envios", "T. Abertura %", "CTR %", "Score", "Bounces", "Descadastros"];
  const rows = campaigns.map((c) => [
    `"${c.name.replace(/"/g, '""')}"`,
    c.sdate ? format(new Date(c.sdate), "dd/MM/yyyy") : "",
    c.send_amt,
    c.open_rate.toFixed(2),
    c.ctr.toFixed(2),
    c.score,
    c.hardbounces + c.softbounces,
    c.unsubscribes,
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campanhas_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DashboardPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);
  const fetchAutomations = useServerFn(listAutomations);
  const [period, setPeriod] = useState<Period>("all");

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", 0],
    queryFn: () => fetchCampaigns({ data: { offset: 0 } }),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });
  const automationsQ = useQuery({
    queryKey: ["automations"],
    queryFn: () => fetchAutomations(),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  useEffect(() => {
    if (settingsQ.data && !settingsQ.data.hasApiKey) navigate({ to: "/settings" });
  }, [settingsQ.data, navigate]);

  const allCampaigns = campaignsQ.data?.campaigns ?? [];
  const automations = automationsQ.data?.automations ?? [];
  const activeAutos = automations.filter((a) => a.status === "active");

  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;

  const filtered = useMemo(() => {
    const cutoff = periodStart(period);
    if (!cutoff) return allCampaigns;
    return allCampaigns.filter((c) => {
      const dateStr = c.sdate ?? c.ldate;
      if (!dateStr) return false;
      const d = new Date(dateStr.replace(" ", "T"));
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }, [allCampaigns, period]);

  const sent = filtered.filter((c) => c.send_amt > 0);
  const allSent = allCampaigns.filter((c) => c.send_amt > 0);

  const avgOpenRate = sent.length ? sent.reduce((s, c) => s + c.open_rate, 0) / sent.length : 0;
  const avgCTR = sent.length ? sent.reduce((s, c) => s + c.ctr, 0) / sent.length : 0;
  const avgScore = sent.length ? sent.reduce((s, c) => s + c.score, 0) / sent.length : 0;

  // Automation KPIs
  const totalEntered = automations.reduce((s, a) => s + a.entered, 0);
  const avgCompletion = automations.length
    ? automations.reduce((s, a) => s + a.completion_rate, 0) / automations.length
    : 0;

  const topCampaigns = useMemo(
    () => [...sent].sort((a, b) => b.score - a.score).slice(0, 5),
    [sent],
  );

  // Campaigns significantly below benchmark
  const belowBench = useMemo(
    () =>
      allSent
        .filter((c) => c.open_rate < benchOR * 0.6 || c.ctr < benchCTR * 0.5)
        .sort((a, b) => a.open_rate - b.open_rate)
        .slice(0, 5),
    [allSent, benchOR, benchCTR],
  );

  const isLoading = settingsQ.isLoading || campaignsQ.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">

        {/* Page header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Visão geral</p>
            <h1 className="text-lg font-bold">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    period === p.key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {allSent.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => exportCampaignsCSV(allSent)}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar
              </Button>
            )}
          </div>
        </div>

        {campaignsQ.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
            <p className="text-sm text-destructive">{(campaignsQ.error as Error).message}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/settings">
                <SettingsIcon className="mr-1.5 h-4 w-4" />Verificar chave de API
              </Link>
            </Button>
          </div>
        ) : (
          <>
            {/* KPI row */}
            {isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  icon={<Mail className="h-3.5 w-3.5" />}
                  label="Campanhas enviadas"
                  value={sent.length.toLocaleString("pt-BR")}
                  sub={period !== "all" ? `de ${allSent.length} no total` : `${allCampaigns.length - allSent.length} rascunhos`}
                />
                <KpiCard
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label="Taxa de abertura"
                  value={`${avgOpenRate.toFixed(1)}%`}
                  sub={`meta ${benchOR}%`}
                  good={sent.length > 0 ? avgOpenRate >= benchOR : undefined}
                />
                <KpiCard
                  icon={<MousePointerClick className="h-3.5 w-3.5" />}
                  label="CTR médio"
                  value={`${avgCTR.toFixed(2)}%`}
                  sub={`meta ${benchCTR}%`}
                  good={sent.length > 0 ? avgCTR >= benchCTR : undefined}
                />
                <KpiCard
                  icon={<Zap className="h-3.5 w-3.5" />}
                  label="Automações ativas"
                  value={automationsQ.isLoading ? "—" : activeAutos.length.toLocaleString("pt-BR")}
                  sub={automationsQ.isLoading ? "" : `de ${automations.length} no total`}
                  good={!automationsQ.isLoading && automations.length > 0 ? activeAutos.length > 0 : undefined}
                />
              </div>
            )}

            {/* Below-benchmark alert */}
            {belowBench.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    {belowBench.length} campanha{belowBench.length > 1 ? "s" : ""} abaixo do esperado
                  </span>
                </div>
                <div className="space-y-1.5">
                  {belowBench.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                      className="flex w-full items-center justify-between rounded-md border border-amber-500/10 bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
                    >
                      <span className="truncate text-sm">{c.name}</span>
                      <div className="ml-4 flex shrink-0 items-center gap-3 font-mono text-xs text-muted-foreground">
                        <span>{c.open_rate.toFixed(1)}% ab.</span>
                        <span>{c.ctr.toFixed(2)}% CTR</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Main content: top campaigns table + sidebar */}
            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_260px]">

              {/* Top campaigns */}
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                  <h2 className="text-sm font-medium">Melhores campanhas</h2>
                  <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                    <Link to="/campanhas">
                      Ver todas <ChevronRight className="ml-0.5 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
                {isLoading ? (
                  <div className="space-y-2 p-4">
                    {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}
                  </div>
                ) : topCampaigns.length === 0 ? (
                  <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                    Nenhuma campanha enviada no período.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left font-medium">Campanha</th>
                        <th className="px-4 py-2.5 text-right font-medium">Abertura</th>
                        <th className="px-4 py-2.5 text-right font-medium">CTR</th>
                        <th className="px-4 py-2.5 text-right font-medium">Score</th>
                        <th className="w-8 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {topCampaigns.map((c, i) => (
                        <tr
                          key={c.id}
                          onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/30",
                            i !== 0 && "border-t border-border",
                          )}
                        >
                          <td className="px-5 py-3">
                            <div className="max-w-[280px] truncate font-medium">{c.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {c.sdate ? format(new Date(c.sdate), "d MMM yyyy", { locale: ptBR }) : "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={cn("font-mono text-xs tabular-nums", c.open_rate >= benchOR ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                              {c.open_rate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={cn("font-mono text-xs tabular-nums", c.ctr >= benchCTR ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                              {c.ctr.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ScorePill score={c.score} />
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Sidebar quick links */}
              <div className="space-y-3">
                <QuickCard
                  icon={<BarChart3 className="h-4 w-4 text-primary" />}
                  title="Fluxos"
                  description={
                    isLoading
                      ? "Carregando…"
                      : `${allSent.length} campanhas · ${activeAutos.length} automações ativas`
                  }
                  to="/campanhas"
                />
                <QuickCard
                  icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
                  title="Alertas"
                  description="Clientes para acionar"
                  to="/alertas"
                />
                <QuickCard
                  icon={<SettingsIcon className="h-4 w-4 text-muted-foreground" />}
                  title="Configurações"
                  description="API key e benchmarks"
                  to="/settings"
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, good }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  good?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg border border-border bg-card px-5 py-4 border-l-[3px]",
      good === true  ? "border-l-success"
      : good === false ? "border-l-destructive"
      : "border-l-primary",
    )}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={cn(
        "mt-2.5 text-2xl font-bold tabular-nums",
        good === true ? "text-success"
        : good === false ? "text-destructive"
        : "text-foreground",
      )}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className={cn(
      "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
      score >= 70 ? "bg-success/15 text-success" : score >= 40 ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive",
    )}>
      {score}
    </span>
  );
}

function QuickCard({ icon, title, description, to }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:bg-muted/30">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
