import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns, type Campaign } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <AuthGate>
      <CampaignListPage />
    </AuthGate>
  ),
});

type SortKey = "open_rate" | "ctr" | "send_amt";

function CampaignListPage() {
  const navigate = useNavigate();
  const fetchSettings = useServerFn(getSettings);
  const fetchCampaigns = useServerFn(listCampaigns);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => fetchCampaigns(),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  useEffect(() => {
    if (settingsQ.data && !settingsQ.data.hasApiKey) {
      navigate({ to: "/settings" });
    }
  }, [settingsQ.data, navigate]);

  const [tab, setTab] = useState<"campaigns" | "history">("campaigns");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"sent" | "drafts">("sent");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "send_amt",
    dir: "desc",
  });

  const all = campaignsQ.data?.campaigns ?? [];
  const sentCount = all.filter((c) => c.send_amt > 0).length;
  const draftCount = all.length - sentCount;

  const rows = useMemo(() => {
    let list = all.filter((c) => (filter === "sent" ? c.send_amt > 0 : c.send_amt === 0));
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(s));
    }
    list = [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      return sort.dir === "asc" ? va - vb : vb - va;
    });
    return list;
  }, [all, filter, search, sort]);

  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader campaignCount={all.length} />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="bg-surface">
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setFilter("sent")}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                  filter === "sent"
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                Sent ({sentCount})
              </button>
              <button
                onClick={() => setFilter("drafts")}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-xs font-medium transition-colors",
                  filter === "drafts"
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                Drafts ({draftCount})
              </button>
              <div className="relative ml-auto w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => campaignsQ.refetch()}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", campaignsQ.isFetching && "animate-spin")} />
                Refresh
              </Button>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Campaign</th>
                    <th className="px-3 py-3 text-left font-medium">Date</th>
                    <SortHeader k="send_amt" sort={sort} setSort={setSort}>Sends</SortHeader>
                    <SortHeader k="open_rate" sort={sort} setSort={setSort}>Open Rate</SortHeader>
                    <SortHeader k="ctr" sort={sort} setSort={setSort}>CTR</SortHeader>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {campaignsQ.isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                        Loading campaigns…
                      </td>
                    </tr>
                  ) : campaignsQ.isError ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center">
                        <p className="text-sm text-destructive">{(campaignsQ.error as Error).message}</p>
                        <Button asChild variant="outline" size="sm" className="mt-3">
                          <Link to="/settings"><SettingsIcon className="mr-1.5 h-4 w-4" />Check API key</Link>
                        </Button>
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">No campaigns.</td></tr>
                  ) : (
                    rows.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}
                        className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <StatusBadge status={c.status} />
                            <span className="font-medium">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-4 font-mono text-xs text-muted-foreground">
                          {c.sdate ? format(new Date(c.sdate), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="px-3 py-4 font-mono tabular-nums">{c.send_amt.toLocaleString()}</td>
                        <td className="px-3 py-4">
                          <RateCell value={c.open_rate} bench={benchOR} />
                        </td>
                        <td className="px-3 py-4">
                          <RateCell value={c.ctr} bench={benchCTR} />
                        </td>
                        <td className="px-3 py-4 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
              History view — chronological log of viewed and analyzed campaigns will appear here.
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SortHeader({ k, sort, setSort, children }: { k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; setSort: (s: any) => void; children: React.ReactNode }) {
  const active = sort.key === k;
  return (
    <th
      className="cursor-pointer select-none px-3 py-3 text-left font-medium hover:text-foreground"
      onClick={() => setSort(active ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" })}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </span>
    </th>
  );
}

function RateCell({ value, bench }: { value: number; bench: number }) {
  const above = value >= bench;
  return (
    <span className={cn("font-mono tabular-nums", above ? "text-success" : "text-destructive")}>
      {value.toFixed(1)}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    "0": { label: "Draft", cls: "bg-muted text-muted-foreground" },
    "1": { label: "Scheduled", cls: "bg-warning/15 text-warning" },
    "2": { label: "Sending", cls: "bg-primary/15 text-primary" },
    "3": { label: "Paused", cls: "bg-muted text-muted-foreground" },
    "4": { label: "Stopped", cls: "bg-destructive/15 text-destructive" },
    "5": { label: "Completed", cls: "bg-success/15 text-success" },
    "6": { label: "Disabled", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <Badge className={cn("border-transparent font-medium", m.cls)}>{m.label}</Badge>;
}
