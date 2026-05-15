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
import { ChevronRight, GitBranch, RefreshCw, Search, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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
    { key: "all", label: `All (${all.length})` },
    { key: "active", label: `Active (${activeCount})` },
    { key: "inactive", label: `Inactive (${inactiveCount})` },
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
            <h1 className="text-2xl font-semibold">Automations</h1>
            <p className="text-sm text-muted-foreground">Analyze your ActiveCampaign automation flows</p>
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
              placeholder="Search automations…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => automationsQ.refetch()}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", automationsQ.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Automation</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Entered</th>
                <th className="px-3 py-3 text-right font-medium">Active</th>
                <th className="px-3 py-3 text-right font-medium">Exited</th>
                <th className="px-3 py-3 text-right font-medium">Completion</th>
                <th className="px-3 py-3 text-right font-medium">Last Modified</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {automationsQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-muted-foreground">
                    Loading automations…
                  </td>
                </tr>
              ) : automationsQ.isError ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <p className="text-sm text-destructive">{(automationsQ.error as Error).message}</p>
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <Link to="/settings">
                        <SettingsIcon className="mr-1.5 h-4 w-4" />Check API key
                      </Link>
                    </Button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-muted-foreground">
                    No automations found.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => navigate({ to: "/automations/$id", params: { id: a.id } })}
                    className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                  >
                    <td className="px-5 py-4 font-medium">{a.name}</td>
                    <td className="px-3 py-4">
                      <AutomationStatusBadge status={a.status} />
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums">{a.entered.toLocaleString()}</td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums text-primary">
                      {a.active.toLocaleString()}
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums text-muted-foreground">
                      {a.exited.toLocaleString()}
                    </td>
                    <td className="px-3 py-4 text-right font-mono tabular-nums">
                      <CompletionCell rate={a.completion_rate} />
                    </td>
                    <td className="px-3 py-4 text-right font-mono text-xs text-muted-foreground">
                      {a.mdate ? format(new Date(a.mdate), "MMM d, yyyy") : "—"}
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
