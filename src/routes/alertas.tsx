import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import {
  Loader2, ChevronLeft, ChevronRight, Mail, Phone, Check,
  ArrowDown, ArrowUp, MessageCircle, ExternalLink, MousePointerClick,
} from "lucide-react";
import { listAlertasClientes, listCliquesAlertas, toggleAlertaContatado } from "@/lib/alertas.functions";

export const Route = createFileRoute("/alertas")({
  component: AlertasPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-destructive">{error.message}</div>
    </div>
  ),
  notFoundComponent: () => <div>Não encontrado</div>,
});

type TabKey = "sem_operar_15" | "sem_operar_30" | "valor_aprovado" | "limite_disponivel" | "cliques";

const TABS: { key: TabKey; label: string }[] = [
  { key: "sem_operar_15",    label: "15 dias sem operar" },
  { key: "sem_operar_30",    label: "30 dias sem operar" },
  { key: "valor_aprovado",   label: "Valor aprovado não operado" },
  { key: "limite_disponivel",label: "Limite disponível" },
  { key: "cliques",          label: "Cliques em e-mail" },
];

// ─── Formatters ─────────────────────────────────────────────────────────────

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

// ─── Page ───────────────────────────────────────────────────────────────────

function AlertasPage() {
  const [tab, setTab] = useState<TabKey>("sem_operar_15");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* Page header */}
        <div className="mb-7 border-b border-border pb-5">
          <h1 className="text-lg font-semibold text-foreground">Alertas de Clientes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Monitore clientes inativos, oportunidades e engajamento com e-mails.
          </p>
        </div>

        {/* Underline tabs */}
        <div className="mb-6 border-b border-border">
          <nav className="-mb-px flex overflow-x-auto">
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

        {/* Tab content */}
        {tab === "sem_operar_15"     && <ClientesTab key="15"    tab="sem_operar_15"     mode="inativos" />}
        {tab === "sem_operar_30"     && <ClientesTab key="30"    tab="sem_operar_30"     mode="inativos" />}
        {tab === "valor_aprovado"    && <ClientesTab key="valor" tab="valor_aprovado"    mode="valor"    />}
        {tab === "limite_disponivel" && <ClientesTab key="lim"   tab="limite_disponivel" mode="limite"   />}
        {tab === "cliques"           && <CliquesTab />}
      </div>
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
          <div className="h-3 w-3 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 rounded bg-muted" />
            <div className="h-2.5 w-1/2 rounded bg-muted" />
          </div>
          <div className="h-3 w-20 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ─── Pager ──────────────────────────────────────────────────────────────────

function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span>{total} {total === 1 ? "empresa" : "empresas"} · página {page} de {pages}</span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Próxima
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── ClientesTab ─────────────────────────────────────────────────────────────

