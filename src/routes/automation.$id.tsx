import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getAutomation, getAutomationMessages, type AutomationEmail } from "@/lib/ac.functions";
import { getMessageAnalysis, generateEmailFromAnalysis, type MessageAnalysis, type GeneratedEmail } from "@/lib/ai.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { AutomationStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeft, CheckCircle2, Copy, Mail, RefreshCw, Sparkles, Wand2, X, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/automation/$id")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AutomationDetailPage />
    </AuthGate>
  ),
});

function hiddenKey(automationId: string) {
  return `automation_hidden_${automationId}`;
}

function AutomationDetailPage() {
  const { id } = Route.useParams();
  const fetchAutomation = useServerFn(getAutomation);
  const fetchMessages = useServerFn(getAutomationMessages);
  const fetchMsgAnalysis = useServerFn(getMessageAnalysis);
  const fetchGenerate = useServerFn(generateEmailFromAnalysis);

  const autoQ = useQuery({
    queryKey: ["automation", id],
    queryFn: () => fetchAutomation({ data: { id } }),
  });

  const messagesQ = useQuery({
    queryKey: ["automation-messages", id],
    enabled: !!autoQ.data,
    queryFn: () => fetchMessages({ data: { id } }),
  });

  const a = autoQ.data?.automation;
  const allMessages: AutomationEmail[] = (messagesQ.data?.messages ?? []) as AutomationEmail[];

  // Hidden campaign IDs stored in localStorage per automation
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(hiddenKey(id));
      if (stored) setHiddenIds(new Set(JSON.parse(stored)));
    } catch {}
  }, [id]);

  function hideEmail(campaignId: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(campaignId);
      localStorage.setItem(hiddenKey(id), JSON.stringify([...next]));
      return next;
    });
  }

  function restoreAll() {
    setHiddenIds(new Set());
    localStorage.removeItem(hiddenKey(id));
  }

  const messages = allMessages.filter((m) => !hiddenIds.has(m.campaignId));

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, MessageAnalysis>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedEmail | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const safeIdx = Math.min(selectedIdx, Math.max(0, messages.length - 1));
  const msg = messages[safeIdx];
  const analysis = msg ? analyses[msg.id] : undefined;

  async function analyze(refresh = false) {
    if (!msg) return;
    if (!refresh && (analyses[msg.id] || analyzing[msg.id])) return;
    setAnalyzing((p) => ({ ...p, [msg.id]: true }));
    try {
      const res = await fetchMsgAnalysis({ data: { campaign_id: id, message_id: msg.id, subject: msg.subject, html: msg.html, refresh } });
      setAnalyses((p) => ({ ...p, [msg.id]: res.analysis }));
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao analisar");
    } finally {
      setAnalyzing((p) => ({ ...p, [msg.id]: false }));
    }
  }

  async function generate() {
    if (!msg || !analysis) return;
    setGenerating(true);
    setGenerated(null);
    setGenerateError(null);
    setGenerateOpen(true);
    try {
      const res = await fetchGenerate({ data: { campaign_id: id, message_id: msg.id, subject: msg.subject, html: msg.html, analysis } });
      setGenerated(res);
    } catch (e: any) {
      setGenerateError(e?.message ?? "Erro ao gerar");
    } finally {
      setGenerating(false);
    }
  }

  if (autoQ.isLoading) return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-10 space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-surface" />
        <div className="h-40 animate-pulse rounded-xl bg-surface" />
      </div>
    </div>
  );

  if (autoQ.isError || !a) return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <p className="text-sm text-destructive">{(autoQ.error as Error)?.message ?? "Erro ao carregar"}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/automations"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8 space-y-8">

        {/* CabeÃ§alho */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{a.name}</h1>
              <AutomationStatusBadge status={a.status} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              ID {a.id}
              {a.mdate && ` â€¢ Modificado em ${format(new Date(a.mdate), "d 'de' MMM, yyyy", { locale: ptBR })}`}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/automations"><ArrowLeft className="mr-1.5 h-4 w-4" />AutomaÃ§Ãµes</Link>
          </Button>
        </div>

        {/* MÃ©tricas da automaÃ§Ã£o */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Entrou", value: a.entered },
            { label: "Ativo", value: a.active },
            { label: "Saiu", value: a.exited },
            { label: "ConclusÃ£o", value: `${a.completion_rate.toFixed(1)}%` },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className="mt-1 text-2xl font-semibold">{typeof m.value === "number" ? m.value.toLocaleString("pt-BR") : m.value}</div>
            </div>
          ))}
        </div>

        {/* MÃ©tricas agregadas dos emails da rÃ©gua */}
        {messages.length > 0 && (() => {
          const totalSends = messages.reduce((s, m) => s + m.sends, 0);
          const totalOpens = messages.reduce((s, m) => s + m.uniqueopens, 0);
          const totalClicks = messages.reduce((s, m) => s + m.linkclicks, 0);
          const totalUniqueClicks = messages.reduce((s, m) => s + m.uniquelinkclicks, 0);
          const avgOpenRate = messages.reduce((s, m) => s + m.open_rate, 0) / messages.length;
          const avgCtr = messages.reduce((s, m) => s + m.ctr, 0) / messages.length;
          return (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">MÃ©tricas da RÃ©gua</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: "Total enviados", value: totalSends.toLocaleString("pt-BR") },
                  { label: "Total aberturas", value: totalOpens.toLocaleString("pt-BR") },
                  { label: "Cliques totais", value: totalClicks.toLocaleString("pt-BR") },
                  { label: "Cliques Ãºnicos", value: totalUniqueClicks.toLocaleString("pt-BR") },
                  { label: "MÃ©dia abertura", value: `${avgOpenRate.toFixed(1)}%` },
                  { label: "MÃ©dia CTR", value: `${avgCtr.toFixed(1)}%` },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="text-[11px] text-muted-foreground">{stat.label}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* E-mails da automaÃ§Ã£o */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Mail className="h-4 w-4 text-primary" />
              E-mails desta automaÃ§Ã£o
              {messages.length > 0 && (
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">{messages.length}</span>
              )}
            </h2>
            {hiddenIds.size > 0 && (
              <button onClick={restoreAll} className="text-xs text-muted-foreground underline hover:text-foreground">
                Restaurar {hiddenIds.size} oculto{hiddenIds.size > 1 ? "s" : ""}
              </button>
            )}
          </div>

          {messagesQ.isLoading ? (
            <div className="space-y-3">{[0,1].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nenhum e-mail encontrado nesta automaÃ§Ã£o.
              {hiddenIds.size > 0 && (
                <div className="mt-3">
                  <button onClick={restoreAll} className="text-xs text-primary underline">Restaurar ocultos</button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Seletor de e-mail */}
              <div className="flex flex-wrap gap-2">
                {messages.map((m, i) => (
                  <div key={m.campaignId} className="group relative">
                    <button
                      onClick={() => { setSelectedIdx(i); setAnalyses({}); }}
                      className={cn(
                        "rounded-full border pl-4 pr-8 py-1.5 text-xs font-medium transition-colors",
                        safeIdx === i
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border bg-surface text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="font-semibold">{m.campaignName || `E-mail ${i + 1}`}</span>
                      {m.subject && <span className="ml-1 opacity-70">â€” {m.subject.slice(0, 30)}</span>}
                    </button>
                    <button
                      onClick={() => { hideEmail(m.campaignId); if (safeIdx >= i) setSelectedIdx(Math.max(0, safeIdx - 1)); }}
                      title="Ocultar este e-mail"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              {msg && (
                <>
                  {/* MÃ©tricas do email selecionado */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      { label: "Enviados", value: msg.sends.toLocaleString("pt-BR") },
                      { label: "Aberturas Ãºnicas", value: msg.uniqueopens.toLocaleString("pt-BR") },
                      { label: "Cliques totais", value: msg.linkclicks.toLocaleString("pt-BR") },
                      { label: "Cliques Ãºnicos", value: msg.uniquelinkclicks.toLocaleString("pt-BR") },
                      { label: "Taxa de abertura", value: `${msg.open_rate.toFixed(1)}%` },
                      { label: "CTR", value: `${msg.ctr.toFixed(1)}%` },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-border bg-card px-4 py-3">
                        <div className="text-[11px] text-muted-foreground">{stat.label}</div>
                        <div className="mt-0.5 text-lg font-semibold tabular-nums">{stat.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    {/* PrÃ©via */}
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Assunto</p>
                        <p className="mt-1 text-sm font-medium">{msg.subject || "(sem assunto)"}</p>
                        {msg.fromname && <p className="mt-1 text-xs text-muted-foreground">De: {msg.fromname} &lt;{msg.fromemail}&gt;</p>}
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(msg.html); toast.success("HTML copiado"); }}>
                            <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                          </Button>
                        </div>
                      </div>
                      {msg.html && (
                        <iframe srcDoc={msg.html} className="h-[500px] w-full rounded-xl border border-border bg-white" sandbox="" title={`msg-${msg.id}`} />
                      )}
                    </div>

                    {/* AnÃ¡lise IA */}
                    <div className="space-y-4">
                      {!analysis && !analyzing[msg.id] && (
                        <div className="rounded-xl border border-border bg-card p-8 text-center">
                          <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary/50" />
                          <p className="mb-4 text-sm text-muted-foreground">Analise copy, estrutura e efetividade com IA.</p>
                          <Button onClick={() => analyze()} disabled={!msg.html}>
                            <Sparkles className="mr-2 h-4 w-4" />Analisar e-mail
                          </Button>
                        </div>
                      )}

                      {analyzing[msg.id] && (
                        <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />)}</div>
                      )}

                      {analysis && (
                        <>
                          <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Score</p>
                              <p className={cn("mt-1 font-mono text-4xl font-semibold",
                                analysis.score >= 70 ? "text-success" : analysis.score >= 40 ? "text-warning" : "text-destructive")}>
                                {analysis.score}<span className="text-2xl text-muted-foreground">/100</span>
                              </p>
                            </div>
                          </div>

                          {analysis.strengths.length > 0 && (
                            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
                              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" />Pontos Fortes
                              </p>
                              <ul className="space-y-1">{analysis.strengths.map((s, i) => <li key={i} className="text-xs">{s}</li>)}</ul>
                            </div>
                          )}

                          {analysis.weaknesses.length > 0 && (
                            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-destructive">
                                <XCircle className="h-3.5 w-3.5" />Pontos Fracos
                              </p>
                              <ul className="space-y-1">{analysis.weaknesses.map((w, i) => <li key={i} className="text-xs">{w}</li>)}</ul>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => analyze(true)}>
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Reanalisar
                            </Button>
                            <Button size="sm" onClick={generate}>
                              <Wand2 className="mr-1.5 h-3.5 w-3.5" />Gerar novo e-mail
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <Sheet open={generateOpen} onOpenChange={(v) => { setGenerateOpen(v); if (!v) { setGenerateError(null); setGenerated(null); } }}>
        <SheetContent className="w-full overflow-y-auto bg-background sm:max-w-3xl">
          <SheetHeader><SheetTitle>E-mail Gerado pela IA</SheetTitle></SheetHeader>
          {generating ? (
            <div className="mt-8 space-y-3">
              <div className="h-8 w-1/2 animate-pulse rounded bg-surface" />
              <div className="h-64 animate-pulse rounded bg-surface" />
            </div>
          ) : generateError ? (
            <div className="mt-6 space-y-3">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{generateError}</div>
              <Button variant="outline" size="sm" onClick={generate}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Tentar novamente</Button>
            </div>
          ) : generated ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Novo assunto</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="flex-1 text-sm font-medium">{generated.subject}</p>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(generated.subject); toast.success("Copiado"); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex justify-between items-center">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">PrÃ©via</p>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(generated.html); toast.success("HTML copiado"); }}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />Copiar HTML
                  </Button>
                </div>
                <iframe srcDoc={generated.html} className="h-[520px] w-full rounded-md border border-border bg-white" sandbox="" title="generated" />
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

