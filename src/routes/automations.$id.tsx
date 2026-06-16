import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getAutomation, getAutomationMessages, saveSnapshot, listSnapshots, deleteSnapshot, type CampaignMessage, type MetricSnapshot } from "@/lib/ac.functions";
import { getAutomationRecommendations, getMessageAnalysis, generateEmailFromAnalysis, type AutomationRecommendation, type MessageAnalysis, type GeneratedEmail } from "@/lib/ai.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { MetricCard } from "@/components/app/MetricCard";
import { AutomationStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ArrowLeft, BookmarkPlus, CheckCircle2, Copy, Mail, RefreshCw, Sparkles, Trash2, Wand2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const fetchMessages = useServerFn(getAutomationMessages);
  const fetchMsgAnalysis = useServerFn(getMessageAnalysis);
  const fetchGenerate = useServerFn(generateEmailFromAnalysis);
  const fetchSaveSnapshot = useServerFn(saveSnapshot);
  const fetchListSnapshots = useServerFn(listSnapshots);
  const fetchDeleteSnapshot = useServerFn(deleteSnapshot);

  const autoQ = useQuery({ queryKey: ["automation", id], queryFn: () => fetchAutomation({ data: { id } }) });
  const messagesQ = useQuery({ queryKey: ["automation-messages", id], enabled: !!autoQ.data, queryFn: () => fetchMessages({ data: { id } }) });
  const snapshotsQ = useQuery({ queryKey: ["snapshots", id], queryFn: () => fetchListSnapshots({ data: { entity_id: id } }) });

  const a = autoQ.data?.automation;

  const [recsRefresh, setRecsRefresh] = useState(false);
  const recsQ = useQuery({
    queryKey: ["automation-recs", id, recsRefresh],
    enabled: !!a,
    queryFn: () => fetchRecs({ data: { automation_id: a!.id, name: a!.name, status: a!.status, entered: a!.entered, exited: a!.exited, active: a!.active, completion_rate: a!.completion_rate, refresh: recsRefresh } }),
  });

  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  async function handleSaveSnapshot() {
    if (!a || !snapshotLabel.trim()) return;
    setSavingSnapshot(true);
    try {
      await fetchSaveSnapshot({
        data: {
          label: snapshotLabel.trim(),
          entity_type: "automation",
          entity_id: a.id,
          entity_name: a.name,
          metrics: { entered: a.entered, exited: a.exited, active: a.active, completion_rate: a.completion_rate },
        },
      });
      toast.success("Régua salva com sucesso");
      setSnapshotLabel("");
      snapshotsQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    } finally {
      setSavingSnapshot(false);
    }
  }

  const deleteM = useMutation({
    mutationFn: (snapId: string) => fetchDeleteSnapshot({ data: { id: snapId } }),
    onSuccess: () => snapshotsQ.refetch(),
  });

  if (autoQ.isLoading || !a) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-[1400px] px-6 py-10">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-surface" />
          <div className="mt-8 grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8 space-y-8">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{a.name}</h1>
              <AutomationStatusBadge status={a.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>ID {a.id}</span>
              {a.createdate && <><span>•</span><span>Criado em {format(new Date(a.createdate), "d 'de' MMM, yyyy", { locale: ptBR })}</span></>}
              {a.mdate && <><span>•</span><span>Modificado em {format(new Date(a.mdate), "d 'de' MMM, yyyy", { locale: ptBR })}</span></>}
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/automations"><ArrowLeft className="mr-1.5 h-4 w-4" />Automações</Link>
          </Button>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Total de Entradas" value={a.entered.toLocaleString("pt-BR")} detail="contatos que iniciaram" />
          <MetricCard label="Ativos Agora" value={a.active.toLocaleString("pt-BR")} detail="atualmente no fluxo" />
          <MetricCard label="Total de Saídas" value={a.exited.toLocaleString("pt-BR")} detail="concluídos ou removidos" />
          <MetricCard label="Taxa de Conclusão" value={`${a.completion_rate.toFixed(1)}%`} detail={`${a.exited.toLocaleString("pt-BR")} / ${a.entered.toLocaleString("pt-BR")}`} variance={a.completion_rate - 50} />
        </div>

        {/* Funil */}
        {a.entered > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold">Funil de Contatos</h3>
            <div className="space-y-3">
              <FunnelBar label="Entraram" value={a.entered} max={a.entered} color="bg-primary" />
              <FunnelBar label="Ativos" value={a.active} max={a.entered} color="bg-chart-4" />
              <FunnelBar label="Saíram" value={a.exited} max={a.entered} color="bg-success" />
            </div>
          </div>
        )}

        {/* Abas */}
        <Tabs defaultValue="recs">
          <TabsList className="bg-surface">
            <TabsTrigger value="recs"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Recomendações</TabsTrigger>
            <TabsTrigger value="messages">
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              E-mails
              {(messagesQ.data?.messages.length ?? 0) > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{messagesQ.data!.messages.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="regua"><BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />Régua</TabsTrigger>
          </TabsList>

          {/* Recomendações */}
          <TabsContent value="recs" className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Recomendações de Melhoria por IA</h2>
              {recsQ.data && !recsQ.isLoading && (
                <Button variant="outline" size="sm" onClick={() => setRecsRefresh((v) => !v)} disabled={recsQ.isLoading}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Reanalisar
                </Button>
              )}
            </div>
            {recsQ.isLoading ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />)}
              </div>
            ) : recsQ.isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{(recsQ.error as Error).message}</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {(recsQ.data?.recommendations ?? []).map((r: AutomationRecommendation, idx: number) => (
                  <div key={idx} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", PRI_COLORS[r.priority] ?? PRI_COLORS.P3)}>{r.priority}</span>
                      <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-medium tracking-wider", CAT_COLORS[r.category] ?? "bg-muted text-muted-foreground border-border")}>{r.category}</span>
                    </div>
                    <h3 className="mt-3 text-sm font-semibold">{r.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* E-mails */}
          <TabsContent value="messages" className="mt-6">
            <MessagesTab
              campaignId={id}
              messages={messagesQ.data?.messages ?? []}
              isLoading={messagesQ.isLoading}
              fetchAnalysis={fetchMsgAnalysis as any}
              fetchGenerate={fetchGenerate as any}
            />
          </TabsContent>

          {/* Régua */}
          <TabsContent value="regua" className="mt-6">
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h3 className="text-sm font-semibold">Salvar snapshot atual</h3>
                <p className="text-xs text-muted-foreground">Salve as métricas de agora com um rótulo. Use antes e depois de uma alteração para comparar o impacto.</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ex: Antes de alterar o delay do step 3"
                    value={snapshotLabel}
                    onChange={(e) => setSnapshotLabel(e.target.value)}
                    className="max-w-md"
                    onKeyDown={(e) => e.key === "Enter" && handleSaveSnapshot()}
                  />
                  <Button onClick={handleSaveSnapshot} disabled={savingSnapshot || !snapshotLabel.trim()}>
                    <BookmarkPlus className="mr-1.5 h-4 w-4" />
                    {savingSnapshot ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </div>

              {snapshotsQ.isLoading ? (
                <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>
              ) : (snapshotsQ.data?.snapshots ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum snapshot salvo ainda.</div>
              ) : (
                <SnapshotTable snapshots={snapshotsQ.data!.snapshots} onDelete={(sid) => deleteM.mutate(sid)} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ─── Aba E-mails (reusável) ───────────────────────────────────────────────────

function MessagesTab({ campaignId, messages, isLoading, fetchAnalysis, fetchGenerate }: {
  campaignId: string;
  messages: CampaignMessage[];
  isLoading: boolean;
  fetchAnalysis: any;
  fetchGenerate: any;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, MessageAnalysis>>({});
  const [loadingMsg, setLoadingMsg] = useState<Record<string, boolean>>({});
  const [generatedEmail, setGeneratedEmail] = useState<GeneratedEmail | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const msg = messages[selectedIdx];
  const analysis = msg ? analyses[msg.id] : undefined;
  const isAnalyzing = msg ? loadingMsg[msg.id] : false;

  async function analyzeMessage(m: CampaignMessage, refresh = false) {
    if (!refresh && (analyses[m.id] || loadingMsg[m.id])) return;
    setLoadingMsg((p) => ({ ...p, [m.id]: true }));
    try {
      const res = await fetchAnalysis({ data: { campaign_id: campaignId, message_id: m.id, subject: m.subject, html: m.html, refresh } });
      setAnalyses((p) => ({ ...p, [m.id]: res.analysis }));
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao analisar");
    } finally {
      setLoadingMsg((p) => ({ ...p, [m.id]: false }));
    }
  }

  async function generateEmail(m: CampaignMessage, anal: MessageAnalysis) {
    setGenerating(true);
    setGeneratedEmail(null);
    setGenerateError(null);
    setGenerateOpen(true);
    try {
      const res = await fetchGenerate({ data: { campaign_id: campaignId, message_id: m.id, subject: m.subject, html: m.html, analysis: anal } });
      setGeneratedEmail(res);
    } catch (e: any) {
      setGenerateError(e?.message ?? "Erro ao gerar e-mail");
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading) return <div className="space-y-3 mt-2">{[0,1,2].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />)}</div>;

  if (messages.length === 0) return (
    <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
      Nenhum e-mail encontrado nesta automação.
    </div>
  );

  return (
    <div>
      {messages.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {messages.map((m, i) => (
            <button key={m.id} onClick={() => setSelectedIdx(i)}
              className={cn("rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                selectedIdx === i ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground")}>
              E-mail {i + 1}{m.subject ? ` — ${m.subject.slice(0, 30)}` : ""}
            </button>
          ))}
        </div>
      )}

      {msg && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assunto</div>
              <p className="mt-1 text-sm font-medium">{msg.subject || "(sem assunto)"}</p>
              {msg.fromname && <p className="mt-1 text-xs text-muted-foreground">De: {msg.fromname} &lt;{msg.fromemail}&gt;</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prévia do e-mail</div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(msg.html); toast.success("HTML copiado"); }}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                </Button>
              </div>
              {msg.html ? (
                <iframe srcDoc={msg.html} className="h-[500px] w-full rounded-md border border-border bg-white" sandbox="" title={`msg-${msg.id}`} />
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

            {isAnalyzing && <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />)}</div>}

            {analysis && (
              <>
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Pontuação do E-mail</div>
                      <div className="mt-2 font-mono text-4xl font-semibold">
                        <span className={cn(analysis.score >= 70 ? "text-success" : analysis.score >= 40 ? "text-warning" : "text-destructive")}>{analysis.score}</span>
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
                    <ul className="space-y-1.5">{analysis.strengths.map((s, i) => <li key={i} className="text-xs text-foreground">{s}</li>)}</ul>
                  </div>
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-destructive">
                      <XCircle className="h-3.5 w-3.5" />Pontos Fracos
                    </div>
                    <ul className="space-y-1.5">{analysis.weaknesses.map((w, i) => <li key={i} className="text-xs text-foreground">{w}</li>)}</ul>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => analyzeMessage(msg, true)}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Reanalisar
                  </Button>
                  <Button size="sm" onClick={() => generateEmail(msg, analysis)}>
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />Gerar novo e-mail
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Sheet open={generateOpen} onOpenChange={(v) => { setGenerateOpen(v); if (!v) setGenerateError(null); }}>
        <SheetContent className="w-full overflow-y-auto bg-background sm:max-w-3xl">
          <SheetHeader><SheetTitle>E-mail Gerado pela IA</SheetTitle></SheetHeader>
          {generating ? (
            <div className="mt-8 space-y-3">
              <div className="h-8 w-1/2 animate-pulse rounded bg-surface" />
              <div className="h-64 animate-pulse rounded bg-surface" />
            </div>
          ) : generateError ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{generateError}</div>
              <Button variant="outline" size="sm" onClick={() => msg && analysis && generateEmail(msg, analysis)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Tentar novamente
              </Button>
            </div>
          ) : generatedEmail ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Novo assunto</div>
                <div className="mt-2 flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">{generatedEmail.subject}</p>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(generatedEmail.subject); toast.success("Assunto copiado"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prévia</div>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(generatedEmail.html); toast.success("HTML copiado"); }}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                  </Button>
                </div>
                <iframe srcDoc={generatedEmail.html} className="h-[520px] w-full rounded-md border border-border bg-white" sandbox="" title="generated-email" />
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Snapshot table ───────────────────────────────────────────────────────────

function SnapshotTable({ snapshots, onDelete }: { snapshots: MetricSnapshot[]; onDelete: (id: string) => void }) {
  const METRIC_KEYS = ["entered", "exited", "active", "completion_rate", "open_rate", "ctr", "uniquelinkclicks", "send_amt"];
  const METRIC_LABELS: Record<string, string> = {
    entered: "Entradas", exited: "Saídas", active: "Ativos", completion_rate: "Conclusão %",
    open_rate: "Abertura %", ctr: "CTR %", uniquelinkclicks: "Cliques únicos", send_amt: "Envios",
  };

  const presentKeys = METRIC_KEYS.filter(k => snapshots.some(s => s.metrics[k] !== undefined));

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Rótulo</th>
            <th className="px-4 py-2.5 text-left font-medium">Data</th>
            {presentKeys.map(k => <th key={k} className="px-4 py-2.5 text-right font-medium">{METRIC_LABELS[k] ?? k}</th>)}
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s, i) => (
            <tr key={s.id} className={cn("border-t border-border", i % 2 === 1 && "bg-surface/40")}>
              <td className="px-4 py-3 font-medium">{s.label}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {format(new Date(s.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </td>
              {presentKeys.map(k => (
                <td key={k} className="px-4 py-3 text-right font-mono tabular-nums">
                  {s.metrics[k] !== undefined
                    ? typeof s.metrics[k] === "number" && (k.includes("rate") || k === "ctr" || k === "completion_rate")
                      ? `${Number(s.metrics[k]).toFixed(1)}%`
                      : Number(s.metrics[k]).toLocaleString("pt-BR")
                    : "—"}
                </td>
              ))}
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
