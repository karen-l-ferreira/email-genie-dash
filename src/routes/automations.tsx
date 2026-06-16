import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAutomations, type Automation } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { AutomationStatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, Download, GitBranch, RefreshCw, Search, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function exportAutomationsCSV(automations: Automation[]) {
  const header = ["Nome", "Status", "Entrou", "Ativo", "Saiu", "Conclusão %", "Últ. Modificação"];
  const rows = automations.map((a) => [
    `"${a.name.replace(/"/g, '""')}"`,
    a.status,
    a.entered,
    a.active,
    a.exited,
    a.completion_rate.toFixed(2),
    a.mdate ? format(new Date(a.mdate), "dd/MM/yyyy", { locale: ptBR }) : "",
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `automacoes_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export const Route = createFileRoute("/automations")({
  ssr: false,
  component: () => (
    <AuthGate>
      <AutomationsPage />
    </AuthGate>
  ),
});

type FilterType = "all" | "active" | "inactive";

function AutomationsPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const fetchAutomations = useServerFn(listAutomations);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const automationsQ = useQuery({
    queryKey: ["automations"],
    queryFn: () => fetchAutomations(),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const all: Automation[] = automationsQ.data?.automations ?? [];
  const activeCount = all.filter((a) => a.status === "active").length;
  const inactiveCount = all.filter((a) => a.status !== "active").length;

  const rows = useMemo(() => {
    let list = all;
    if (filter === "active") list = list.filter((a) => a.status === "active");
    if (filter === "inactive") list = list.filter((a) => a.status !== "active");
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(s));
    }
    return list;
  }, [all, filter, search]);

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: `Todas (${all.length})` },
    { key: "active", label: `Ativas (${activeCount})` },
    { key: "inactive", label: `Inativas (${inactiveCount})` },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Automações</h1>
            <p className="text-sm text-muted-foreground">Analise os fluxos de automação do ActiveCampaign</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="relative ml-auto w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar automações…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => automationsQ.refetch()}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", automationsQ.isFetching && "animate-spin")} />
            Atualizar
          </Button>
          {all.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportAutomationsCSV(all)}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
          )}
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Automação</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Entrou</th>
                <th className="px-3 py-3 text-right font-medium">Ativo</th>
                <th className="px-3 py-3 text-right font-medium">Saiu</th>
                <th className="px-3 py-3 text-right font-medium">Conclusão</th>
                <th className="px-3 py-3 text-right font-medium">Últ. Modificação</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {automationsQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-muted-foreground">
                    Carregando automações…
                  </td>
                </tr>
              ) : automationsQ.isError ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <p className="text-sm text-destructive">{(automationsQ.error as Error).message}</p>
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <Link to="/settings">
                        <SettingsIcon className="mr-1.5 h-4 w-4" />Verificar chave de API
                      </Link>
                    </Button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-muted-foreground">
                    Nenhuma automação encontrada.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate({ to: "/automation/$id", params: { id: a.id } })}
                    className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                  >
                    <td className="px-5 py-4 font-medium">{a.name}</td>
                    <td className="px-3 py-4">
                      <AutomationStatusBadge status={a.status} />
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums">{a.entered.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums text-primary">
                      {a.active.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums text-muted-foreground">
                      {a.exited.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums">
                      <CompletionCell rate={a.completion_rate} />
                    </td>
                    <td className="px-3 py-4 text-right font-mono text-xs text-muted-foreground">
                      {a.mdate ? format(new Date(a.mdate), "d 'de' MMM, yyyy", { locale: ptBR }) : "—"}
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
      </main>
    </div>
  );
}

function CompletionCell({ rate }: { rate: number }) {
  return (
    <span className={cn("tabular-nums", rate >= 50 ? "text-success" : rate > 0 ? "text-muted-foreground" : "text-destructive/60")}>
      {rate.toFixed(1)}%
    </span>
  );
}
