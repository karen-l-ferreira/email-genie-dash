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
  Settings as SettingsIcon,
  Sparkles,
  TrendingUp,
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
        {/* Header row */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Visão geral das campanhas e automações no ActiveCampaign.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Period filter */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    period === p.key
                      ? "bg-primary text-primary-foreground"
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
                Exportar CSV
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
            {/* Campaign KPIs */}
            <div className="mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Campanhas</p>
            </div>
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  icon={<Mail className="h-4 w-4 text-primary" />}
                  label="Enviadas"
                  value={sent.length.toLocaleString("pt-BR")}
                  sub={period !== "all" ? `de ${allSent.length} no total` : `${allCampaigns.length - allSent.length} rascunhos`}
                />
                <KpiCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  label="Média de abertura"
                  value={`${avgOpenRate.toFixed(1)}%`}
                  sub={`benchmark ${benchOR}%`}
                  good={sent.length > 0 ? avgOpenRate >= benchOR : undefined}
                />
                <KpiCard
                  icon={<BarChart3 className="h-4 w-4 text-primary" />}
                  label="Média de CTR"
                  value={`${avgCTR.toFixed(2)}%`}
                  sub={`benchmark ${benchCTR}%`}
                  good={sent.length > 0 ? avgCTR >= benchCTR : undefined}
                />
                <KpiCard
                  icon={<Sparkles className="h-4 w-4 text-primary" />}
                  label="Score médio (IA)"
                  value={sent.length ? `${avgScore.toFixed(0)}/100` : "—"}
                  sub={avgScore >= 70 ? "Bom desempenho" : avgScore >= 40 ? "Moderado" : sent.length ? "Precisa atenção" : "Sem dados"}
                  good={sent.length > 0 ? avgScore >= 70 : undefined}
                />
              </div>
            )}

            {/* Automation KPIs */}
            <div className="mt-6 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Automações</p>
            </div>
            {automationsQ.isLoading ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <KpiCard
                  icon={<GitBranch className="h-4 w-4 text-primary" />}
                  label="Automações ativas"
                  value={activeAutos.length.toLocaleString("pt-BR")}
                  sub={`de ${automations.length} no total`}
                  good={activeAutos.length > 0 ? true : undefined}
                />
                <KpiCard
                  icon={<TrendingUp className="h-4 w-4 text-primary" />}
                  label="Total de entradas"
                  value={totalEntered.toLocaleString("pt-BR")}
                  sub="contatos que iniciaram fluxos"
                />
                <KpiCard
                  icon={<BarChart3 className="h-4 w-4 text-primary" />}
                  label="Conclusão média"
                  value={automations.length ? `${avgCompletion.toFixed(1)}%` : "—"}
                  sub="taxa de saída dos fluxos"
                  good={automations.length > 0 ? avgCompletion >= 50 : undefined}
                />
              </div>
            )}

            {/* Below-benchmark alert */}
            {belowBench.length > 0 && (
              <div className="mt-6 rounded-xl border border-warning/30 bg-warning/5 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-semibold text-warning">
                    {belowBench.length} campanha{belowBench.length > 1 ? "s" : ""} com performance crítica
                  </span>
                </div>
                <div className="space-y-2">
                  {belowBench.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                      className="flex w-full items-center justify-between rounded-lg border border-warning/20 bg-warning/5 px-4 py-2.5 text-left transition-colors hover:bg-warning/10"
                    >
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <div className="ml-4 flex shrink-0 gap-4 font-mono text-xs">
                        <span className="text-destructive">{c.open_rate.toFixed(1)}% ab.</span>
                        <span className="text-destructive">{c.ctr.toFixed(2)}% CTR</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom grid: top campaigns + quick access */}
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-sm font-semibold">Top campanhas por pontuação</h2>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/campanhas">
                      Ver todas <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
                {isLoading ? (
                  <div className="space-y-3 p-5">
                    {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface" />)}
                  </div>
                ) : topCampaigns.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma campanha enviada no período selecionado.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2 text-left font-medium">Campanha</th>
                        <th className="px-3 py-2 text-right font-medium">Abertura</th>
                        <th className="px-3 py-2 text-right font-medium">CTR</th>
                        <th className="px-3 py-2 text-right font-medium">Score</th>
                        <th className="w-8 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {topCampaigns.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                          className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                        >
                          <td className="px-5 py-3">
                            <div className="max-w-[260px] truncate font-medium">{c.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {c.sdate ? format(new Date(c.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={cn("font-mono text-xs tabular-nums", c.open_rate >= benchOR ? "text-success" : "text-destructive")}>
                              {c.open_rate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={cn("font-mono text-xs tabular-nums", c.ctr >= benchCTR ? "text-success" : "text-destructive")}>
                              {c.ctr.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
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

              <div className="space-y-4">
                <QuickCard
                  icon={<Mail className="h-5 w-5 text-primary" />}
                  title="Campanhas"
                  description={isLoading ? "Carregando…" : `${allSent.length} enviadas • ${allCampaigns.length - allSent.length} rascunhos`}
                  to="/campanhas"
                />
                <QuickCard
                  icon={<GitBranch className="h-5 w-5 text-primary" />}
                  title="Automações"
                  description={automationsQ.isLoading ? "Carregando…" : `${activeAutos.length} ativas • ${automations.length} no total`}
                  to="/automations"
                />
                <QuickCard
                  icon={<SettingsIcon className="h-5 w-5 text-muted-foreground" />}
                  title="Configurações"
                  description="API key, URL base e benchmarks"
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn(
        "mt-2 font-mono text-3xl font-semibold",
        good === true ? "text-success" : good === false ? "text-destructive" : "text-foreground",
      )}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
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
    <Link to={to} className="block rounded-xl border border-border bg-card p-5 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
