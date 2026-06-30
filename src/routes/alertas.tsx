import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader } from "@/components/app/Header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, Bell, Building2, Mail, Phone, Clock, TrendingUp, AlertTriangle, CheckCircle2, MessageCircle, ExternalLink, MousePointerClick } from "lucide-react";
import { listAlertasClientes, listCliquesAlertas, toggleAlertaContatado } from "@/lib/alertas.functions";

export const Route = createFileRoute("/alertas")({
  component: AlertasPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-10 text-sm text-destructive">{error.message}</div>
    </div>
  ),
  notFoundComponent: () => <div>Não encontrado</div>,
});

type TabKey = "sem_operar_15" | "sem_operar_30" | "valor_aprovado" | "cliques";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}
function fmtMoney(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function daysDiff(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function AlertasPage() {
  const [tab, setTab] = useState<TabKey>("sem_operar_15");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
            <p className="text-sm text-muted-foreground">Clientes inativos, oportunidades aprovadas e cliques em alertas enviados.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="sem_operar_15">15 dias sem operar</TabsTrigger>
            <TabsTrigger value="sem_operar_30">30 dias sem operar</TabsTrigger>
            <TabsTrigger value="valor_aprovado">Valor Aprovado Não Operado</TabsTrigger>
            <TabsTrigger value="cliques">Alertas de Clique</TabsTrigger>
          </TabsList>

          <TabsContent value="sem_operar_15" className="mt-6">
            <ClientesTab tab="sem_operar_15" mode="inativos" />
          </TabsContent>
          <TabsContent value="sem_operar_30" className="mt-6">
            <ClientesTab tab="sem_operar_30" mode="inativos" />
          </TabsContent>
          <TabsContent value="valor_aprovado" className="mt-6">
            <ClientesTab tab="valor_aprovado" mode="valor" />
          </TabsContent>
          <TabsContent value="cliques" className="mt-6">
            <CliquesTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
      <span>{total} {total === 1 ? "empresa" : "empresas"} • Página {page} de {pages}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Próxima <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="mb-3 flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2 mt-4">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
    </div>
  );
}

function ClientesTab({ tab, mode }: { tab: "sem_operar_15" | "sem_operar_30" | "valor_aprovado"; mode: "inativos" | "valor" }) {
  const [page, setPage] = useState(1);
  const fetchFn = useServerFn(listAlertasClientes);
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["alertas", tab, page],
    queryFn: () => fetchFn({ data: { tab, page } }),
  });

  const toggleFn = useServerFn(toggleAlertaContatado);
  const toggleMutation = useMutation({
    mutationFn: (vars: { contactId: string; contatado: boolean }) => toggleFn({ data: vars }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["alertas", tab, page] });
      const previous = queryClient.getQueryData(["alertas", tab, page]);
      queryClient.setQueryData(["alertas", tab, page], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((row: any) =>
            row.contactId === vars.contactId
              ? { ...row, contatado: vars.contatado, contatadoEm: vars.contatado ? new Date().toISOString() : null }
              : row,
          ),
        };
      });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["alertas", tab, page], ctx.previous);
      // eslint-disable-next-line no-alert
      alert(`Erro ao marcar contato: ${(err as Error).message}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["alertas", tab] }),
  });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (q.error) return <div className="py-10 text-sm text-destructive">{(q.error as Error).message}</div>;

  const rows = q.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Nenhum alerta encontrado</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const days = mode === "inativos" ? daysDiff(r.ultimaOperacao) : null;
          const badgeColor =
            tab === "sem_operar_15"
              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
              : tab === "sem_operar_30"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
          const badgeLabel =
            tab === "sem_operar_15"
              ? `${days ?? "?"} dias sem operar`
              : tab === "sem_operar_30"
              ? `${days ?? "?"} dias sem operar`
              : "Valor aprovado não operado";

          return (
            <div
              key={r.contactId}
              className={`group relative flex flex-col gap-4 rounded-xl border p-5 shadow-sm transition-shadow hover:shadow-md ${
                r.contatado ? "border-emerald-500/30 bg-emerald-500/5 opacity-70" : "border-border bg-card"
              }`}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">{r.razaoSocial || "Empresa sem nome"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.clienteId ? `ID: ${r.clienteId}` : ""}
                    {r.clienteId && r.cnpj ? " · " : ""}
                    {r.cnpj ? `CNPJ: ${r.cnpj}` : ""}
                    {!r.clienteId && !r.cnpj ? "Sem identificação" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  title="Marcar como contatado"
                  onClick={() => {
                    console.log("toggle click", r.contactId, !r.contatado);
                    toggleMutation.mutate({ contactId: r.contactId, contatado: !r.contatado });
                  }}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    r.contatado
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border bg-background text-transparent hover:border-primary"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </div>

              {r.contatado && (
                <div className="-mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Contatado {r.contatadoEm ? `em ${fmtDate(r.contatadoEm)}` : ""}
                </div>
              )}

              {/* Badge */}
              <Badge className={`self-start border text-xs font-medium ${badgeColor}`}>
                {tab !== "valor_aprovado" && <Clock className="mr-1 h-3 w-3" />}
                {tab === "valor_aprovado" && <TrendingUp className="mr-1 h-3 w-3" />}
                {badgeLabel}
              </Badge>

              {/* Info */}
              {mode === "inativos" ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Última operação</span>
                    <span className="font-medium">{fmtDate(r.ultimaOperacao)}</span>
                  </div>
                  {(r.email || r.phone) && (
                    <div className="space-y-1">
                      {r.email && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.email}</span>
                        </div>
                      )}
                      {r.phone && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{r.phone}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Valor aprovado não operado</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(r.valorAprovadoNaoOperado)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Limite disponível</span>
                    <span className="font-medium">{fmtMoney(r.limiteDisponivel)}</span>
                  </div>
                  {(r.email || r.phone) && (
                    <div className="space-y-1 pt-1">
                      {r.email && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.email}</span>
                        </div>
                      )}
                      {r.phone && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{r.phone}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pager page={page} total={q.data?.total ?? 0} pageSize={q.data?.pageSize ?? 20} onChange={setPage} />
    </div>
  );
}

function CliquesTab() {
  const [page, setPage] = useState(1);
  const fetchFn = useServerFn(listCliquesAlertas);
  const q = useQuery({
    queryKey: ["cliques-alertas", page],
    queryFn: () => fetchFn({ data: { page } }),
  });

  return (
    <div className="space-y-4">
      {q.data && (
        <p className="text-xs text-muted-foreground">
          Últimos 60 dias · {q.data.campanhasEscaneadas} campanhas verificadas
          {q.data.campanhasComErro > 0 ? ` · ${q.data.campanhasComErro} com erro ao consultar` : ""}
        </p>
      )}

      {q.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando… (varrendo campanhas dos últimos 60 dias)
        </div>
      ) : q.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{(q.error as Error).message}</div>
      ) : (q.data?.campanhas ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhum clique em link de WhatsApp/Portal encontrado nos últimos 60 dias</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {(q.data?.campanhas ?? []).map((camp) => (
              <div key={camp.campanhaId} className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">{camp.campanhaNome}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Enviada em {fmtDate(camp.sdate)}</p>
                  </div>
                </div>

                {camp.whatsapp.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-success">
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                      <span className="font-normal text-muted-foreground">· {dedupeClientes(camp.whatsapp).length} {dedupeClientes(camp.whatsapp).length === 1 ? "cliente" : "clientes"}</span>
                    </div>
                    <div className="space-y-1.5">
                      {dedupeClientes(camp.whatsapp).map((c) => <CliqueClienteItem key={c.contactId} c={c} />)}
                    </div>
                  </div>
                )}

                {camp.portal.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Portal
                      <span className="font-normal text-muted-foreground">· {dedupeClientes(camp.portal).length} {dedupeClientes(camp.portal).length === 1 ? "cliente" : "clientes"}</span>
                    </div>
                    <div className="space-y-1.5">
                      {dedupeClientes(camp.portal).map((c) => <CliqueClienteItem key={c.contactId} c={c} />)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Pager page={page} total={q.data?.total ?? 0} pageSize={q.data?.pageSize ?? 10} onChange={setPage} />
        </>
      )}
    </div>
  );
}

type CliqueRaw = { razaoSocial: string; clienteId: string; cnpj: string; email: string; contactId: string; clicadoEm: string };

function dedupeClientes(items: CliqueRaw[]): (CliqueRaw & { cliques: number })[] {
  const map = new Map<string, CliqueRaw & { cliques: number }>();
  for (const c of items) {
    const existing = map.get(c.contactId);
    if (!existing) {
      map.set(c.contactId, { ...c, cliques: 1 });
    } else {
      existing.cliques += 1;
      if (c.clicadoEm > existing.clicadoEm) existing.clicadoEm = c.clicadoEm;
    }
  }
  return [...map.values()].sort((a, b) => (a.clicadoEm < b.clicadoEm ? 1 : -1));
}

function CliqueClienteItem({ c }: { c: CliqueRaw & { cliques: number } }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-muted/50 px-2.5 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{c.razaoSocial || c.email || c.contactId}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {c.clienteId ? `ID: ${c.clienteId}` : ""}
          {c.clienteId && c.cnpj ? " · " : ""}
          {c.cnpj ? `CNPJ: ${c.cnpj}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] text-muted-foreground">{fmtDate(c.clicadoEm)}</span>
        {c.cliques > 1 && (
          <span className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
            <MousePointerClick className="h-2.5 w-2.5" /> {c.cliques}x
          </span>
        )}
      </div>
    </div>
  );
}

