import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getCampaign, listCampaigns } from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { getRecommendations, getVariations } from "@/lib/ai.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { MetricCard } from "@/components/app/MetricCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowLeft, Copy, Download, Sparkles } from "lucide-react";
import { format } from "date-fns";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/campaigns/$id")({
  ssr: false,
  component: () => (
    <AuthGate>
      <CampaignDetailPage />
    </AuthGate>
  ),
});

const CAT_COLORS: Record<string, string> = {
  CONTENT: "bg-primary/15 text-primary border-primary/30",
  SEGMENTATION: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  TIMING: "bg-warning/15 text-warning border-warning/30",
  CHANNEL: "bg-success/15 text-success border-success/30",
};
const PRI_COLORS: Record<string, string> = {
  P1: "bg-destructive text-destructive-foreground",
  P2: "bg-warning text-warning-foreground",
  P3: "bg-muted text-muted-foreground",
};

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const fetchCampaign = useServerFn(getCampaign);
  const fetchSettings = useServerFn(getSettings);
  const fetchAll = useServerFn(listCampaigns);
  const fetchRecs = useServerFn(getRecommendations);
  const fetchVars = useServerFn(getVariations);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const cQ = useQuery({ queryKey: ["campaign", id], queryFn: () => fetchCampaign({ data: { id } }) });
  const allQ = useQuery({ queryKey: ["campaigns"], queryFn: () => fetchAll() });

  const c = cQ.data?.campaign;
  const html = cQ.data?.html ?? "";
  const subject = cQ.data?.subject ?? "";
  const benchOR = settingsQ.data?.benchmark_open_rate ?? 22;
  const benchCTR = settingsQ.data?.benchmark_ctr ?? 2.9;

  const recsQ = useQuery({
    queryKey: ["recs", id],
    enabled: !!c && !!settingsQ.data,
    queryFn: () =>
      fetchRecs({
        data: {
          campaign_id: c!.id,
          name: c!.name,
          subject,
          open_rate: c!.open_rate,
          ctr: c!.ctr,
          send_amt: c!.send_amt,
          uniqueopens: c!.uniqueopens,
          uniquelinkclicks: c!.uniquelinkclicks,
          hardbounces: c!.hardbounces,
          unsubscribes: c!.unsubscribes,
          benchmark_open_rate: benchOR,
          benchmark_ctr: benchCTR,
        },
      }),
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const varsM = useMutation({
    mutationFn: () =>
      fetchVars({
        data: {
          campaign_id: id,
          subject,
          html,
          recommendations: recsQ.data?.recommendations ?? [],
        },
      }),
  });

  const trend = useMemo(() => {
    const list = (allQ.data?.campaigns ?? [])
      .filter((x) => x.send_amt > 0 && x.sdate)
      .sort((a, b) => new Date(a.sdate!).getTime() - new Date(b.sdate!).getTime())
      .slice(-10)
      .map((x) => ({ name: x.name.slice(0, 12), open: +x.open_rate.toFixed(1), bench: benchOR }));
    return list;
  }, [allQ.data, benchOR]);

  if (cQ.isLoading || !c) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="mx-auto max-w-[1400px] px-6 py-10">
          <div className="h-40 animate-pulse rounded-xl bg-surface" />
        </div>
      </div>
    );
  }

  const radar = [
    { axis: "Open Rate", value: Math.min(150, (c.open_rate / benchOR) * 100), bench: 100 },
    { axis: "CTR", value: Math.min(150, (c.ctr / benchCTR) * 100), bench: 100 },
    { axis: "Engagement", value: Math.min(150, (c.uniquelinkclicks / Math.max(1, c.send_amt)) * 100 * 10), bench: 100 },
    { axis: "Non-Bounce", value: c.send_amt ? ((c.send_amt - c.hardbounces) / c.send_amt) * 100 : 0, bench: 98 },
  ];

  function downloadCSV() {
    const rows = [
      ["Metric", "Value", "Benchmark"],
      ["Open Rate", c!.open_rate.toFixed(2) + "%", benchOR + "%"],
      ["CTR", c!.ctr.toFixed(2) + "%", benchCTR + "%"],
      ["Sends", String(c!.send_amt), ""],
      ["Total Opens", String(c!.opens), ""],
      ["Unique Opens", String(c!.uniqueopens), ""],
      ["Bounces", String(c!.hardbounces + c!.softbounces), ""],
      ["Unsubscribes", String(c!.unsubscribes), ""],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${c!.name.replace(/\W+/g, "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>ID {c.id}</span>
              <span>•</span>
              <span>{c.type}</span>
              <span>•</span>
              <span>{c.sdate ? format(new Date(c.sdate), "MMM d, yyyy") : "—"}</span>
              <span>•</span>
              <span>{c.send_amt.toLocaleString()} sends</span>
              <span>•</span>
              <span className="text-foreground">Score {c.score}/100</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadCSV}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
            <Button asChild variant="outline" size="sm"><Link to="/"><ArrowLeft className="mr-1.5 h-4 w-4" />Campaigns</Link></Button>
          </div>
        </div>

        {/* Metric cards */}
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard label="Open Rate" value={`${c.open_rate.toFixed(1)}%`} detail={`${c.uniqueopens}/${c.send_amt}`} variance={c.open_rate - benchOR} />
          <MetricCard label="CTR" value={`${c.ctr.toFixed(2)}%`} detail={`${c.uniquelinkclicks}/${c.uniqueopens || 0}`} variance={c.ctr - benchCTR} />
          <MetricCard label="Total Opens" value={c.opens.toLocaleString()} detail={`${c.uniqueopens.toLocaleString()} unique`} />
          <MetricCard label="Sends" value={c.send_amt.toLocaleString()} detail={`${c.total_amt.toLocaleString()} queued`} />
          <MetricCard label="Bounces" value={(c.hardbounces + c.softbounces).toLocaleString()} detail={`${c.hardbounces} hard`} variance={-(((c.hardbounces + c.softbounces) / Math.max(1, c.send_amt)) * 100 - 2)} invertColor />
          <MetricCard label="Unsubscribes" value={c.unsubscribes.toLocaleString()} detail={`${((c.unsubscribes / Math.max(1, c.send_amt)) * 100).toFixed(2)}%`} />
        </div>

        {/* Charts */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold">Performance vs Benchmark</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <RadarChart data={radar}>
                  <PolarGrid stroke="oklch(1 0 0 / 10%)" />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 11 }} />
                  <PolarRadiusAxis tick={false} axisLine={false} />
                  <Radar name="Benchmark" dataKey="bench" stroke="oklch(0.66 0.025 255)" fill="oklch(0.66 0.025 255)" fillOpacity={0.1} />
                  <Radar name="Campaign" dataKey="value" stroke="oklch(0.74 0.17 245)" fill="oklch(0.74 0.17 245)" fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold">Open Rate — last campaigns</h3>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="oklch(1 0 0 / 6%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "oklch(0.66 0.025 255)", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "oklch(0.21 0.025 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="bench" stroke="oklch(0.66 0.025 255)" strokeDasharray="4 4" dot={false} />
                  <Line type="monotone" dataKey="open" stroke="oklch(0.74 0.17 245)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold">Campaign vs Internal Benchmark</div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium">Campaign</th>
                <th className="px-3 py-2 text-right font-medium">Benchmark</th>
                <th className="px-5 py-2 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <CmpRow label="Open Rate" v={c.open_rate} b={benchOR} suffix="%" />
              <CmpRow label="CTR" v={c.ctr} b={benchCTR} suffix="%" />
              <CmpRow label="Bounce Rate" v={(c.hardbounces / Math.max(1, c.send_amt)) * 100} b={2} suffix="%" invert />
              <CmpRow label="Unsub Rate" v={(c.unsubscribes / Math.max(1, c.send_amt)) * 100} b={0.5} suffix="%" invert />
            </tbody>
          </table>
        </div>

        {/* AI Recommendations */}
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">AI Improvement Recommendations</h2>
          </div>
          {recsQ.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0,1,2,3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />)}
            </div>
          ) : recsQ.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">{(recsQ.error as Error).message}</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(recsQ.data?.recommendations ?? []).map((r: any, idx: number) => (
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

          <div className="mt-6">
            <Button
              size="lg"
              disabled={!recsQ.data || varsM.isPending}
              onClick={() => {
                setDrawerOpen(true);
                if (!varsM.data) varsM.mutate();
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {varsM.isPending ? "Generating…" : "Generate 3 AI Variations"}
            </Button>
          </div>
        </section>
      </main>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full overflow-y-auto bg-background sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>AI Email Variations</SheetTitle>
          </SheetHeader>
          {varsM.isPending ? (
            <div className="mt-8 space-y-3">
              <div className="h-8 w-1/2 animate-pulse rounded bg-surface" />
              <div className="h-64 animate-pulse rounded bg-surface" />
            </div>
          ) : varsM.isError ? (
            <p className="mt-6 text-sm text-destructive">{(varsM.error as Error).message}</p>
          ) : varsM.data?.variations?.length ? (
            <Tabs defaultValue="0" className="mt-6">
              <TabsList className="bg-surface">
                {varsM.data.variations.map((_: any, i: number) => (
                  <TabsTrigger key={i} value={String(i)}>Variation {i + 1}</TabsTrigger>
                ))}
              </TabsList>
              {varsM.data.variations.map((v: any, i: number) => (
                <TabsContent key={i} value={String(i)} className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">New subject</div>
                    <div className="mt-2 flex items-center gap-2">
                      <p className="flex-1 text-sm font-medium">{v.subject}</p>
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(v.subject); toast.success("Subject copied"); }}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Main changes</div>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {(v.changes ?? []).map((ch: string, k: number) => (
                        <li key={k} className="flex gap-2"><span className="text-primary">→</span>{ch}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Preview</div>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(v.html); toast.success("HTML copied"); }}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />Copy HTML
                      </Button>
                    </div>
                    <iframe srcDoc={v.html} className="h-[480px] w-full rounded-md border border-border bg-white" sandbox="" title={`variation-${i}`} />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">No variations yet.</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CmpRow({ label, v, b, suffix, invert }: { label: string; v: number; b: number; suffix: string; invert?: boolean }) {
  const delta = v - b;
  const good = invert ? delta < 0 : delta > 0;
  return (
    <tr className="border-t border-border">
      <td className="px-5 py-3 font-sans">{label}</td>
      <td className="px-3 py-3 text-right tabular-nums">{v.toFixed(2)}{suffix}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{b.toFixed(2)}{suffix}</td>
      <td className={cn("px-5 py-3 text-right tabular-nums", good ? "text-success" : "text-destructive")}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}{suffix}</td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    "0": { label: "Draft", cls: "bg-muted text-muted-foreground" },
    "1": { label: "Scheduled", cls: "bg-warning/15 text-warning" },
    "2": { label: "Sending", cls: "bg-primary/15 text-primary" },
    "5": { label: "Completed", cls: "bg-success/15 text-success" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return <Badge className={cn("border-transparent", m.cls)}>{m.label}</Badge>;
}
