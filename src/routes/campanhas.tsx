import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns, listAutomations, type Campaign, type Automation } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { PageHeader, PageShell, TabBar } from "@/components/app/ui-kit";
import { isRealSend, summarize } from "@/lib/analysis/overview";
import { useCampaignHistory } from "@/hooks/use-sent-campaigns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChevronRight,
  Clock,
  Download,
  Mail,
  MousePointerClick,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { readCampaignHistory, type HistoryEntry } from "@/hooks/use-campaign-history";

function exportCSV(campaigns: Campaign[]) {
  const header = ["Nome", "Data", "Envios", "T. Abertura %", "CTR %", "Score", "Bounces", "Descadastros"];
  const rows = campaigns.map((c) => [
    `"${c.name.replace(/"/g, '""')}"`,
    c.sdate ? format(new Date(c.sdate), "dd/MM/yyyy", { locale: ptBR }) : "",
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

export const Route = createFileRoute("/campanhas")({
  ssr: false,
  component: () => (
    <AuthGate>
      <FluxosPage />
    </AuthGate>
  ),
});

const TABS = [
  { value: "campanhas", label: "Campanhas" },
  { value: "automacoes", label: "Automações" },
] as const;
type FluxoTab = (typeof TABS)[number]["value"];

function FluxosPage() {
  const [tab, setTab] = useState<FluxoTab>("campanhas");
  return (
    <PageShell wide>
      <PageHeader
        icon={BarChart3}
        title="Fluxos"
        description="Consulta rápida de campanhas e automações. Para comparar disparos e entender resultados, use Análises."
      />
      <div className="mb-6">
        <TabBar tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>
      {tab === "campanhas" && <CampaignListPage />}
      {tab === "automacoes" && <AutomacoesInline />}
    </PageShell>
  );
}

type SortKey = "open_rate" | "ctr" | "send_amt";

function CampaignListPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });

  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["campaigns", 0],
    queryFn: () => fetchCampaigns({ data: { offset: 0 } }),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  useEffect(() => {
    if (campaignsQ.data) {
      setAllCampaigns(campaignsQ.data.campaigns);
      setTotal(campaignsQ.data.total);
    }
  }, [campaignsQ.data]);

  useEffect(() => {
    if (settingsQ.data && !settingsQ.data.hasApiKey) {
      navigate({ to: "/settings" });
    }
  }, [settingsQ.data, navigate]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const more = await fetchCampaigns({ data: { offset: allCampaigns.length } });
      setAllCampaigns((prev) => [...prev, ...more.campaigns]);
      setTotal(more.total);
    } finally {
      setLoadingMore(false);
    }
  }, [allCampaigns.length, fetchCampaigns]);

  const handleRefresh = useCallback(() => {
    setAllCampaigns([]);
    setTotal(0);
    campaignsQ.refetch();
  }, [campaignsQ]);

  const [tab, setTab] = useState<"campaigns" | "history">("campaigns");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"sent" | "drafts">("sent");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "send_amt",
    dir: "desc",
  });

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const onHistoryTab = useCallback(() => {
    setHistory(readCampaignHistory());
  }, []);

  const sentCount = allCampaigns.filter((c) => c.send_amt > 0).length;
  const draftCount = allCampaigns.length - sentCount;

  const rows = useMemo(() => {
    let list = allCampaigns.filter((c) => (filter === "sent" ? c.send_amt > 0 : c.send_amt === 0));
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(s));
    }
    list = [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      return sort.dir === "asc" ? va - vb : vb - va;
    });
    return list;
  }, [allCampaigns, filter, search, sort]);

  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;
  const hasMore = allCampaigns.length < total;
  const isLoading = campaignsQ.isLoading;
  const isError = campaignsQ.isError;

  // Same data and rule as the Dashboard: every campaign, weighted by volume sent.
  const history = useCampaignHistory();
  const sent = (history.campaigns ?? []).filter(isRealSend);
  const summary = summarize(sent);
  const avgOR = summary.open_rate;
  const avgCTR = summary.ctr;

  return (
    <div>
      <Tabs
          value={tab}
          onValueChange={(v) => {
            const next = v as typeof tab;
            setTab(next);
            if (next === "history") onHistoryTab();
          }}
        >
          <TabsList className="bg-surface">
            <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
            <TabsTrigger value="history">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Histórico
            </TabsTrigger>
          </TabsList>

          {/* ── Aba Campanhas ── */}
          <TabsContent value="campaigns" className="mt-6">

            {/* KPIs */}
            {!isLoading && !isError && sent.length > 0 && (
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <KpiCard
                  icon={<Mail className="h-4 w-4" />}
                  label="Campanhas enviadas"
                  value={sent.length.toLocaleString("pt-BR")}
                  sub={`${summary.sent.toLocaleString("pt-BR")} e-mails · rascunhos e testes ignorados`}
                  accent="#0660FE"
                />
                <KpiCard
                  icon={<MousePointerClick className="h-4 w-4" />}
                  label="Taxa de abertura media"
                  value={`${avgOR.toFixed(1)}%`}
                  sub={`benchmark ${benchOR}%`}
                  good={avgOR >= benchOR}
                  bar={{ value: avgOR, max: Math.max(avgOR, benchOR) * 1.4, bench: benchOR }}
                  accent="#0660FE"
                />
                <KpiCard
                  icon={<ArrowUp className="h-4 w-4" />}
                  label="CTR medio"
                  value={`${avgCTR.toFixed(2)}%`}
                  sub={`benchmark ${benchCTR}%`}
                  good={avgCTR >= benchCTR}
                  bar={{ value: avgCTR, max: Math.max(avgCTR, benchCTR) * 1.4, bench: benchCTR }}
                  accent="#0660FE"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setFilter("sent")}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                  filter === "sent"
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                Enviadas ({sentCount})
              </button>
              <button
                onClick={() => setFilter("drafts")}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                  filter === "drafts"
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                Rascunhos ({draftCount})
              </button>
              <div className="relative ml-auto w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome…"
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", (campaignsQ.isFetching || loadingMore) && "animate-spin")} />
                Atualizar
              </Button>
              {allCampaigns.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportCSV(allCampaigns.filter((c) => c.send_amt > 0))}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  CSV
                </Button>
              )}
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Campanha</th>
                    <th className="px-3 py-3 text-left font-medium">Data</th>
                    <SortHeader k="send_amt" sort={sort} setSort={setSort}>Envios</SortHeader>
                    <SortHeader k="open_rate" sort={sort} setSort={setSort}>Abertura</SortHeader>
                    <SortHeader k="ctr" sort={sort} setSort={setSort}>CTR</SortHeader>
                    <th className="px-3 py-3 text-right font-medium">Score</th>
                    <th className="w-10 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                        Carregando campanhas…
                      </td>
                    </tr>
                  ) : isError ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center">
                        <p className="text-sm text-destructive">{(campaignsQ.error as Error).message}</p>
                        <Button asChild variant="outline" size="sm" className="mt-3">
                          <Link to="/settings">
                            <SettingsIcon className="mr-1.5 h-4 w-4" />Verificar chave de API
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                        Nenhuma campanha encontrada.
                      </td>
                    </tr>
                  ) : (
                    rows.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                        className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                      >
                        <td className="px-5 py-4">
                          <span className="font-medium">{c.name}</span>
                        </td>
                        <td className="px-3 py-4 text-xs text-muted-foreground">
                          {c.sdate ? format(new Date(c.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
                        </td>
                        <td className="px-3 py-4 tabular-nums">{c.send_amt.toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-4">
                          <RateCell value={c.open_rate} bench={benchOR} />
                        </td>
                        <td className="px-3 py-4">
                          <RateCell value={c.ctr} bench={benchCTR} />
                        </td>
                        <td className="px-3 py-4">
                          <ScoreBar score={c.score} />
                        </td>
                        <td className="px-3 py-4 text-muted-foreground">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {hasMore && !isLoading && !isError && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Exibindo {allCampaigns.length} de {total}
                </span>
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingMore && "animate-spin")} />
                  {loadingMore ? "Carregando…" : `Carregar mais ${Math.min(100, total - allCampaigns.length)}`}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Aba Histórico ── */}
          <TabsContent value="history" className="mt-6">
            {history.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-10 text-center">
                <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma campanha visualizada ainda. Abra o detalhe de uma campanha para começar seu histórico.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{history.length} visualizadas recentemente</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      localStorage.removeItem("crm_campaign_history");
                      setHistory([]);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Limpar histórico
                  </Button>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-xs text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left font-medium">Campanha</th>
                        <th className="px-3 py-3 text-left font-medium">Enviada</th>
                        <th className="px-3 py-3 text-right font-medium">T. Abertura</th>
                        <th className="px-3 py-3 text-right font-medium">CTR</th>
                        <th className="px-3 py-3 text-right font-medium">Visualizada</th>
                        <th className="w-12 px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr
                          key={`${h.id}-${h.viewedAt}`}
                          onClick={() => navigate({ to: "/campaigns/$id", params: { id: h.id } })}
                          className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                        >
                          <td className="px-5 py-4 font-medium">{h.name}</td>
                          <td className="px-3 py-4 text-xs text-muted-foreground">
                            {h.sdate ? format(new Date(h.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
                          </td>
                          <td className="px-3 py-4 text-right">
                            <RateCell value={h.open_rate} bench={benchOR} />
                          </td>
                          <td className="px-3 py-4 text-right">
                            <RateCell value={h.ctr} bench={benchCTR} />
                          </td>
                          <td className="px-3 py-4 text-right text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(h.viewedAt), { addSuffix: true, locale: ptBR })}
                          </td>
                          <td className="px-3 py-4 text-muted-foreground">
                            <ChevronRight className="h-4 w-4" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
    </div>
  );
}

function SortHeader({
  k,
  sort,
  setSort,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  setSort: (s: { key: SortKey; dir: "asc" | "desc" }) => void;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th
      className="cursor-pointer select-none px-3 py-3 text-left font-medium hover:text-foreground"
      onClick={() =>
        setSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" })
      }
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? (
          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

function ScoreBar({ score }: { score: number }) {
  const bar = score >= 70 ? "bg-success" : score >= 40 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", bar)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-6 text-right text-xs font-medium tabular-nums text-foreground">{score}</span>
    </div>
  );
}

function RateCell({ value, bench }: { value: number; bench: number }) {
  const above = value >= bench;
  const max = Math.max(value, bench) * 1.3 || 1;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", above ? "bg-success" : "bg-destructive/70")}
          style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
        />
      </div>
      <span className={cn("text-xs font-medium tabular-nums", above ? "text-success" : "text-destructive")}>{value.toFixed(1)}%</span>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, good, bar }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
  good?: boolean; accent?: string;
  bar?: { value: number; max: number; bench: number };
}) {
  const tone = good === true ? "bg-success" : good === false ? "bg-destructive/70" : "bg-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        <span className="text-muted-foreground/60">{icon}</span>
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{sub}</div>
      {bar && (
        <div className="mt-3 relative h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", tone)} style={{ width: `${Math.min((bar.value / bar.max) * 100, 100)}%` }} />
          <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${Math.min((bar.bench / bar.max) * 100, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function AutomacoesInline() {
  const fetchSettings  = useServerFn(getSettings);
  const fetchAutos     = useServerFn(listAutomations);
  const settingsQ      = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const autosQ         = useQuery({
    queryKey: ["automations"],
    queryFn: () => fetchAutos(),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });
  const navigate = useNavigate();
  const autos: Automation[] = autosQ.data?.automations ?? [];

  if (autosQ.isLoading) {
    return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>;
  }
  if (autosQ.error) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{(autosQ.error as Error).message}</div>;
  }
  if (autos.length === 0) {
    return <div className="rounded-md border border-border px-6 py-16 text-center text-sm text-muted-foreground">Nenhuma automação encontrada.</div>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {autos.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => navigate({ to: "/automation/$id", params: { id: a.id } })}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/30"
        >
          <p className="truncate text-sm font-medium">{a.name}</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{a.entered.toLocaleString("pt-BR")} entradas</span>
            <span>{a.completion_rate.toFixed(1)}% conclusão</span>
          </div>
        </button>
      ))}
    </div>
  );
}
