import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader } from "@/components/app/Header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronLeft, ChevronRight, Bell } from "lucide-react";
import { listAlertasClientes, listAlertasEnviados } from "@/lib/alertas.functions";

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
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>{total} {total === 1 ? "registro" : "registros"} • Página {page} de {pages}</span>
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

function ClientesTab({ tab, mode }: { tab: "sem_operar_15" | "sem_operar_30" | "valor_aprovado"; mode: "inativos" | "valor" }) {
  const [page, setPage] = useState(1);
  const fetchFn = useServerFn(listAlertasClientes);
  const q = useQuery({
    queryKey: ["alertas", tab, page],
    queryFn: () => fetchFn({ data: { tab, page } }),
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }
  if (q.error) return <div className="py-10 text-sm text-destructive">{(q.error as Error).message}</div>;

  const rows = q.data?.rows ?? [];
  if (rows.length === 0) {
    return <div className="rounded-lg border border-border bg-surface py-16 text-center text-sm text-muted-foreground">Nenhum alerta encontrado</div>;
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Empresa</TableHead>
            <TableHead>ID Cliente</TableHead>
            <TableHead>CNPJ</TableHead>
            {mode === "inativos" ? (
              <>
                <TableHead>Última Operação</TableHead>
                <TableHead>Entre em contato</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-right">Valor Aprovado Não Operado</TableHead>
                <TableHead className="text-right">Limite Disponível</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.contactId}>
              <TableCell className="font-medium">{r.razaoSocial || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{r.clienteId || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{r.cnpj || "—"}</TableCell>
              {mode === "inativos" ? (
                <>
                  <TableCell>{fmtDate(r.ultimaOperacao)}</TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {r.email && <div>{r.email}</div>}
                      {r.phone && <div className="text-muted-foreground">{r.phone}</div>}
                      {!r.email && !r.phone && "—"}
                    </div>
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-right font-mono">{fmtMoney(r.valorAprovadoNaoOperado)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(r.limiteDisponivel)}</TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="px-4 pb-4">
        <Pager page={page} total={q.data?.total ?? 0} pageSize={q.data?.pageSize ?? 20} onChange={setPage} />
      </div>
    </div>
  );
}

function CliquesTab() {
  const [page, setPage] = useState(1);
  const [cliente, setCliente] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [applied, setApplied] = useState<{ cliente?: string; dataInicio?: string; dataFim?: string }>({});
  const fetchFn = useServerFn(listAlertasEnviados);
  const q = useQuery({
    queryKey: ["alertas-enviados", page, applied],
    queryFn: () => fetchFn({ data: { page, ...applied } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Cliente</label>
          <Input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome ou ID" className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">De</label>
          <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Até</label>
          <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </div>
        <Button
          onClick={() => {
            setPage(1);
            setApplied({
              cliente: cliente || undefined,
              dataInicio: dataInicio || undefined,
              dataFim: dataFim ? new Date(dataFim + "T23:59:59").toISOString() : undefined,
            });
          }}
        >
          Filtrar
        </Button>
        {(applied.cliente || applied.dataInicio || applied.dataFim) && (
          <Button
            variant="ghost"
            onClick={() => {
              setCliente(""); setDataInicio(""); setDataFim(""); setApplied({}); setPage(1);
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
        <div className="rounded-lg border border-border bg-surface py-16 text-center text-sm text-muted-foreground">Nenhum alerta encontrado</div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
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
