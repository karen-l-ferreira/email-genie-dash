import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns } from "@/lib/ac.functions";
import { listAutomations } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronRight, GitBranch, Mail, Settings as SettingsIcon, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: () => (
    <AuthGate>
      <DashboardPage />
    </AuthGate>
  ),
});

function DashboardPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);
  const fetchAutomations = useServerFn(listAutomations);

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
    if (settingsQ.data && !settingsQ.data.hasApiKey) {
      navigate({ to: "/settings" });
    }
  }, [settingsQ.data, navigate]);

  const campaigns = campaignsQ.data?.campaigns ?? [];
  const sent = campaigns.filter((c) => c.send_amt > 0);
  const automations = automationsQ.data?.automations ?? [];
  const activeAutos = automations.filter((a) => a.status === "active");

  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;

  const avgOpenRate = sent.length
    ? sent.reduce((s, c) => s + c.open_rate, 0) / sent.length
    : 0;
  const avgCTR = sent.length
    ? sent.reduce((s, c) => s + c.ctr, 0) / sent.length
    : 0;
  const avgScore = sent.length
    ? sent.reduce((s, c) => s + c.score, 0) / sent.length
    : 0;

  const topCampaigns = useMemo(() => {
    return [...sent]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [sent]);

  const isLoading = settingsQ.isLoading || campaignsQ.isLoading;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Visão geral das suas campanhas e automações no ActiveCampaign.</p>
        </div>

        {/* KPI Cards */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}
          </div>
        ) : campaignsQ.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
            <p className="text-sm text-destructive">{(campaignsQ.error as Error).message}</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/settings"><SettingsIcon className="mr-1.5 h-4 w-4" />Verificar chave de API</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<Mail className="h-4 w-4 text-primary" />}
              label="Campanhas enviadas"
              value={sent.length.toLocaleString("pt-BR")}
              sub={`${campaigns.length} no total`}
            />
            <KpiCard
              icon={<TrendingUp className="h-4 w-4 text-primary" />}
              label="Média de abertura"
              value={`${avgOpenRate.toFixed(1)}%`}
              sub={`benchmark ${benchOR}%`}
              good={avgOpenRate >= benchOR}
            />
            <KpiCard
              icon={<BarChart3 className="h-4 w-4 text-primary" />}
              label="Média de CTR"
              value={`${avgCTR.toFixed(2)}%`}
              sub={`benchmark ${benchCTR}%`}
              good={avgCTR >= benchCTR}
            />
            <KpiCard
              icon={<Sparkles className="h-4 w-4 text-primary" />}
              label="Score médio (IA)"
              value={`${avgScore.toFixed(0)}/100`}
              sub={avgScore >= 70 ? "Bom desempenho" : avgScore >= 40 ? "Moderado" : "Precisa atenção"}
              good={avgScore >= 70}
            />
          </div>
        )}

        {/* Quick access + Top campaigns */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Top campaigns */}
          <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold">Top campanhas por pontuação</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/campanhas">Ver todas <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link>
              </Button>
            </div>
            {isLoading ? (
              <div className="p-5 space-y-3">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface" />)}
              </div>
            ) : topCampaigns.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhuma campanha enviada ainda.</div>
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
                        <div className="font-medium truncate max-w-[260px]">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
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

          {/* Quick access sidebar */}
          <div className="space-y-4">
            <QuickCard
              icon={<Mail className="h-5 w-5 text-primary" />}
              title="Campanhas"
              description={`${sent.length} enviadas • ${campaigns.length - sent.length} rascunhos`}
              to="/campanhas"
              isLoading={isLoading}
            />
            <QuickCard
              icon={<GitBranch className="h-5 w-5 text-primary" />}
              title="Automações"
              description={automationsQ.isLoading ? "Carregando…" : `${activeAutos.length} ativas • ${automations.length} no total`}
              to="/automations"
              isLoading={automationsQ.isLoading}
            />
            <QuickCard
              icon={<SettingsIcon className="h-5 w-5 text-muted-foreground" />}
              title="Configurações"
              description="API key, URL base e benchmarks"
              to="/settings"
            />
          </div>
        </div>
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

function QuickCard({ icon, title, description, to, isLoading }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  to: string;
  isLoading?: boolean;
}) {
  return (
    <Link to={to} className="block rounded-xl border border-border bg-card p-5 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{title}</div>
          <div className={cn("mt-0.5 text-xs text-muted-foreground", isLoading && "animate-pulse")}>
            {description}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      </div>
    </Link>
  );
}
