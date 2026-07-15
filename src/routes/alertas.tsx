import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useMemo } from "react";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import {
  Loader2, ChevronLeft, ChevronRight, Mail, Phone, Check,
  ArrowDown, ArrowUp, MessageCircle, ExternalLink, MousePointerClick, Search, X,
  Bell, Users, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listAlertasClientes, listCliquesAlertas, toggleAlertaContatado } from "@/lib/alertas.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ContatadoRow = {
  contact_id: string;
  contatado: boolean;
  contatado_em: string | null;
  followup_em: string | null;
  ultimo_followup_em: string | null;
};

function useContatados() {
  return useQuery({
    queryKey: ["contatados"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("alertas_contatos")
        .select("contact_id, contatado, contatado_em, followup_em, ultimo_followup_em");
      return (data ?? []) as ContatadoRow[];
    },
    refetchInterval: 5000,
  });
}

export const Route = createFileRoute("/alertas")({
  component: AlertasPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-background pl-[220px]">
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
    <div className="min-h-screen bg-background pl-[220px]">
      <AppHeader />
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* Page header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: "#0660FE20" }}>
            <Bell className="h-5 w-5" style={{ color: "#0660FE" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Alertas de Clientes</h1>
            <p className="text-sm text-muted-foreground">Monitore inativos, oportunidades e engajamento.</p>
          </div>
        </div>

        {/* KPI summary */}
        <div className="mb-7 grid gap-4 sm:grid-cols-3">
          <div className="relative overflow-hidden rounded border border-border bg-card px-5 py-4" style={{ borderTopColor: "#f59e0b", borderTopWidth: "3px" }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#f59e0b" }} />
              15 dias sem operar
            </div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums leading-none text-foreground">—</div>
            <div className="mt-1 text-[11px] text-muted-foreground">clientes inativos</div>
          </div>
          <div className="relative overflow-hidden rounded border border-border bg-card px-5 py-4" style={{ borderTopColor: "#ef4444", borderTopWidth: "3px" }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: "#ef4444" }} />
              30 dias sem operar
            </div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums leading-none text-foreground">—</div>
            <div className="mt-1 text-[11px] text-muted-foreground">risco elevado</div>
          </div>
          <div className="relative overflow-hidden rounded border border-border bg-card px-5 py-4" style={{ borderTopColor: "#0660FE", borderTopWidth: "3px" }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Users className="h-3.5 w-3.5" style={{ color: "#0660FE" }} />
              Oportunidades
            </div>
            <div className="mt-3 font-mono text-3xl font-bold tabular-nums leading-none text-foreground">—</div>
            <div className="mt-1 text-[11px] text-muted-foreground">valor aprovado + limite</div>
          </div>
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [contatoFiltro, setContatoFiltro] = useState<"todos"|"sem_contato"|"primeiro"|"followup"|"ultimo">("todos");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchFn  = useServerFn(listAlertasClientes);
  const toggleFn = useServerFn(toggleAlertaContatado);
  const queryClient = useQueryClient();
  const contatadosQ = useContatados();

  function handleSearch(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(value); setPage(1); }, 400);
  }

  const q = useQuery({
    queryKey: ["alertas", tab, page, sort, search],
    queryFn: () => fetchFn({ data: { tab, page, sort, search } }),
  });

  // Mapa de contatados do Supabase (atualizado a cada 5s independente do AC)
  const contatadosMap = useMemo(() => {
    const map = new Map<string, ContatadoRow>();
    for (const r of contatadosQ.data ?? []) {
      map.set(String(r.contact_id), r);
    }
    return map;
  }, [contatadosQ.data]);

  const toggleMutation = useMutation({
    mutationFn: (vars: { contactId: string; action: "check1"|"uncheck1"|"check2"|"uncheck2"|"check3"|"uncheck3"; razaoSocial?: string }) =>
      toggleFn({ data: { contactId: vars.contactId, action: vars.action } }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["contatados"] });
      const prev = queryClient.getQueryData<ContatadoRow[]>(["contatados"]);
      const now = new Date().toISOString();
      queryClient.setQueryData<ContatadoRow[]>(["contatados"], (old = []) => {
        const exists = old.find((r) => r.contact_id === vars.contactId);
        const updated: ContatadoRow = exists
          ? { ...exists }
          : { contact_id: vars.contactId, contatado: false, contatado_em: null, followup_em: null, ultimo_followup_em: null };
        if (vars.action === "check1")   { updated.contatado = true; updated.contatado_em = now; }
        if (vars.action === "uncheck1") { return old.filter((r) => r.contact_id !== vars.contactId); }
        if (vars.action === "check2")   { updated.followup_em = now; }
        if (vars.action === "uncheck2") { updated.followup_em = null; updated.ultimo_followup_em = null; }
        if (vars.action === "check3")   { updated.ultimo_followup_em = now; }
        if (vars.action === "uncheck3") { updated.ultimo_followup_em = null; }
        return exists ? old.map((r) => r.contact_id === vars.contactId ? updated : r) : [...old, updated];
      });
      if (vars.action === "check1") {
        toast.success(`${vars.razaoSocial || "Contato"} marcado — movido para o final da fila`);
      } else if (vars.action === "check2") {
        toast.success(`Follow-up registrado para ${vars.razaoSocial || "contato"}`);
      } else if (vars.action === "check3") {
        toast.success(`Último follow-up registrado para ${vars.razaoSocial || "contato"}`);
      }
      return { prev };
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(["contatados"], ctx.prev);
      alert(`Erro ao marcar contato: ${(err as Error).message}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["contatados"] }),
  });

  if (q.isLoading) return <SkeletonRows />;

  if (q.error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {(q.error as Error).message}
      </div>
    );
  }

  const rows = (q.data?.rows ?? []).map((r) => {
    const ct = contatadosMap.get(r.contactId);
    return ct ? {
      ...r,
      contatado: ct.contatado,
      contatadoEm: ct.contatado_em,
      followupEm: ct.followup_em ?? null,
      ultimoFollowupEm: ct.ultimo_followup_em ?? null,
    } : r;
  });

  const rowsSorted = [...rows].sort((a, b) => {
    const aChecked = a.contatado ? 1 : 0;
    const bChecked = b.contatado ? 1 : 0;
    if (aChecked !== bChecked) return aChecked - bChecked;
    if (!a.contatado) return 0;
    const aTime = a.contatadoEm ?? "";
    const bTime = b.contatadoEm ?? "";
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });

  const rowsOrdenados = rowsSorted.filter((r) => {
    if (contatoFiltro === "todos") return true;
    if (contatoFiltro === "sem_contato") return !r.contatado;
    if (contatoFiltro === "primeiro")   return r.contatado && !r.followupEm;
    if (contatoFiltro === "followup")   return !!r.followupEm && !r.ultimoFollowupEm;
    if (contatoFiltro === "ultimo")     return !!r.ultimoFollowupEm;
    return true;
  });

  return (
    <div>
      {/* Search bar */}
      <div className="mb-3 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Buscar por empresa, CNPJ, ID ou e-mail…"
          className="w-full rounded-md border border-border bg-background pl-9 pr-8 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => handleSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Filtro por estágio de contato — só para valor e limite */}
      {(mode === "valor" || mode === "limite") && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {([
            { key: "todos",       label: "Todos" },
            { key: "sem_contato", label: "Sem contato" },
            { key: "primeiro",    label: "1º Contato" },
            { key: "followup",    label: "Follow-up" },
            { key: "ultimo",      label: "Último follow-up" },
          ] as const).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setContatoFiltro(f.key)}
              className={[
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                contatoFiltro === f.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {rowsOrdenados.length} {rowsOrdenados.length === 1 ? "empresa" : "empresas"}
          {search && <span className="ml-1">· filtrado por "{search}"</span>}
          {contatoFiltro !== "todos" && <span className="ml-1">· {contatoFiltro === "sem_contato" ? "sem contato" : contatoFiltro === "primeiro" ? "1º contato feito" : contatoFiltro === "followup" ? "follow-up feito" : "último follow-up feito"}</span>}
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

      {rowsOrdenados.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          Nenhum cliente encontrado para este critério.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rowsOrdenados.map((r) => {
            const days = mode === "inativos" ? daysDiff(r.ultimaOperacao) : null;
            const accentBorder =
              tab === "sem_operar_15"     ? "border-l-amber-400"
              : tab === "sem_operar_30"   ? "border-l-red-400"
              : tab === "valor_aprovado"  ? "border-l-[#0660FE]"
              : "border-l-[#0660FE]";

            return (
              <div
                key={r.contactId}
                className={[
                  "relative flex flex-col gap-3 rounded-xl border border-border border-l-4 bg-card p-4 transition-shadow hover:shadow-md",
                  accentBorder,
                  r.ultimoFollowupEm ? "opacity-50" : r.followupEm ? "opacity-70" : r.contatado ? "opacity-85" : "",
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

                  {/* 3 checks progressivos */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Check 1 — primeiro contato */}
                    <button
                      type="button"
                      title={r.contatado ? "Desmarcar primeiro contato" : "Marcar como contatado"}
                      onClick={() => toggleMutation.mutate({ contactId: r.contactId, action: r.contatado ? "uncheck1" : "check1", razaoSocial: r.razaoSocial })}
                      className={[
                        "flex h-6 w-6 items-center justify-center rounded border transition-all",
                        r.contatado ? "border-success bg-success text-white" : "border-border bg-background text-transparent hover:border-foreground/50",
                      ].join(" ")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    {/* Check 2 — follow-up (só aparece após check 1) */}
                    {r.contatado && (
                      <button
                        type="button"
                        title={r.followupEm ? "Desmarcar follow-up" : "Marcar follow-up feito"}
                        onClick={() => toggleMutation.mutate({ contactId: r.contactId, action: r.followupEm ? "uncheck2" : "check2", razaoSocial: r.razaoSocial })}
                        className={[
                          "flex h-6 w-6 items-center justify-center rounded border transition-all",
                          r.followupEm ? "border-primary bg-primary text-white" : "border-border bg-background text-transparent hover:border-foreground/50",
                        ].join(" ")}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {/* Check 3 — último follow-up (só aparece após check 2) */}
                    {r.followupEm && (
                      <button
                        type="button"
                        title={r.ultimoFollowupEm ? "Desmarcar último follow-up" : "Marcar último follow-up feito"}
                        onClick={() => toggleMutation.mutate({ contactId: r.contactId, action: r.ultimoFollowupEm ? "uncheck3" : "check3", razaoSocial: r.razaoSocial })}
                        className={[
                          "flex h-6 w-6 items-center justify-center rounded border transition-all",
                          r.ultimoFollowupEm ? "border-warning bg-warning text-white" : "border-border bg-background text-transparent hover:border-foreground/50",
                        ].join(" ")}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Status de contatos */}
                <div className="flex flex-col gap-0.5">
                  {r.contatado && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-success">
                      <Check className="h-3 w-3" />
                      Contatado{r.contatadoEm ? ` em ${fmtDate(r.contatadoEm)}` : ""}
                    </div>
                  )}
                  {r.followupEm && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                      <Check className="h-3 w-3" />
                      Follow-up em {fmtDate(r.followupEm)}
                    </div>
                  )}
                  {r.ultimoFollowupEm && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
                      <Check className="h-3 w-3" />
                      Último follow-up em {fmtDate(r.ultimoFollowupEm)}
                    </div>
                  )}
                </div>

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
                      <span className="font-semibold text-sm text-success">{fmtMoney(r.valorAprovadoNaoOperado)}</span>
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
                      <div className="text-lg font-bold text-primary">{fmtMoney(r.limiteDisponivel)}</div>
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

type CliqueRaw = { razaoSocial: string; clienteId: string; cnpj: string; email: string; phone: string; contactId: string; clicadoEm: string };

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
                    <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2 text-xs font-medium text-success">
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
                    <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2 text-xs font-medium text-primary">
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
    <div className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {c.razaoSocial || c.email || c.contactId}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0 text-xs text-muted-foreground">
          {c.clienteId && <span>ID {c.clienteId}</span>}
          {c.cnpj && <span>{c.cnpj}</span>}
        </div>
        {(c.email || c.phone) && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {c.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3 shrink-0" />{c.email}
              </span>
            )}
            {c.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3 shrink-0" />{c.phone}
              </span>
            )}
          </div>
        )}
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
