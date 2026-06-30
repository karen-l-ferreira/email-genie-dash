import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader } from "@/components/app/Header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ChevronLeft, ChevronRight, Bell, Building2, Mail, Phone, Clock, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { listAlertasClientes, listAlertasEnviados, toggleAlertaContatado } from "@/lib/alertas.functions";

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alertas", tab] }),
    onError: (err) => {
      // eslint-disable-next-line no-alert
      alert(`Erro ao marcar contato: ${(err as Error).message}`);
    },
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
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [applied, setApplied] = useState<{ dataInicio?: string; dataFim?: string }>({});
  const fetchFn = useServerFn(listAlertasEnviados);
  const q = useQuery({
    queryKey: ["alertas-enviados", page, applied],
    queryFn: () => fetchFn({ data: { page, ...applied } }),
  });

  function applyFilter() {
    setPage(1);
    setApplied({
      dataInicio: dataInicio || undefined,
      dataFim: dataFim ? new Date(dataFim + "T23:59:59").toISOString() : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">De</label>
          <Input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilter()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Até</label>
          <Input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilter()}
          />
        </div>
        <Button onClick={applyFilter}>Filtrar</Button>
        {(applied.dataInicio || applied.dataFim) && (
          <Button
            variant="ghost"
            onClick={() => {
              setDataInicio(""); setDataFim(""); setApplied({}); setPage(1);
            }}
          >
            Limpar
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : q.error ? (
        <div className="py-10 text-sm text-destructive">{(q.error as Error).message}</div>
      ) : (q.data?.rows ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-20 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhum alerta encontrado</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>E-mail enviado</TableHead>
                <TableHead>Data envio</TableHead>
                <TableHead>Clicou WhatsApp?</TableHead>
                <TableHead>Clicou Portal?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.cliente_nome || r.cliente_id}</TableCell>
                  <TableCell className="text-xs">{r.email_destino}</TableCell>
                  <TableCell>{fmtDate(r.data_envio)}</TableCell>
                  <TableCell><ClickBadge ts={r.link_whatsapp_clicado} /></TableCell>
                  <TableCell><ClickBadge ts={r.link_portal_clicado} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-4 pb-4">
            <Pager page={page} total={q.data?.total ?? 0} pageSize={q.data?.pageSize ?? 20} onChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}

function ClickBadge({ ts }: { ts: string | null }) {
  if (ts) {
    return (
      <Badge className="border-success/30 bg-success/15 text-success hover:bg-success/15">
        Sim em {fmtDate(ts)}
      </Badge>
    );
  }
  return (
    <Badge className="border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/15">
      Não
    </Badge>
  );
}