function ClientesTab({
  tab,
  mode,
}: {
  tab: "sem_operar_15" | "sem_operar_30" | "valor_aprovado" | "limite_disponivel";
  mode: "inativos" | "valor" | "limite";
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const fetchFn  = useServerFn(listAlertasClientes);
  const toggleFn = useServerFn(toggleAlertaContatado);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["alertas", tab, page, sort],
    queryFn: () => fetchFn({ data: { tab, page, sort } }),
    refetchInterval: 15 * 1000, // verifica status "contatado" da equipe a cada 15s
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { contactId: string; contatado: boolean }) => toggleFn({ data: vars }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["alertas", tab, page, sort] });
      const previous = queryClient.getQueryData(["alertas", tab, page, sort]);
      queryClient.setQueryData(["alertas", tab, page, sort], (old: any) => {
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
      if (ctx?.previous) queryClient.setQueryData(["alertas", tab, page, sort], ctx.previous);
      alert(`Erro ao marcar contato: ${(err as Error).message}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["alertas", tab] }),
  });

  if (q.isLoading) return <SkeletonRows />;

  if (q.error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {(q.error as Error).message}
      </div>
    );
  }

  const rows = q.data?.rows ?? [];

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {q.data?.total ?? 0} {(q.data?.total ?? 0) === 1 ? "empresa" : "empresas"}
        </span>

        {mode === "inativos" && (
          <div className="flex items-center gap-1">
            <span className="mr-2 text-xs text-muted-foreground">Ordenar:</span>
            <button
              type="button"
              onClick={() => { setSort("desc"); setPage(1); }}
              className={[
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors",
                sort === "desc"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <ArrowDown className="h-3 w-3" /> Mais dias primeiro
            </button>
            <button
              type="button"
              onClick={() => { setSort("asc"); setPage(1); }}
              className={[
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors",
                sort === "asc"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <ArrowUp className="h-3 w-3" /> Menos dias primeiro
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          Nenhum cliente encontrado para este critério.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const days = mode === "inativos" ? daysDiff(r.ultimaOperacao) : null;
            const accentBorder =
              tab === "sem_operar_15"     ? "border-l-amber-400"
              : tab === "sem_operar_30"   ? "border-l-red-500"
              : tab === "valor_aprovado"  ? "border-l-emerald-500"
              : "border-l-blue-500";

            return (
              <div
                key={r.contactId}
                className={[
                  "relative flex flex-col gap-3 rounded-xl border border-border border-l-4 bg-card p-4 transition-shadow hover:shadow-md",
                  accentBorder,
                  r.contatado ? "opacity-60" : "",
                ].join(" ")}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-sm leading-tight">{r.razaoSocial || "Empresa sem nome"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.clienteId ? `ID ${r.clienteId}` : ""}
                      {r.clienteId && r.cnpj ? " · " : ""}
                      {r.cnpj ?? ""}
                      {!r.clienteId && !r.cnpj ? "Sem identificação" : ""}
                    </p>
                  </div>

                  {/* Contatado toggle */}
                  <button
                    type="button"
                    title={r.contatado ? "Desmarcar como contatado" : "Marcar como contatado"}
                    onClick={() => toggleMutation.mutate({ contactId: r.contactId, contatado: !r.contatado })}
                    className={[
                      "shrink-0 flex h-6 w-6 items-center justify-center rounded border transition-all",
                      r.contatado
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border bg-background text-transparent hover:border-foreground/50",
                    ].join(" ")}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>

                {r.contatado && (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <Check className="h-3 w-3" />
                    Contatado{r.contatadoEm ? ` em ${fmtDate(r.contatadoEm)}` : ""}
                  </div>
                )}

                {/* Key metric */}
                {mode === "inativos" && (
                  <div className="flex items-end justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <div>
                      <div className="text-2xl font-bold tabular-nums leading-none">{days ?? "?"}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">dias sem operar</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>Última operação</div>
                      <div className="font-medium text-foreground">{fmtDate(r.ultimaOperacao)}</div>
                    </div>
                  </div>
                )}
                {mode === "valor" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                      <span className="text-xs text-muted-foreground">Aprovado não operado</span>
                      <span className="font-semibold text-sm text-emerald-600">{fmtMoney(r.valorAprovadoNaoOperado)}</span>
                    </div>
                    {r.limiteDisponivel > 0 && (
                      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                        <span className="text-xs text-muted-foreground">Limite disponível</span>
                        <span className="text-sm font-medium">{fmtMoney(r.limiteDisponivel)}</span>
                      </div>
                    )}
                  </div>
                )}
                {mode === "limite" && (
                  <div className="flex items-end justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <div>
                      <div className="text-lg font-bold text-blue-600">{fmtMoney(r.limiteDisponivel)}</div>
                      <div className="text-[11px] text-muted-foreground">limite disponível</div>
                    </div>
                  </div>
                )}

                {/* Contact info */}
                {(r.email || r.phone) && (
                  <div className="space-y-1 border-t border-border pt-2">
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
            );
          })}
        </div>
      )}

      {(q.data?.total ?? 0) > (q.data?.pageSize ?? 25) && (
        <Pager
          page={page}
          total={q.data?.total ?? 0}
          pageSize={q.data?.pageSize ?? 25}
          onChange={setPage}
        />
      )}
    </div>
  );
}

// ─── CliquesTab ──────────────────────────────────────────────────────────────

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

function CliquesTab() {
  const [page, setPage] = useState(1);
  const fetchFn = useServerFn(listCliquesAlertas);
  const q = useQuery({
    queryKey: ["cliques-alertas", page],
    queryFn: () => fetchFn({ data: { page } }),
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Varrendo campanhas dos últimos 60 dias…
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {(q.error as Error).message}
      </div>
    );
  }

  const campanhas = q.data?.campanhas ?? [];

  return (
    <div className="space-y-3">
      {/* Meta info */}
      {q.data && (
        <p className="text-xs text-muted-foreground">
          {q.data.campanhasEscaneadas} campanhas verificadas · últimos 60 dias
          {q.data.campanhasComErro > 0 && ` · ${q.data.campanhasComErro} com erro`}
        </p>
      )}

      {campanhas.length === 0 ? (
        <div className="rounded-md border border-border px-6 py-16 text-center text-sm text-muted-foreground">
          Nenhum clique em link de WhatsApp ou Portal encontrado nos últimos 60 dias.
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {campanhas.map((camp) => (
              <div key={camp.campanhaId} className="rounded-md border border-border">
                {/* Campaign header */}
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground">{camp.campanhaNome}</span>
                  <span className="text-xs text-muted-foreground">Enviada em {fmtDate(camp.sdate)}</span>
                </div>

                {/* WhatsApp clicks */}
                {camp.whatsapp.length > 0 && (
                  <div className="border-b border-border last:border-0">
                    <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2 text-xs font-medium text-emerald-600">
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {dedupeClientes(camp.whatsapp).length} {dedupeClientes(camp.whatsapp).length === 1 ? "cliente" : "clientes"}
                      </span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {dedupeClientes(camp.whatsapp).map((c) => (
                        <CliqueRow key={c.contactId} c={c} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Portal clicks */}
                {camp.portal.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2 text-xs font-medium text-blue-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Portal
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {dedupeClientes(camp.portal).length} {dedupeClientes(camp.portal).length === 1 ? "cliente" : "clientes"}
                      </span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {dedupeClientes(camp.portal).map((c) => (
                        <CliqueRow key={c.contactId} c={c} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(q.data?.total ?? 0) > (q.data?.pageSize ?? 10) && (
            <Pager
              page={page}
              total={q.data?.total ?? 0}
              pageSize={q.data?.pageSize ?? 10}
              onChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

function CliqueRow({ c }: { c: CliqueRaw & { cliques: number } }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {c.razaoSocial || c.email || c.contactId}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0 text-xs text-muted-foreground">
          {c.clienteId && <span>ID {c.clienteId}</span>}
          {c.cnpj && <span>{c.cnpj}</span>}
          {c.email && !c.razaoSocial && <span>{c.email}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs text-muted-foreground">{fmtDate(c.clicadoEm)}</div>
        {c.cliques > 1 && (
          <div className="flex items-center justify-end gap-0.5 text-[11px] font-medium text-foreground">
            <MousePointerClick className="h-3 w-3" />
            {c.cliques}x
          </div>
        )}
      </div>
    </div>
  );
}
