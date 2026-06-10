import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCampaign, getCampaignMessages, listCampaigns, type CampaignMessage } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { getMessageAnalysis, getRecommendations, getVariations, type MessageAnalysis, type Recommendation } from "@/lib/ai.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { MetricCard } from "@/components/app/MetricCard";
import { CampaignStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeft, CheckCircle2, Copy, Download, Mail, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { addToCampaignHistory } from "@/hooks/use-campaign-history";

export const Route = createFileRoute("/campaigns/$id")({
  ssr: false,
  component: () => (
    <AuthGate>
      <CampaignDetailPage />
    </AuthGate>
  ),
});

const CAT_COLORS: Record<string, string> = {
  CONTENT: "bg-primary/15 text-primary border-primary/30",
  SEGMENTATION: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  TIMING: "bg-warning/15 text-warning border-warning/30",
  CHANNEL: "bg-success/15 text-success border-success/30",
};
const PRI_COLORS: Record<string, string> = {
  P1: "bg-destructive text-destructive-foreground",
  P2: "bg-warning text-warning-foreground",
  P3: "bg-muted text-muted-foreground",
};

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const fetchCampaign = useServerFn(getCampaign);
  const fetchSettings = useServerFn(getSettings);
  const fetchAll = useServerFn(listCampaigns);
  const fetchRecs = useServerFn(getRecommendations);
  const fetchVars = useServerFn(getVariations);
  const fetchMessages = useServerFn(getCampaignMessages);
  const fetchMsgAnalysis = useServerFn(getMessageAnalysis);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const cQ = useQuery({ queryKey: ["campaign", id], queryFn: () => fetchCampaign({ data: { id } }) });
  const allQ = useQuery({ queryKey: ["campaigns", 0], queryFn: () => fetchAll({ data: { offset: 0 } }) });

  const c = cQ.data?.campaign;
  const html = cQ.data?.html ?? "";
  const subject = cQ.data?.subject ?? "";
  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;

  useEffect(() => {
    if (c) {
      addToCampaignHistory({ id: c.id, name: c.name, sdate: c.sdate, open_rate: c.open_rate, ctr: c.ctr });
    }
  }, [c]);

  const [recsRefresh, setRecsRefresh] = useState(false);
  const recsQ = useQuery({
    queryKey: ["recs", id, recsRefresh],
    enabled: !!c && !!settingsQ.data,
    queryFn: () =>
      fetchRecs({
        data: {
          campaign_id: c!.id,
          name: c!.name,
          subject,
          open_rate: c!.open_rate,
          ctr: c!.ctr,
          send_amt: c!.send_amt,
          uniqueopens: c!.uniqueopens,
          uniquelinkclicks: c!.uniquelinkclicks,
          hardbounces: c!.hardbounces,
          unsubscribes: c!.unsubscribes,
          benchmark_open_rate: benchOR,
          benchmark_ctr: benchCTR,
          refresh: recsRefresh,
        },
      }),
  });

  const messagesQ = useQuery({
    queryKey: ["campaign-messages", id],
    enabled: !!c,
    queryFn: () => fetchMessages({ data: { id } }),
  });

  const [pageTab, setPageTab] = useState<"overview" | "messages">("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const varsM = useMutation({
    mutationFn: (refresh = false) =>
      fetchVars({ data: { campaign_id: id, subject, html, recommendations: recsQ.data?.recommendations ?? [], refresh } }),
  });

  const trend = useMemo(() => {
    return (allQ.data?.campaigns ?? [])
      .filter((x) => x.send_amt > 0 && x.sdate)
      .sort((a, b) => new Date(a.sdate!).getTime() - new Date(b.sdate!).getTime())
      .slice(-10)
      .map((x) => ({ name: x.name.slice(0, 12), open: +x.open_rate.toFixed(1), bench: benchOR }));
  }, [allQ.data, benchOR]);

  if (cQ.isLoading || !c) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-[1400px] px-6 py-10">
          <div className="h-10 w-64 animate-pulse rounded-lg bg-surface" />
          <div className="mt-8 grid grid-cols-6 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}
          </div>
        </div>
      </div>
    );
  }

  const radar = [
    { axis: "T. Abertura", value: Math.min(150, (c.open_rate / benchOR) * 100), bench: 100 },
    { axis: "CTR", value: Math.min(150, (c.ctr / benchCTR) * 100), bench: 100 },
    { axis: "Engajamento", value: Math.min(150, (c.uniquelinkclicks / Math.max(1, c.send_amt)) * 100 * 10), bench: 100 },
    { axis: "Não-Bounce", value: c.send_amt ? ((c.send_amt - c.hardbounces) / c.send_amt) * 100 : 0, bench: 98 },
  ];

  function downloadCSV() {
    const rows = [
      ["Métrica", "Valor", "Benchmark"],
      ["Taxa de Abertura", c!.open_rate.toFixed(2) + "%", benchOR + "%"],
      ["CTR", c!.ctr.toFixed(2) + "%", benchCTR + "%"],
      ["Envios", String(c!.send_amt), ""],
      ["Total de Aberturas", String(c!.opens), ""],
      ["Aberturas Únicas", String(c!.uniqueopens), ""],
      ["Devoluções", String(c!.hardbounces + c!.softbounces), ""],
      ["Descadastros", String(c!.unsubscribes), ""],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${c!.name.replace(/\W+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <CampaignStatusBadge status={c.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>ID {c.id}</span>
              <span>•</span>
              <span>{c.type}</span>
              <span>•</span>
              <span>{c.sdate ? format(new Date(c.sdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}</span>
              <span>•</span>
              <span>{c.send_amt.toLocaleString("pt-BR")} envios</span>
              <span>•</span>
              <span className="text-foreground">Pontuação {c.score}/100</span>
              {c.message_ids.length > 1 && (
                <>
                  <span>•</span>
                  <span className="text-primary">{c.message_ids.length} mensagens</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadCSV}>
              <Download className="mr-1.5 h-4 w-4" />CSV
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/campanhas"><ArrowLeft className="mr-1.5 h-4 w-4" />Campanhas</Link>
            </Button>
          </div>
        </div>

        {/* Abas principais */}
        <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as typeof pageTab)} className="mt-8">
          <TabsList className="bg-surface">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="messages">
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Mensagens
              {c.message_ids.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {c.message_ids.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Aba Visão Geral ── */}
          <TabsContent value="overview">
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <MetricCard label="Taxa de Abertura" value={`${c.open_rate.toFixed(1)}%`} detail={`${c.uniqueopens}/${c.send_amt}`} variance={c.open_rate - benchOR} />
              <MetricCard label="CTR" value={`${c.ctr.toFixed(2)}%`} detail={`${c.uniquelinkclicks}/${c.uniqueopens || 0}`} variance={c.ctr - benchCTR} />
              <MetricCard label="Total de Aberturas" value={c.opens.toLocaleString("pt-BR")} detail={`${c.uniqueopens.toLocaleString("pt-BR")} únicos`} />
              <MetricCard label="Envios" value={c.send_amt.toLocaleString("pt-BR")} detail={`${c.total_amt.toLocaleString("pt-BR")} na fila`} />
              <MetricCard label="Devoluções" value={(c.hardbounces + c.softbounces).toLocaleString("pt-BR")} detail={`${c.hardbounces} hard`} variance={-(((c.hardbounces + c.softbounces) / Math.max(1, c.send_amt)) * 100 - 2)} invertColor />
              <MetricCard label="Descadastros" value={c.unsubscribes.toLocaleString("pt-BR")} detail={`${((c.unsubscribes / Math.max(1, c.send_amt)) * 100).toFixed(2)}%`} />
            </div>

            {/* Gráficos */}
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Performance vs Benchmark</h3>
                <div className="h-72">
                  <ResponsiveContainer>
                    <RadarChart data={radar}>
                      <PolarGrid stroke="oklch(1 0 0 / 10%)" />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 11 }} />
                      <PolarRadiusAxis tick={false} axisLine={false} />
                      <Radar name="Benchmark" dataKey="bench" stroke="oklch(0.66 0.025 255)" fill="oklch(0.66 0.025 255)" fillOpacity={0.1} />
                      <Radar name="Campanha" dataKey="value" stroke="oklch(0.74 0.17 245)" fill="oklch(0.74 0.17 245)" fillOpacity={0.35} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Taxa de Abertura — últimas campanhas</h3>
                <div className="h-72">
                  <ResponsiveContainer>
                    <LineChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                      <CartesianGrid stroke="oklch(1 0 0 / 6%)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "oklch(0.21 0.025 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="bench" stroke="oklch(0.66 0.025 255)" strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="open" stroke="oklch(0.74 0.17 245)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Tabela comparativa */}
            <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-5 py-3 text-sm font-semibold">Campanha vs Benchmark Interno</div>
              <table className="w-full text-sm">
                <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Métrica</th>
                    <th className="px-3 py-2 text-right font-medium">Campanha</th>
                    <th className="px-3 py-2 text-right font-medium">Benchmark</th>
                    <th className="px-5 py-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <CmpRow label="Taxa de Abertura" v={c.open_rate} b={benchOR} suffix="%" />
                  <CmpRow label="CTR" v={c.ctr} b={benchCTR} suffix="%" />
                  <CmpRow label="Taxa de Bounce" v={(c.hardbounces / Math.max(1, c.send_amt)) * 100} b={2} suffix="%" invert />
                  <CmpRow label="Taxa de Descadastro" v={(c.unsubscribes / Math.max(1, c.send_amt)) * 100} b={0.5} suffix="%" invert />
                </tbody>
              </table>
            </div>

            {/* Recomendações de IA */}
            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">Recomendações de Melhoria por IA</h2>
                </div>
                {recsQ.data && !recsQ.isLoading && (
                  <Button variant="outline" size="sm" onClick={() => setRecsRefresh((v) => !v)} disabled={recsQ.isLoading}>
                    Reanalisar
                  </Button>
                )}
              </div>
              {recsQ.isLoading ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />)}
                </div>
              ) : recsQ.isError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
                  {(recsQ.error as Error).message}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {(recsQ.data?.recommendations ?? []).map((r: Recommendation, idx: number) => (
                    <RecommendationCard key={idx} rec={r} />
                  ))}
                </div>
              )}
              <div className="mt-6">
                <Button size="lg" disabled={!recsQ.data || varsM.isPending} onClick={() => { setDrawerOpen(true); varsM.mutate(false); }}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {varsM.isPending ? "Gerando…" : "Gerar 3 Variações com IA"}
                </Button>
              </div>
            </section>
          </TabsContent>

          {/* ── Aba Mensagens ── */}
          <TabsContent value="messages">
            <MessagesTab
              campaignId={id}
              messages={messagesQ.data?.messages ?? []}
              isLoading={messagesQ.isLoading}
              isError={messagesQ.isError}
              error={messagesQ.error as Error | null}
              fetchAnalysis={fetchMsgAnalysis as FetchAnalysis}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Drawer de variações */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full overflow-y-auto bg-background sm:max-w-3xl">
          <SheetHeader className="flex flex-row items-center justify-between">
            <SheetTitle>Variações de E-mail por IA</SheetTitle>
            <Button size="sm" variant="outline" disabled={varsM.isPending} onClick={() => varsM.mutate(true)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Gerar novamente
            </Button>
          </SheetHeader>
          {varsM.isPending ? (
            <div className="mt-8 space-y-3">
              <div className="h-8 w-1/2 animate-pulse rounded bg-surface" />
              <div className="h-64 animate-pulse rounded bg-surface" />
            </div>
          ) : varsM.isError ? (
            <p className="mt-6 text-sm text-destructive">{(varsM.error as Error).message}</p>
          ) : varsM.data?.variations?.length ? (
            <Tabs defaultValue="0" className="mt-6">
              <TabsList className="bg-surface">
                {varsM.data.variations.map((_: unknown, i: number) => (
                  <TabsTrigger key={i} value={String(i)}>Variação {i + 1}</TabsTrigger>
                ))}
              </TabsList>
              {varsM.data.variations.map((v: { subject: string; changes: string[]; html: string }, i: number) => (
                <TabsContent key={i} value={String(i)} className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Novo assunto</div>
                    <div className="mt-2 flex items-center gap-2">
                      <p className="flex-1 text-sm font-medium">{v.subject}</p>
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(v.subject); toast.success("Assunto copiado"); }}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Principais alterações</div>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {(v.changes ?? []).map((ch: string, k: number) => (
                        <li key={k} className="flex gap-2"><span className="text-primary">→</span>{ch}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prévia</div>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(v.html); toast.success("HTML copiado"); }}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                      </Button>
                    </div>
                    <iframe srcDoc={v.html} className="h-[480px] w-full rounded-md border border-border bg-white" sandbox="" title={`variation-${i}`} />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Nenhuma variação ainda.</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Aba Mensagens ────────────────────────────────────────────────────────────

type FetchAnalysis = (opts: {
  data: { campaign_id: string; message_id: string; subject: string; html: string };
}) => Promise<{ analysis: MessageAnalysis }>;

function MessagesTab({ campaignId, messages, isLoading, isError, error, fetchAnalysis }: {
  campaignId: string;
  messages: CampaignMessage[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  fetchAnalysis: FetchAnalysis;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, MessageAnalysis>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const msg = messages[selectedIdx];

  async function analyzeMessage(m: CampaignMessage) {
    if (analyses[m.id] || loading[m.id]) return;
    setLoading((prev) => ({ ...prev, [m.id]: true }));
    try {
      const res = await fetchAnalysis({ data: { campaign_id: campaignId, message_id: m.id, subject: m.subject, html: m.html } });
      setAnalyses((prev) => ({ ...prev, [m.id]: res.analysis }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading((prev) => ({ ...prev, [m.id]: false }));
    }
  }

  if (isLoading) return (
    <div className="mt-6 space-y-3">
      <div className="h-10 w-48 animate-pulse rounded-lg bg-surface" />
      <div className="h-64 animate-pulse rounded-xl bg-surface" />
    </div>
  );

  if (isError) return (
    <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
      {error?.message ?? "Falha ao carregar mensagens"}
    </div>
  );

  if (messages.length === 0) return (
    <div className="mt-6 rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
      Nenhuma mensagem encontrada para esta campanha.
    </div>
  );

  const analysis = msg ? analyses[msg.id] : undefined;
  const isAnalyzing = msg ? loading[msg.id] : false;

  return (
    <div className="mt-6">
      {messages.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {messages.map((m, i) => (
            <button key={m.id} onClick={() => setSelectedIdx(i)}
              className={cn("rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                selectedIdx === i ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground")}>
              Mensagem {i + 1}{m.subject ? ` — ${m.subject.slice(0, 30)}` : ""}
            </button>
          ))}
        </div>
      )}

      {msg && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assunto</div>
                  <p className="mt-1 text-sm font-medium">{msg.subject || "(sem assunto)"}</p>
                  {msg.fromname && (
                    <p className="mt-1 text-xs text-muted-foreground">De: {msg.fromname} &lt;{msg.fromemail}&gt;</p>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(msg.subject); toast.success("Assunto copiado"); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prévia do e-mail</div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(msg.html); toast.success("HTML copiado"); }}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                </Button>
              </div>
              {msg.html ? (
                <iframe srcDoc={msg.html} className="h-[500px] w-full rounded-md border border-border bg-white" sandbox="" title={`message-${msg.id}`} />
              ) : (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Sem conteúdo HTML</div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {!analysis && !isAnalyzing && (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary/50" />
                <p className="mb-4 text-sm text-muted-foreground">Analise o copy, estrutura e efetividade deste e-mail com IA.</p>
                <Button onClick={() => analyzeMessage(msg)} disabled={!msg.html}>
                  <Sparkles className="mr-2 h-4 w-4" />Analisar este e-mail
                </Button>
              </div>
            )}

            {isAnalyzing && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />)}
              </div>
            )}

            {analysis && (
              <>
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Pontuação do E-mail</div>
                      <div className="mt-2 font-mono text-4xl font-semibold">
                        <span className={cn(analysis.score >= 70 ? "text-success" : analysis.score >= 40 ? "text-warning" : "text-destructive")}>
                          {analysis.score}
                        </span>
                        <span className="text-2xl text-muted-foreground">/100</span>
                      </div>
                    </div>
                    <ScoreRing score={analysis.score} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-success/30 bg-success/5 p-4">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />Pontos Fortes
                    </div>
                    <ul className="space-y-1.5">
                      {analysis.strengths.map((s, i) => <li key={i} className="text-xs text-foreground">{s}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-destructive">
                      <XCircle className="h-3.5 w-3.5" />Pontos Fracos
                    </div>
                    <ul className="space-y-1.5">
                      {analysis.weaknesses.map((w, i) => <li key={i} className="text-xs text-foreground">{w}</li>)}
                    </ul>
                  </div>
                </div>

                {analysis.suggestions.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold">Sugestões</span>
                    </div>
                    <div className="space-y-2">
                      {analysis.suggestions.map((r, idx) => <RecommendationCard key={idx} rec={r} compact />)}
                    </div>
                  </div>
                )}

                <Button variant="outline" size="sm" onClick={() => {
                  setAnalyses((prev) => { const next = { ...prev }; delete next[msg.id]; return next; });
                  analyzeMessage(msg);
                }}>
                  Reanalisar
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function RecommendationCard({ rec, compact }: { rec: Recommendation; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", compact ? "p-3" : "p-5")}>
      <div className="flex items-center gap-2">
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", PRI_COLORS[rec.priority] ?? PRI_COLORS.P3)}>{rec.priority}</span>
        <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-medium tracking-wider", CAT_COLORS[rec.category] ?? "bg-muted text-muted-foreground border-border")}>{rec.category}</span>
      </div>
      <h3 className={cn("font-semibold", compact ? "mt-1.5 text-xs" : "mt-3 text-sm")}>{rec.title}</h3>
      <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-[11px]" : "mt-1 text-xs")}>{rec.description}</p>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "oklch(0.72 0.18 145)" : score >= 40 ? "oklch(0.78 0.18 75)" : "oklch(0.65 0.22 25)";
  return (
    <svg width={72} height={72} className="-rotate-90">
      <circle cx={36} cy={36} r={r} fill="none" stroke="oklch(1 0 0 / 8%)" strokeWidth={6} />
      <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={6} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
    </svg>
  );
}

function CmpRow({ label, v, b, suffix, invert }: { label: string; v: number; b: number; suffix: string; invert?: boolean }) {
  const delta = v - b;
  const good = invert ? delta < 0 : delta > 0;
  return (
    <tr className="border-t border-border">
      <td className="px-5 py-3 font-sans">{label}</td>
      <td className="px-3 py-3 text-right tabular-nums">{v.toFixed(2)}{suffix}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{b.toFixed(2)}{suffix}</td>
      <td className={cn("px-5 py-3 text-right tabular-nums", good ? "text-success" : "text-destructive")}>
        {delta > 0 ? "+" : ""}{delta.toFixed(2)}{suffix}
      </td>
    </tr>
  );
}
