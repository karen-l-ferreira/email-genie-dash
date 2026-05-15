import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listContactFields,
  listContactsForAnalysis,
  listCampaigns,
  type ContactSummary,
  type Campaign,
} from "@/lib/ac.functions";
import { getSettings } from "@/lib/settings.functions";
import { AuthGate } from "@/components/app/AuthGate";
import { AppHeader } from "@/components/app/Header";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Clock,
  Download,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/influencia")({
  ssr: false,
  component: () => (
    <AuthGate>
      <InfluenciaPage />
    </AuthGate>
  ),
});

// Attribution window options in MINUTES
const ATTR_WINDOWS = [
  { value: 15, label: "15min" },
  { value: 30, label: "30min" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
  { value: 240, label: "4h" },
  { value: 1440, label: "24h" },
];

type InfluenceStatus = "influenced" | "not_influenced" | "no_operation";

type ContactRow = {
  contact: ContactSummary;
  operationDate: Date | null;
  closestCampaign: Campaign | null;
  minutesDelta: number | null;
  status: InfluenceStatus;
};

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s || s.startsWith("0000")) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function exportInfluenceCSV(rows: ContactRow[]) {
  const header = [
    "Nome", "E-mail", "Data/hora da operação",
    "Campanha mais próxima", "Envio da campanha", "Δ minutos", "Status",
  ];
  const data = rows.map((r) => [
    `"${[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ").replace(/"/g, '""') || ""}"`,
    r.contact.email,
    r.operationDate ? format(r.operationDate, "dd/MM/yyyy HH:mm") : "",
    r.closestCampaign ? `"${r.closestCampaign.name.replace(/"/g, '""')}"` : "",
    r.closestCampaign?.sdate
      ? format(new Date(r.closestCampaign.sdate.replace(" ", "T")), "dd/MM/yyyy HH:mm")
      : "",
    r.minutesDelta !== null ? r.minutesDelta : "",
    r.status === "influenced" ? "Influenciado" : r.status === "not_influenced" ? "Não influenciado" : "Sem operação",
  ]);
  const csv = [header, ...data].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `influencia_${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function InfluenciaPage() {
  const fetchSettings = useServerFn(getSettings);
  const fetchFields = useServerFn(listContactFields);
  const fetchContacts = useServerFn(listContactsForAnalysis);
  const fetchCampaigns = useServerFn(listCampaigns);

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });
  const fieldsQ = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => fetchFields(),
    enabled: !!settingsQ.data?.hasApiKey,
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", 0],
    queryFn: () => fetchCampaigns({ data: { offset: 0 } }),
    enabled: !!settingsQ.data?.hasApiKey,
    retry: false,
  });

  const [selectedFieldId, setSelectedFieldId] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [attrWindow, setAttrWindow] = useState(30); // minutes
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const sentCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns ?? []).filter((c) => c.send_amt > 0 && c.sdate),
    [campaignsQ.data],
  );

  const loadContacts = useCallback(async (offset = 0) => {
    setLoadingContacts(true);
    try {
      const res = await fetchContacts({ data: { offset } });
      if (offset === 0) {
        setContacts(res.contacts);
      } else {
        setContacts((prev) => [...prev, ...res.contacts]);
      }
      setTotal(res.total);
      setLoaded(true);
    } finally {
      setLoadingContacts(false);
    }
  }, [fetchContacts]);

  // ─── Attribution analysis ─────────────────────────────────────────────────
  // Logic: contact has an operation datetime stored in a custom field.
  // For each contact, find campaigns that were sent BEFORE the operation and
  // within attrWindow MINUTES of it. If any match → "influenced".

  const analysisRows: ContactRow[] = useMemo(() => {
    if (!selectedFieldId || !loaded) return [];

    const campaignsToAnalyze =
      selectedCampaignId === "all"
        ? sentCampaigns
        : sentCampaigns.filter((c) => c.id === selectedCampaignId);

    return contacts.map((contact) => {
      const rawValue = contact.fieldValues[selectedFieldId];
      const operationDate = parseDateSafe(rawValue);

      if (!operationDate) {
        return {
          contact,
          operationDate: null,
          closestCampaign: null,
          minutesDelta: null,
          status: "no_operation" as InfluenceStatus,
        };
      }

      // Campaigns sent before the operation, within the minute window
      const withinWindow = campaignsToAnalyze.filter((c) => {
        const cd = parseDateSafe(c.sdate);
        if (!cd) return false;
        const delta = differenceInMinutes(operationDate, cd);
        return delta >= 0 && delta <= attrWindow;
      });

      if (withinWindow.length === 0) {
        return {
          contact,
          operationDate,
          closestCampaign: null,
          minutesDelta: null,
          status: "not_influenced" as InfluenceStatus,
        };
      }

      // Closest campaign = most recent send before the operation
      const closest = withinWindow.reduce((best, c) => {
        const dBest = differenceInMinutes(operationDate, parseDateSafe(best.sdate)!);
        const dC = differenceInMinutes(operationDate, parseDateSafe(c.sdate)!);
        return dC < dBest ? c : best;
      });

      const delta = differenceInMinutes(operationDate, parseDateSafe(closest.sdate)!);

      return {
        contact,
        operationDate,
        closestCampaign: closest,
        minutesDelta: delta,
        status: "influenced" as InfluenceStatus,
      };
    });
  }, [contacts, selectedFieldId, selectedCampaignId, sentCampaigns, attrWindow, loaded]);

  const withOp = analysisRows.filter((r) => r.operationDate !== null);
  const influenced = analysisRows.filter((r) => r.status === "influenced");
  const influenceRate = withOp.length > 0 ? (influenced.length / withOp.length) * 100 : 0;
  const avgMinutes =
    influenced.length > 0
      ? influenced.reduce((s, r) => s + (r.minutesDelta ?? 0), 0) / influenced.length
      : 0;

  const selectedField = fieldsQ.data?.fields.find((f) => f.id === selectedFieldId);
  const hasMore = contacts.length < total;
  const windowLabel = ATTR_WINDOWS.find((w) => w.value === attrWindow)?.label ?? `${attrWindow}min`;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Análise de Influência</h1>
            <p className="text-sm text-muted-foreground">
              O cliente recebeu a campanha e operou nos próximos minutos?
            </p>
          </div>
        </div>

        {/* Config card */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold">Configuração da análise</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Campo de operação */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Campo "Data/hora da Operação" (AC)
              </label>
              {fieldsQ.isLoading ? (
                <div className="h-9 animate-pulse rounded-lg bg-surface" />
              ) : (
                <select
                  value={selectedFieldId}
                  onChange={(e) => setSelectedFieldId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">Selecionar campo…</option>
                  {(fieldsQ.data?.fields ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title} ({f.type})
                    </option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Campo que armazena a data <strong>e hora</strong> da última operação.
              </p>
            </div>

            {/* Campanha */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Campanha
              </label>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="all">Todas as campanhas enviadas</option>
                {sentCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.slice(0, 50)}
                    {c.sdate ? ` (${format(new Date(c.sdate.replace(" ", "T")), "dd/MM/yy HH:mm")})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Janela de atribuição (minutos) */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Janela de atribuição
              </label>
              <div className="flex gap-1 flex-wrap">
                {ATTR_WINDOWS.map((w) => (
                  <button
                    key={w.value}
                    onClick={() => setAttrWindow(w.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      attrWindow === w.value
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Minutos após o envio para considerar influência.
              </p>
            </div>

            {/* Carregar contatos */}
            <div className="flex flex-col justify-end">
              <Button
                disabled={!selectedFieldId || loadingContacts}
                onClick={() => loadContacts(0)}
                className="w-full"
              >
                <RefreshCw className={cn("mr-1.5 h-4 w-4", loadingContacts && "animate-spin")} />
                {loaded ? "Recarregar contatos" : "Carregar contatos"}
              </Button>
              {loaded && (
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  {contacts.length} de {total} contatos carregados
                </p>
              )}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        {loaded && selectedFieldId && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={<Users className="h-4 w-4 text-primary" />}
                label="Contatos analisados"
                value={contacts.length.toLocaleString("pt-BR")}
                sub={`${withOp.length} com data/hora de operação`}
              />
              <KpiCard
                icon={<Zap className="h-4 w-4 text-primary" />}
                label="Influenciados"
                value={influenced.length.toLocaleString("pt-BR")}
                sub={`operaram em até ${windowLabel} do e-mail`}
                good={influenced.length > 0}
              />
              <KpiCard
                icon={<TrendingUp className="h-4 w-4 text-primary" />}
                label="Taxa de influência"
                value={withOp.length > 0 ? `${influenceRate.toFixed(1)}%` : "—"}
                sub="sobre quem tem op. registrada"
                good={withOp.length > 0 ? influenceRate >= 10 : undefined}
              />
              <KpiCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                label="Tempo médio até operar"
                value={influenced.length > 0 ? fmtMinutes(Math.round(avgMinutes)) : "—"}
                sub="após receber o e-mail"
              />
            </div>

            {/* Results table */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  Contatos com campo "{selectedField?.title ?? selectedFieldId}"
                </h2>
                {analysisRows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => exportInfluenceCSV(analysisRows)}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    CSV
                  </Button>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Contato</th>
                      <th className="px-3 py-3 text-left font-medium">E-mail</th>
                      <th className="px-3 py-3 text-left font-medium">Data/hora da operação</th>
                      <th className="px-3 py-3 text-left font-medium">Campanha mais próxima</th>
                      <th className="px-3 py-3 text-right font-medium">Δ tempo</th>
                      <th className="px-3 py-3 text-center font-medium">Status</th>
                      <th className="w-8 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {analysisRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                          Nenhum contato para exibir. Clique em "Carregar contatos" após selecionar o campo.
                        </td>
                      </tr>
                    ) : (
                      analysisRows.map((row) => (
                        <InfluenceRow key={row.contact.id} row={row} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {contacts.length} de {total} contatos
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadContacts(contacts.length)}
                    disabled={loadingContacts}
                  >
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingContacts && "animate-spin")} />
                    {loadingContacts ? "Carregando…" : `Carregar mais ${Math.min(100, total - contacts.length)}`}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {!loaded && (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <Zap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              Selecione o campo de data/hora da operação e clique em "Carregar contatos".
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              O sistema verifica se o contato operou dentro da janela de tempo após receber cada campanha.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function InfluenceRow({ row }: { row: ContactRow }) {
  const { contact, operationDate, closestCampaign, minutesDelta, status } = row;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "—";

  return (
    <tr className="border-t border-border transition-colors hover:bg-surface-2">
      <td className="px-5 py-3 font-medium">{name}</td>
      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{contact.email || "—"}</td>
      <td className="px-3 py-3 font-mono text-xs">
        {operationDate ? (
          format(operationDate, "dd/MM/yyyy HH:mm", { locale: ptBR })
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs">
        {closestCampaign ? (
          <div>
            <div className="max-w-[200px] truncate font-medium">{closestCampaign.name}</div>
            {closestCampaign.sdate && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {format(new Date(closestCampaign.sdate.replace(" ", "T")), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">
        {minutesDelta !== null ? (
          <span className={cn(
            "font-semibold",
            minutesDelta <= 30 ? "text-success" : minutesDelta <= 120 ? "text-warning" : "text-muted-foreground",
          )}>
            {fmtMinutes(minutesDelta)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        <StatusBadge status={status} />
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <ChevronRight className="h-3.5 w-3.5" />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: InfluenceStatus }) {
  if (status === "influenced")
    return <span className="inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">Influenciado</span>;
  if (status === "not_influenced")
    return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Não influenciado</span>;
  return <span className="inline-flex items-center rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">Sem operação</span>;
}

function KpiCard({ icon, label, value, sub, good }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={cn(
        "mt-2 font-mono text-3xl font-semibold",
        good === true ? "text-success" : good === false ? "text-destructive" : "text-foreground",
      )}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
