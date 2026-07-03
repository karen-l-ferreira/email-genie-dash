import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns, listAutomations, getCobrancaComparison, saveSnapshot, listSnapshots, type Campaign, type Automation, type CobrancaRow, type MetricSnapshot } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Clock,
  Download,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
  { key: "campanhas",  label: "Campanhas" },
  { key: "cobranca",   label: "Cobrança" },
  { key: "automacoes", label: "Automações" },
] as const;
type FluxoTab = typeof TABS[number]["key"];

function FluxosPage() {
  const [tab, setTab] = useState<FluxoTab>("campanhas");
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-7 border-b border-border pb-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">ActiveCampaign</p>
          <h1 className="text-lg font-bold">Fluxos</h1>
        </div>
        <div className="mb-6 border-b border-border">
          <nav className="-mb-px flex">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={[
                  "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors",
                  tab === t.key
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        {tab === "campanhas"  && <CampaignListPage />}
        {tab === "cobranca"   && <CobrancaTab />}
        {tab === "automacoes" && <AutomacoesInline />}
      </div>
    </div>
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

            <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Campanha</th>
                    <th className="px-3 py-3 text-left font-medium">Data</th>
                    <SortHeader k="send_amt" sort={sort} setSort={setSort}>Envios</SortHeader>
                    <SortHeader k="open_rate" sort={sort} setSort={setSort}>T. Abertura</SortHeader>
                    <SortHeader k="ctr" sort={sort} setSort={setSort}>CTR</SortHeader>
                    <th className="w-12 px-3 py-3" />
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
                        <td className="px-3 py-4 font-mono text-xs text-muted-foreground">
                          {c.sdate ? format(new Date(c.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
                        </td>
                        <td className="px-3 py-4 font-mono tabular-nums">{c.send_amt.toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-4">
                          <RateCell value={c.open_rate} bench={benchOR} />
                        </td>
                        <td className="px-3 py-4">
                          <RateCell value={c.ctr} bench={benchCTR} />
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
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
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
                          <td className="px-3 py-4 font-mono text-xs text-muted-foreground">
                            {h.sdate ? format(new Date(h.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
                          </td>
                          <td className="px-3 py-4 text-right">
                            <RateCell value={h.open_rate} bench={benchOR} />
                          </td>
                          <td className="px-3 py-4 text-right">
                            <RateCell value={h.ctr} bench={benchCTR} />
                          </td>
                          <td className="px-3 py-4 text-right font-mono text-xs text-muted-foreground">
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

function RateCell({ value, bench }: { value: number; bench: number }) {
  const above = value >= bench;
  return (
    <span className={cn("font-mono tabular-nums", above ? "text-success" : "text-destructive")}>
      {value.toFixed(1)}%
    </span>
  );
}

function CobrancaTab() {
  const fetchSettings = useServerFn(getSettings);
  const fetchCompare  = useServerFn(getCobrancaComparison);
  const fetchSave     = useServerFn(saveSnapshot);
  const fetchSnaps    = useServerFn(listSnapshots);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const cmpQ = useQuery({
    queryKey: ["cobranca-comparison"],
    queryFn: () => fetchCompare(),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const histQ = useQuery({
    queryKey: ["cobranca-history"],
    queryFn: () => fetchSnaps({ data: { entity_id: "cobranca" } }),
    enabled: !!settingsQ.data?.hasApiKey,
  });

  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"atual" | "historico">("atual");

  async function handleSave() {
    if (!cmpQ.data) return;
    setSaving(true);
    try {
      const metrics: Record<string, number> = {};
      for (const r of cmpQ.data.rows) {
        const key = `${r.type[0]}_${r.day}`;
        metrics[`${key}_elegiveis`] = r.elegiveis;
        metrics[`${key}_enviados`]  = r.enviados;
      }
      await fetchSave({ data: {
        label: format(new Date(), "dd/MM/yyyy HH:mm"),
        entity_type: "campaign",
        entity_id: "cobranca",
        entity_name: "Cobrança",
        metrics,
      }});
      await histQ.refetch();
      toast.success("Snapshot salvo!");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const isLoading = settingsQ.isLoading || cmpQ.isLoading;
  const rows: CobrancaRow[] = cmpQ.data?.rows ?? [];
  const cedente = rows.filter((r) => r.type === "cedente");
  const sacado  = rows.filter((r) => r.type === "sacado");
  const history: MetricSnapshot[] = histQ.data?.snapshots ?? [];

  return (
    <div className="space-y-5">
      {/* Cabeçalho + ações */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
          {(["atual", "historico"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "atual" ? "Hoje" : `Histórico (${history.length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => cmpQ.refetch()} disabled={cmpQ.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", cmpQ.isFetching && "animate-spin")} />
            Atualizar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !cmpQ.data || cmpQ.isFetching}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      {cmpQ.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(cmpQ.error as Error).message}
        </div>
      )}

      {/* ── Vista atual ── */}
      {view === "atual" && (
        <>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              Nenhum dado encontrado. Verifique se as automações e campos de conta estão configurados.
            </div>
          ) : (
            <>
              {cmpQ.data?.fetchedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Atualizado às {format(new Date(cmpQ.data.fetchedAt), "HH:mm 'de' dd/MM/yyyy")}
                </p>
              )}
              <CobrancaCompareTable title="Cedente" accent="border-l-primary" rows={cedente} />
              <CobrancaCompareTable title="Sacado"  accent="border-l-amber-500" rows={sacado} />
            </>
          )}
        </>
      )}

      {/* ── Histórico ── */}
      {view === "historico" && (
        <>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              Nenhum registro salvo ainda. Clique em "Salvar" para registrar o estado de hoje.
            </div>
          ) : (
            <div className="space-y-6">
              {(["cedente", "sacado"] as const).map((tipo) => {
                const tipoRows = rows.filter((r) => r.type === tipo);
                if (tipoRows.length === 0) return null;
                return (
                  <div key={tipo}>
                    <p className={cn("mb-2 text-[11px] font-bold uppercase tracking-widest", tipo === "sacado" ? "text-amber-500" : "text-primary")}>
                      {tipo === "cedente" ? "Cedente" : "Sacado"}
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-border bg-card">
                      <table className="w-full text-sm">
                        <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Data</th>
                            {tipoRows.map((r) => (
                              <th key={`${r.type}-${r.day}`} className="px-3 py-2.5 text-center font-medium whitespace-nowrap" colSpan={2}>
                                {r.label}
                              </th>
                            ))}
                          </tr>
                          <tr className="border-t border-border">
                            <th className="px-4 py-1 text-[10px] text-muted-foreground/50">—</th>
                            {tipoRows.map((r) => (
                              <>
                                <th key={`${r.type}-${r.day}-el`} className="px-2 py-1 text-center text-[10px] text-muted-foreground">Elegíveis</th>
                                <th key={`${r.type}-${r.day}-en`} className="px-2 py-1 text-center text-[10px] text-primary">Enviados</th>
                              </>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((snap) => (
                            <tr key={snap.id} className="border-t border-border hover:bg-surface-2">
                              <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{snap.label}</td>
                              {tipoRows.map((r) => {
                                const key = `${r.type[0]}_${r.day}`;
                                const el = Number(snap.metrics[`${key}_elegiveis`] ?? 0);
                                const en = Number(snap.metrics[`${key}_enviados`]  ?? 0);
                                const diff = en - el;
                                return (
                                  <>
                                    <td key={`${key}-el`} className="px-2 py-2.5 text-center font-mono tabular-nums text-xs">
                                      {el > 0 ? el.toLocaleString("pt-BR") : <span className="text-muted-foreground/30">—</span>}
                                    </td>
                                    <td key={`${key}-en`} className={cn("px-2 py-2.5 text-center font-mono tabular-nums text-xs font-medium", diff < 0 ? "text-destructive" : diff === 0 && en > 0 ? "text-success" : "")}>
                                      {en > 0 ? en.toLocaleString("pt-BR") : <span className="text-muted-foreground/30">—</span>}
                                    </td>
                                  </>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CobrancaCompareTable({ title, accent, rows }: { title: string; accent: string; rows: CobrancaRow[] }) {
  return (
    <div>
      <p className={cn("mb-2 text-[11px] font-bold uppercase tracking-widest", title === "Sacado" ? "text-amber-500" : "text-primary")}>
        {title}
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Régua</th>
              <th className="px-4 py-2.5 text-left font-medium">Automação</th>
              <th className="px-4 py-2.5 text-right font-medium">Elegíveis</th>
              <th className="px-4 py-2.5 text-right font-medium">Enviados AC</th>
              <th className="px-4 py-2.5 text-right font-medium">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">Sem dados</td></tr>
            ) : rows.map((r) => {
              const diff = r.enviados - r.elegiveis;
              const hasAny = r.elegiveis > 0 || r.enviados > 0;
              return (
                <tr key={`${r.type}-${r.day}`} className={cn("border-t border-border transition-colors hover:bg-surface-2", !hasAny && "opacity-40")}>
                  <td className={cn("border-l-[3px] px-4 py-3 font-mono font-bold text-xs", accent)}>{r.label}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.automation_id ? r.automation_name : <span className="text-destructive/70 italic">não encontrada</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.elegiveis > 0 ? r.elegiveis.toLocaleString("pt-BR") : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                    {r.enviados > 0 ? r.enviados.toLocaleString("pt-BR") : <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                    {!hasAny ? <span className="text-muted-foreground/40">—</span>
                      : diff === 0 ? <span className="text-success">✓</span>
                      : diff < 0 ? <span className="text-destructive">{diff.toLocaleString("pt-BR")}</span>
                      : <span className="text-warning">+{diff.toLocaleString("pt-BR")}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
