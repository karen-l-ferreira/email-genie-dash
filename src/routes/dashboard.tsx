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

  AlertTriangle, BarChart3, ChevronRight, Download,

  Mail, MousePointerClick, Settings as SettingsIcon, TrendingUp, Zap, ArrowUpRight,

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

    c.send_amt, c.open_rate.toFixed(2), c.ctr.toFixed(2),

    c.score, c.hardbounces + c.softbounces, c.unsubscribes,

  ]);

  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a"); a.href = url;

  a.download = `campanhas_${format(new Date(), "yyyy-MM-dd")}.csv`;

  a.click(); URL.revokeObjectURL(url);

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

    enabled: !!settingsQ.data?.hasApiKey, retry: false,

  });

  const automationsQ = useQuery({

    queryKey: ["automations"],

    queryFn: () => fetchAutomations(),

    enabled: !!settingsQ.data?.hasApiKey, retry: false,

  });



  useEffect(() => {

    if (settingsQ.data && !settingsQ.data.hasApiKey) navigate({ to: "/settings" });

  }, [settingsQ.data, navigate]);



  const allCampaigns = campaignsQ.data?.campaigns ?? [];

  const automations = automationsQ.data?.automations ?? [];

  const activeAutos = automations.filter((a) => a.status === "active");

  const benchOR  = settingsQ.data?.benchmark_open_rate ?? 22;

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



  const sent    = filtered.filter((c) => c.send_amt > 0);

  const allSent = allCampaigns.filter((c) => c.send_amt > 0);



  const avgOpenRate = sent.length ? sent.reduce((s, c) => s + c.open_rate, 0) / sent.length : 0;

  const avgCTR      = sent.length ? sent.reduce((s, c) => s + c.ctr, 0) / sent.length : 0;

  const avgScore    = sent.length ? sent.reduce((s, c) => s + c.score, 0) / sent.length : 0;



  const topCampaigns = useMemo(

    () => [...sent].sort((a, b) => b.score - a.score).slice(0, 5),

    [sent],

  );

  const belowBench = useMemo(

    () => allSent.filter((c) => c.open_rate < benchOR * 0.6 || c.ctr < benchCTR * 0.5)

      .sort((a, b) => a.open_rate - b.open_rate).slice(0, 5),

    [allSent, benchOR, benchCTR],

  );



  const isLoading = settingsQ.isLoading || campaignsQ.isLoading;

  const today = format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR });



  return (

    <div className="min-h-screen bg-background pl-[220px]">

      <AppHeader />



      <main className="mx-auto max-w-[1400px] px-6 py-8">



        {/* Page header */}

        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">

          <div>

            <p className="text-xs font-medium text-muted-foreground capitalize">{today}</p>

            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">Visão geral</h1>

          </div>

          <div className="flex items-center gap-2">

            {/* Period selector */}

            <div className="flex items-center gap-0.5 rounded border border-border bg-card p-0.5">

              {PERIODS.map((p) => (

                <button

                  key={p.key}

                  onClick={() => setPeriod(p.key)}

                  className={cn(

                    "rounded px-3 py-1.5 text-xs font-medium transition-all",

                    period === p.key

                      ? "bg-primary text-white shadow-sm"

                      : "text-muted-foreground hover:text-foreground",

                  )}

                >{p.label}</button>

              ))}

            </div>

            {allSent.length > 0 && (

              <Button variant="outline" size="sm" onClick={() => exportCampaignsCSV(allSent)}>

                <Download className="mr-1.5 h-3.5 w-3.5" />Exportar

              </Button>

            )}

          </div>

        </div>



        {campaignsQ.isError ? (

          <div className="rounded border border-destructive/30 bg-destructive/5 p-6">

            <p className="text-sm text-destructive">{(campaignsQ.error as Error).message}</p>

            <Button asChild variant="outline" size="sm" className="mt-3">

              <Link to="/settings"><SettingsIcon className="mr-1.5 h-4 w-4" />Verificar chave de API</Link>

            </Button>

          </div>

        ) : (

          <>

            {/* KPIs */}

            {isLoading ? (

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

                {[0,1,2,3].map((i) => <div key={i} className="h-28 animate-pulse rounded bg-muted" />)}

              </div>

            ) : (

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

                <KpiCard

                  icon={<Mail className="h-4 w-4" />}

                  label="Campanhas enviadas"

                  value={sent.length.toLocaleString("pt-BR")}

                  sub={period !== "all" ? `de ${allSent.length} no total` : `${allCampaigns.length - allSent.length} rascunhos`}

                  accent="#0660FE"

                />

                <KpiCard

                  icon={<TrendingUp className="h-4 w-4" />}

                  label="Taxa de abertura"

                  value={`${avgOpenRate.toFixed(1)}%`}

                  sub={`benchmark ${benchOR}%`}

                  good={sent.length > 0 ? avgOpenRate >= benchOR : undefined}

                  bar={sent.length > 0 ? { value: avgOpenRate, max: Math.max(avgOpenRate, benchOR) * 1.2, bench: benchOR } : undefined}

                  accent="#0660FE"

                />

                <KpiCard

                  icon={<MousePointerClick className="h-4 w-4" />}

                  label="CTR medio"

                  value={`${avgCTR.toFixed(2)}%`}

                  sub={`benchmark ${benchCTR}%`}

                  good={sent.length > 0 ? avgCTR >= benchCTR : undefined}

                  bar={sent.length > 0 ? { value: avgCTR, max: Math.max(avgCTR, benchCTR) * 1.2, bench: benchCTR } : undefined}

                  accent="#0660FE"

                />

                <KpiCard

                  icon={<Zap className="h-4 w-4" />}

                  label="Automacoes ativas"

                  value={automationsQ.isLoading ? "—" : activeAutos.length.toLocaleString("pt-BR")}

                  sub={automationsQ.isLoading ? "" : `de ${automations.length} automações`}

                  good={!automationsQ.isLoading && automations.length > 0 ? activeAutos.length > 0 : undefined}

                  accent="#0660FE"

                />

              </div>

            )}



            {/* Alert banner */}

            {belowBench.length > 0 && (

              <div className="mt-4 flex items-start gap-3 rounded border-l-4 border-amber-400 bg-amber-50 px-4 py-3 dark:bg-amber-400/5">

                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />

                <div className="flex-1 min-w-0">

                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">

                    {belowBench.length} campanha{belowBench.length > 1 ? "s" : ""} abaixo do esperado

                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">

                    {belowBench.map((c) => (

                      <button

                        key={c.id}

                        onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}

                        className="flex items-center gap-2 rounded border border-amber-200 bg-white px-2.5 py-1 text-xs text-amber-800 transition-colors hover:bg-amber-50 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-300"

                      >

                        <span className="max-w-[180px] truncate">{c.name}</span>

                        <span className="font-mono text-[10px] opacity-70">{c.open_rate.toFixed(1)}% ab.</span>

                        <ChevronRight className="h-3 w-3 opacity-50" />

                      </button>

                    ))}

                  </div>

                </div>

              </div>

            )}



            {/* Main grid */}

            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_240px]">



              {/* Top campaigns */}

              <div className="overflow-hidden rounded border border-border bg-card">

                <div className="flex items-center justify-between border-b border-border px-5 py-3.5">

                  <div>

                    <h2 className="text-sm font-semibold text-foreground">Melhores campanhas</h2>

                    <p className="text-[11px] text-muted-foreground">por score no periodo</p>

                  </div>

                  <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs text-primary hover:text-primary">

                    <Link to="/campanhas">Ver todas <ArrowUpRight className="h-3 w-3" /></Link>

                  </Button>

                </div>



                {isLoading ? (

                  <div className="space-y-px p-0">

                    {[0,1,2,3,4].map((i) => <div key={i} className="h-14 animate-pulse bg-muted/40" />)}

                  </div>

                ) : topCampaigns.length === 0 ? (

                  <div className="py-16 text-center text-sm text-muted-foreground">

                    Nenhuma campanha enviada no periodo selecionado.

                  </div>

                ) : (

                  <table className="w-full text-sm">

                    <thead>

                      <tr className="border-b border-border bg-surface text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">

                        <th className="px-5 py-2.5 text-left">#</th>

                        <th className="px-3 py-2.5 text-left">Campanha</th>

                        <th className="px-3 py-2.5 text-right">Abertura</th>

                        <th className="px-3 py-2.5 text-right">CTR</th>

                        <th className="px-4 py-2.5 text-right">Score</th>

                        <th className="w-6 px-3 py-2.5" />

                      </tr>

                    </thead>

                    <tbody>

                      {topCampaigns.map((c, i) => (

                        <tr

                          key={c.id}

                          onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}

                          className={cn(

                            "group cursor-pointer border-t border-border transition-colors hover:bg-surface",

                            i === 0 && "bg-primary/[0.03]",

                          )}

                        >

                          <td className="px-5 py-3.5">

                            <span className={cn(

                              "flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold",

                              i === 0 ? "bg-primary text-white" : "bg-surface text-muted-foreground"

                            )}>{i + 1}</span>

                          </td>

                          <td className="px-3 py-3.5">

                            <div className="max-w-[260px] truncate font-medium text-foreground">{c.name}</div>

                            <div className="font-mono text-[10px] text-muted-foreground">

                              {c.sdate ? format(new Date(c.sdate), "d MMM yyyy", { locale: ptBR }) : "—"}

                              {" · "}{c.send_amt.toLocaleString("pt-BR")} envios

                            </div>

                          </td>

                          <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums">

                            <span className={cn(c.open_rate >= benchOR ? "text-success font-semibold" : "text-destructive")}>

                              {c.open_rate.toFixed(1)}%

                            </span>

                          </td>

                          <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums">

                            <span className={cn(c.ctr >= benchCTR ? "text-success font-semibold" : "text-destructive")}>

                              {c.ctr.toFixed(2)}%

                            </span>

                          </td>

                          <td className="px-4 py-3.5 text-right">

                            <ScoreBar score={c.score} />

                          </td>

                          <td className="px-3 py-3.5">

                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                )}

              </div>



              {/* Sidebar */}

              <div className="flex flex-col gap-3">

                <NavCard

                  icon={<BarChart3 className="h-4 w-4" />}

                  label="Fluxos"

                  description={isLoading ? "Carregando..." : `${allSent.length} campanhas · ${activeAutos.length} automações`}

                  to="/campanhas"

                  color="#0660FE"

                />

                <NavCard

                  icon={<TrendingUp className="h-4 w-4" />}

                  label="Influencia"

                  description="Quem operou apos o e-mail"

                  to="/influencia"

                  color="#0660FE"

                />

                <NavCard

                  icon={<AlertTriangle className="h-4 w-4" />}

                  label="Alertas"

                  description="Clientes para acionar"

                  to="/alertas"

                  color="#f59e0b"

                />

                <NavCard

                  icon={<SettingsIcon className="h-4 w-4" />}

                  label="Configuracoes"

                  description="API key e benchmarks"

                  to="/settings"

                  color="#6b7280"

                />



                {/* Score legend */}

                <div className="mt-1 rounded border border-border bg-card px-4 py-3.5">

                  <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Score</p>

                  <div className="space-y-1.5">

                    {[{ label: "Excelente", min: 70, color: "bg-success" }, { label: "Regular", min: 40, color: "bg-warning" }, { label: "Fraco", min: 0, color: "bg-destructive" }].map((r) => (

                      <div key={r.label} className="flex items-center gap-2">

                        <div className={cn("h-2 w-2 rounded-full", r.color)} />

                        <span className="text-xs text-muted-foreground">{r.label}</span>

                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{'>='} {r.min}</span>

                      </div>

                    ))}

                  </div>

                </div>

              </div>

            </div>

          </>

        )}

      </main>

    </div>

  );

}



/* KPI Card */

function KpiCard({ icon, label, value, sub, good, bar, accent }: {

  icon: React.ReactNode; label: string; value: string; sub: string;

  good?: boolean; accent?: string;

  bar?: { value: number; max: number; bench: number };

}) {

  const borderColor = good === true ? "var(--color-success)" : good === false ? "var(--color-destructive)" : accent ?? "#0660FE";

  const valueColor  = good === true ? "text-success" : good === false ? "text-destructive" : "text-foreground";



  return (

    <div className="relative overflow-hidden rounded border border-border bg-card px-5 py-4" style={{ borderTopColor: borderColor, borderTopWidth: "3px" }}>

      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">

        <span style={{ color: borderColor }}>{icon}</span>

        {label}

      </div>

      <div className={cn("mt-3 font-mono text-3xl font-bold tabular-nums leading-none", valueColor)}>

        {value}

      </div>

      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>

      {bar && (

        <div className="mt-3 space-y-1">

          <div className="relative h-1.5 overflow-hidden rounded-full bg-border">

            <div

              className="absolute inset-y-0 left-0 rounded-full transition-all"

              style={{ width: `${Math.min((bar.value / bar.max) * 100, 100)}%`, backgroundColor: borderColor }}

            />

            <div

              className="absolute inset-y-0 w-px bg-muted-foreground/40"

              style={{ left: `${Math.min((bar.bench / bar.max) * 100, 100)}%` }}

            />

          </div>

        </div>

      )}

    </div>

  );

}



/* Score Bar */

function ScoreBar({ score }: { score: number }) {

  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (

    <div className="flex items-center justify-end gap-2">

      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border">

        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />

      </div>

      <span className="w-7 font-mono text-xs tabular-nums" style={{ color }}>{score}</span>

    </div>

  );

}



/* Nav Card */

function NavCard({ icon, label, description, to, color }: {

  icon: React.ReactNode; label: string; description: string; to: string; color: string;

}) {

  return (

    <Link

      to={to}

      className="group flex items-center gap-3 rounded border border-border bg-card px-4 py-3 transition-all hover:border-primary/30 hover:shadow-sm"

    >

      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${color}18`, color }}>

        {icon}

      </div>

      <div className="min-w-0 flex-1">

        <div className="text-sm font-semibold text-foreground">{label}</div>

        <div className="truncate text-[11px] text-muted-foreground">{description}</div>

      </div>

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />

    </Link>

  );

}



